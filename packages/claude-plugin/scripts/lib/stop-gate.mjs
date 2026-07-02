// scripts/lib/stop-gate.mjs
// Pure, I/O-free gate logic for the codex-pair Stop hook (#142, ADR-118).
// No workspace imports — the hook ships without node_modules.

import { isAbsolute, join, relative } from "node:path";
import { hashConcernBody } from "./state.mjs";

// Parse `git status --porcelain` (v1) into a Set of ABSOLUTE paths that are
// modified or untracked relative to HEAD. repoRoot = `git rev-parse
// --show-toplevel`. Rename lines ("R  old -> new") contribute the NEW path
// (that's the file present on disk). The first 3 chars are the XY status +
// space; the path starts at index 3.
export function parseGitPorcelain(stdout, repoRoot) {
  const dirty = new Set();
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    let path = line.slice(3);
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    path = path.replace(/^"|"$/g, ""); // git quotes paths with special chars
    dirty.add(isAbsolute(path) ? path : join(repoRoot, path));
  }
  return dirty;
}

// Verdicts that don't carry a trustworthy final-state review. `skipped`/`error`
// carry a `file` field, so they can be a file's latest entry → [C] fail-opens on
// them. `retried`/`broker_fallback` are logged WITHOUT a `file` (transient
// per-attempt markers), so selectLatestEntries already excludes them and the
// file's true latest review (concerns/none/cached) is used — they're listed here
// for completeness/future-proofing, not because they're currently reachable.
const INDETERMINATE = new Set(["skipped", "error", "retried", "broker_fallback"]);

// Reconcile latest-per-file entries against present reality, returning the
// unacked HIGH findings that should block turn-end.
//   entries   Map<file, latestEntry>      (from selectLatestEntries)
//   acks      { [hash]: {reason, ts} }     (from readAcks)
//   existsFn  (absFile) => boolean         (injected fs.existsSync)
//   gitDirty  Set<absPath> | null          (null = no git filter)
//   markerDir project root for relPath ack identity
export function collectBlockingHighs({ entries, acks, existsFn, gitDirty, markerDir }) {
  const blocking = [];
  for (const [file, entry] of entries) {
    if (!existsFn(file)) continue; // [A] deleted/renamed
    if (INDETERMINATE.has(entry.verdict)) continue; // [C] indeterminate latest → fail-open
    if (gitDirty && !gitDirty.has(file)) continue; // [B] clean vs HEAD
    const highs = Array.isArray(entry.concerns?.high) ? entry.concerns.high : [];
    for (const text of highs) {
      const hash = hashConcernBody(`${relative(markerDir, file)}:${text}`); // [E] file-scoped
      if (!acks[hash]) blocking.push({ file, text, hash });
    }
  }
  return blocking;
}

// Build the Stop-hook block reason. Short hashes (first 6) are the ack ids.
export function formatBlockMessage(blocking, markerDir) {
  const lines = blocking.map((b) => {
    const rel = relative(markerDir, b.file);
    return `  [${b.hash}] ${rel}\n    ${b.text}`;
  });
  return (
    `🚫 codex-pair: ${blocking.length} unaddressed HIGH finding(s) (blockOn: HIGH). ` +
    `Fix them, or defer each with /codex-pair-ack.\n\n` +
    `${lines.join("\n")}\n\n` +
    `To defer a finding (stale / pre-existing / out-of-scope), run /codex-pair-ack with its [hash] from the list above — e.g.:\n` +
    `  /codex-pair-ack ${blocking[0].hash} "<reason>"\n` +
    `(If you fixed a finding by editing a DIFFERENT file, make a real edit to the ` +
    `flagged file so it gets re-reviewed — an identical re-touch hits the review cache.)`
  );
}

// In-flight review detection (2026-07-02 seamless-pairing design). A turn can
// end while a debounce worker is still settling (record.reviewedGen <
// record.generation) or a codex call is mid-review (fresh inflight lock) —
// the log-based gate would pass and the verdict would land after "done".
// Pure over pre-read inputs; the script does the I/O.
//   records    parsed debounce-record JSONs (malformed entries tolerated)
//   lockMtimes mtimeMs of files under state/inflight/
//   now        clock
//   freshMs    lock age beyond which a lock is crash junk, not a live review
//   staleMs    burst age beyond which an unconsumed record is a crashed
//              worker's orphan (sweepStaleDebounce fodder), not a live settle
export function collectInFlight({ records, lockMtimes, now, freshMs, staleMs = 600_000 }) {
  const settling = [];
  for (const r of records) {
    if (!r || typeof r !== "object" || typeof r.file !== "string") continue;
    if (!(typeof r.generation === "number" && typeof r.reviewedGen === "number")) continue;
    if (r.reviewedGen >= r.generation) continue;
    if (Number.isFinite(r.burstStartedAt) && now - r.burstStartedAt > staleMs) continue;
    settling.push(r.file);
  }
  const reviewing = lockMtimes.filter((m) => Number.isFinite(m) && now - m < freshMs).length;
  return { settling, reviewing, any: settling.length > 0 || reviewing > 0 };
}

// Block reason for the in-flight case: tell Claude HOW to wait productively
// instead of just refusing the stop.
const MAX_SETTLING_LISTED = 5;
export function formatInFlightMessage({ settling, reviewing }, markerDir) {
  const parts = [];
  if (settling.length > 0) {
    const listed = settling.slice(0, MAX_SETTLING_LISTED).map((f) => relative(markerDir, f));
    const extra = settling.length > MAX_SETTLING_LISTED ? ` (+${settling.length - MAX_SETTLING_LISTED} more)` : "";
    parts.push(`${settling.length} edited file(s) awaiting review: ${listed.join(", ")}${extra}`);
  }
  if (reviewing > 0) parts.push(`${reviewing} review(s) running`);
  return (
    `⏳ codex-pair: review(s) still in flight — ${parts.join("; ")}. ` +
    `Verdicts land in ${join(markerDir, ".codex-pair", "log.jsonl")}. ` +
    `Wait for them (e.g. \`sleep 45\`), read the newest entries for the files you edited, ` +
    `address any HIGH findings, then end the turn.`
  );
}

// Parse log.jsonl text → Map<file, latestEntry>. Last write per file wins
// (the log is append-only; the final entry is the file's latest review).
export function selectLatestEntries(logText) {
  const latest = new Map();
  for (const line of logText.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let entry;
    try {
      entry = JSON.parse(t);
    } catch {
      continue;
    }
    if (entry && typeof entry.file === "string") latest.set(entry.file, entry);
  }
  return latest;
}
