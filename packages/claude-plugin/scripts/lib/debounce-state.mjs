// Per-file edit-debounce state (design 2026-06-03, closes #96 Bug 2 / Idea 1).
//
// Two per-file stores under <markerDir>/.codex-pair/state/:
//   debounce/<sha256(file)[0:16]>.json — edit record { file, generation, burstStartedAt, reviewedGen, sessionId }
//   pending/<sha256(file)[0:16]>.json  — settled verdict { file, message } awaiting surface
//
// Atomic writes use tmp+rename (ADR-086/091). Reads tolerate missing/malformed
// (return null / []). Every write is best-effort — debounce state failures must
// never break the hook (ADR-077).

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { stateRoot } from "./state.mjs";

export const DEBOUNCE_DIR = "debounce";
export const PENDING_DIR = "pending";
export const REVIEWING_DIR = "reviewing";
export const DEFAULT_DEBOUNCE_MS = 15_000;
export const DEFAULT_DEBOUNCE_MAX_MS = 60_000;
// Sweep records/pending older than maxMs + this buffer (junk from crashes).
export const DEBOUNCE_STALE_BUFFER_MS = 300_000;

export const debounceRoot = (markerDir) => join(stateRoot(markerDir), DEBOUNCE_DIR);
export const pendingRoot = (markerDir) => join(stateRoot(markerDir), PENDING_DIR);
export const reviewingRoot = (markerDir) => join(stateRoot(markerDir), REVIEWING_DIR);

function fileHash(file) {
  return createHash("sha256").update(String(file)).digest("hex").slice(0, 16);
}
export const debounceRecordPath = (markerDir, file) =>
  join(debounceRoot(markerDir), `${fileHash(file)}.json`);
export const pendingPath = (markerDir, file) => join(pendingRoot(markerDir), `${fileHash(file)}.json`);

function writeAtomicSync(p, value) {
  try {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, p);
  } catch {
    // best-effort (ADR-077)
  }
}

// Record one edit. Increments generation; preserves burstStartedAt while a
// burst is unconsumed (reviewedGen < generation), resets it for a fresh burst.
export function bumpEditRecord(markerDir, file, { sessionId, now }) {
  let prev = null;
  try {
    prev = JSON.parse(readFileSync(debounceRecordPath(markerDir, file), "utf8"));
  } catch {
    prev = null;
  }
  const generation = (prev?.generation ?? 0) + 1;
  const burstInProgress = prev && prev.reviewedGen < prev.generation;
  const burstStartedAt = burstInProgress ? prev.burstStartedAt : now;
  const record = { file, generation, burstStartedAt, reviewedGen: prev?.reviewedGen ?? 0, sessionId };
  writeAtomicSync(debounceRecordPath(markerDir, file), record);
  return record;
}

export function readEditRecord(markerDir, file) {
  try {
    return JSON.parse(readFileSync(debounceRecordPath(markerDir, file), "utf8"));
  } catch {
    return null;
  }
}

// Pure decision: should the worker born for `myGeneration` review now?
export function decideReview({ record, myGeneration, now, maxMs }) {
  if (!record) return { review: false, reason: "record-missing" };
  if (record.reviewedGen >= myGeneration) return { review: false, reason: "already-reviewed" };
  if (record.generation === myGeneration) return { review: true, reason: "settled" };
  if (now - record.burstStartedAt >= maxMs) return { review: true, reason: "max-cap" };
  return { review: false, reason: "superseded" };
}

// Advance reviewedGen so the next edit starts a fresh burst. Best-effort.
// Note: a cap-triggered worker (generation N < the current latest M) advances
// reviewedGen to N, not M — so the latest-gen worker still reviews the SETTLED
// state once editing stops. A long continuous burst therefore yields a mid-burst
// cap review (state at N) plus a final settled review (state at M): two reviews
// of two DIFFERENT states, which is intended. The per-file inflight lock bounds
// the worst case to one in-flight Codex call at a time (extra wakers coalesce).
export function markReviewed(markerDir, file, generation) {
  const p = debounceRecordPath(markerDir, file);
  let rec;
  try {
    rec = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return;
  }
  if (rec.reviewedGen < generation) {
    rec.reviewedGen = generation;
    writeAtomicSync(p, rec);
  }
}

export function writePending(markerDir, file, message) {
  writeAtomicSync(pendingPath(markerDir, file), { file, message });
}

// Worker handoff marker (2026-07-02 seamless-pairing design, dogfood finding).
// The worker advances reviewedGen BEFORE the forced-sync hook acquires the
// per-file inflight lock, so a Stop-gate check in that gap would see neither
// "settling" nor "reviewing" and let the turn end mid-review. The worker holds
// this marker across the whole handoff (markReviewing → spawn → clearReviewing)
// so the gate always has an observable signal. Best-effort like all debounce
// state; a leaked marker ages out via the gate's freshness window + TTL sweep.
export const reviewingPath = (markerDir, file) =>
  join(reviewingRoot(markerDir), `${fileHash(file)}.json`);

export function markReviewing(markerDir, file) {
  writeAtomicSync(reviewingPath(markerDir, file), { file, at: Date.now() });
}

export function clearReviewing(markerDir, file) {
  try {
    unlinkSync(reviewingPath(markerDir, file));
  } catch {
    // already gone
  }
}

// Read + clear every pending verdict (surfaced exactly once). Returns messages.
export function drainPending(markerDir) {
  const root = pendingRoot(markerDir);
  const messages = [];
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return messages;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = join(root, name);
    try {
      const { message } = JSON.parse(readFileSync(full, "utf8"));
      if (typeof message === "string" && message.length > 0) messages.push(message);
    } catch {
      // skip malformed
    }
    try {
      unlinkSync(full);
    } catch {
      // already gone
    }
  }
  return messages;
}

// Bound how many drained verdicts are surfaced inline. drainPending still
// clears ALL pending files; only the surfaced text is capped, so a burst that
// touches many files can't inject an unbounded blob into Claude's context —
// the overflow stays in the log. Trailer points there.
export const MAX_SURFACE_VERDICTS = 8;
export function joinPendingForSurface(messages) {
  if (messages.length <= MAX_SURFACE_VERDICTS) return messages.join("\n\n");
  const extra = messages.length - MAX_SURFACE_VERDICTS;
  return `${messages
    .slice(0, MAX_SURFACE_VERDICTS)
    .join("\n\n")}\n\n[codex-pair] +${extra} more verdict(s) drained — see .codex-pair/log.jsonl`;
}

// SessionEnd cancel: drop all debounce + pending state so orphaned sleepers
// self-cancel (decideReview → record-missing) and no stale verdict leaks into
// a later session.
export function clearAllDebounceState(markerDir) {
  for (const root of [debounceRoot(markerDir), pendingRoot(markerDir), reviewingRoot(markerDir)]) {
    let names;
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        unlinkSync(join(root, name));
      } catch {
        // best-effort
      }
    }
  }
}

// Probabilistic TTL sweep (mirrors ADR-097). Best-effort; never throws.
export function sweepStaleDebounce(markerDir, maxMs) {
  const cutoff = Date.now() - (maxMs + DEBOUNCE_STALE_BUFFER_MS);
  for (const root of [debounceRoot(markerDir), pendingRoot(markerDir), reviewingRoot(markerDir)]) {
    let names;
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(root, name);
      try {
        if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
      } catch {
        // skip
      }
    }
  }
}
