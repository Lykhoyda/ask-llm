#!/usr/bin/env node
// codex-pair Stop-gate (#142, ADR-118). Blocks turn-end while unaddressed HIGH
// findings remain — opt-in via `blockOn: HIGH` in .codex-pair/context.md.
// MUST exit 0 on every path: a throw/non-zero here would wedge every turn-end.
// Fail-open and LOUD (warn to stderr) on any internal error.
//
// findMarkerUp is duplicated by design (zero-workspace-imports; see prompt-drain).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { debounceRoot, drainPending, joinPendingForSurface, reviewingRoot } from "./lib/debounce-state.mjs";
import { collectSessionMarkers } from "./lib/session-registry.mjs";
import {
  CONTEXT_FILENAME,
  contextPath,
  INFLIGHT_TTL_MIN_MS,
  inflightRoot,
  logPath,
  PAIR_ROOT_DIR,
  readAcks,
} from "./lib/state.mjs";
import {
  collectBlockingHighs,
  collectInFlight,
  formatBlockMessage,
  formatInFlightMessage,
  parseGitPorcelain,
  selectLatestEntries,
} from "./lib/stop-gate.mjs";

const MARKER_FILE = join(PAIR_ROOT_DIR, CONTEXT_FILENAME);

function findMarkerUp(startDir) {
  const home = homedir();
  let current = resolve(startDir);
  for (let depth = 0; depth < 20; depth++) {
    if (existsSync(join(current, MARKER_FILE))) return current;
    const parent = dirname(current);
    if (parent === current || current === home) return null;
    current = parent;
  }
  return null;
}

function readStdin() {
  return new Promise((r) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c.toString()));
    process.stdin.on("end", () => r(data));
    process.stdin.on("error", () => r(""));
  });
}

// Minimal frontmatter scalar read — the gate needs `blockOn` and `timeoutMs`
// only, so a full parser stays unnecessary. Looks for `<key>: X` inside the
// leading `---` block.
function readMarkerScalar(markerDir, key) {
  let text;
  try {
    text = readFileSync(contextPath(markerDir), "utf8");
  } catch {
    return null;
  }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); // tolerate CRLF (Windows)
  if (!fm) return null;
  const m = fm[1].match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, "m"));
  return m ? m[1].trim() : null;
}

function readBlockOn(markerDir) {
  return readMarkerScalar(markerDir, "blockOn");
}

function gitDirtySet(markerDir) {
  // timeout guards against a hung git (locked index, slow FS) wedging turn-end.
  const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 };
  try {
    const repoRoot = execFileSync("git", ["-C", markerDir, "rev-parse", "--show-toplevel"], opts).trim();
    const porcelain = execFileSync("git", ["-C", markerDir, "status", "--porcelain=v1", "-z"], opts);
    return parseGitPorcelain(porcelain, repoRoot);
  } catch {
    return null; // not a repo / git missing / timeout → skip the [B] filter
  }
}

// Read the raw inputs for collectInFlight: parsed debounce records + inflight
// lock mtimes. Uses the RAW (pre-realpath) markerDir — the watch hook writes
// this state under the same un-canonicalized root that findMarkerUp returns.
function readInFlightInputs(markerDir) {
  const records = [];
  try {
    const root = debounceRoot(markerDir);
    for (const name of readdirSync(root)) {
      if (!name.endsWith(".json")) continue;
      try {
        records.push(JSON.parse(readFileSync(join(root, name), "utf8")));
      } catch {
        // malformed record — collectInFlight tolerates junk anyway
      }
    }
  } catch {
    // no debounce dir yet
  }
  // Inflight locks AND worker `reviewing` markers count as running reviews —
  // the marker covers the worker→forced-sync-hook handoff gap where the
  // debounce record is already consumed but the lock not yet taken.
  const lockMtimes = [];
  for (const root of [inflightRoot(markerDir), reviewingRoot(markerDir)]) {
    try {
      for (const name of readdirSync(root)) {
        try {
          lockMtimes.push(statSync(join(root, name)).mtimeMs);
        } catch {
          // entry vanished between readdir and stat
        }
      }
    } catch {
      // dir doesn't exist yet
    }
  }
  return { records, lockMtimes };
}

// Lock freshness mirrors the watch hook's inflight-lock TTL — same precedence
// (marker frontmatter `timeoutMs` > ASK_CODEX_TIMEOUT_MS > 800s default, then
// the 10-min floor plus buffer) so the gate and the lock lifecycle agree on
// what "still reviewing" means even for projects that pin a longer per-review
// timeout (PR #208 review).
function inflightFreshMs(markerDir) {
  const fmTimeout = Number(readMarkerScalar(markerDir, "timeoutMs"));
  const timeout =
    Number.isFinite(fmTimeout) && fmTimeout > 0 ? fmTimeout : Number(process.env.ASK_CODEX_TIMEOUT_MS ?? 800_000);
  return Math.max(timeout, INFLIGHT_TTL_MIN_MS) + 60_000;
}

function writeAndExit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`, () => process.exit(0));
}

// Canonicalize file paths so they align with git's realpath'd repo root — on
// macOS `/var` resolves to `/private/var`, which would otherwise make the [B]
// git-status filter and the [E] relPath ack hash mismatch (ADR-118). Missing
// files are left as-is; [A]'s existsFn drops them.
function canonicalizeEntries(entries) {
  const out = new Map();
  for (const [file, entry] of entries) {
    let real = file;
    try {
      real = realpathSync(file);
    } catch {
      // missing/inaccessible → keep raw; collectBlockingHighs' existsFn drops it
    }
    out.set(real, { ...entry, file: real });
  }
  return out;
}

// Evaluate one project marker: drain its pending verdicts and, if it opted into
// blockOn:HIGH, compute whether it wants to block (unaddressed HIGH and/or an
// in-flight review). Returns marker-scoped text; aggregation happens in main().
// Reads in-flight state from the RAW markerDir (matches where the watch hook
// writes it); canonicalizes only for git/log path alignment (macOS /var).
// Only blocking I/O is gitDirtySet (two git calls, each hard-capped at 5s), so
// the sequential per-marker cost is bounded even for several registered repos.
function evaluateMarker(markerDir) {
  // Return the RAW drained verdicts — main() accumulates across markers and caps
  // the surfaced blob ONCE via joinPendingForSurface, so the MAX_SURFACE_VERDICTS
  // bound is global (not 8-per-marker). Matches codex-pair-prompt-drain.mjs.
  const pending = drainPending(markerDir);

  if (readBlockOn(markerDir) !== "HIGH") {
    return { pending, blockReason: null };
  }

  const inFlight = collectInFlight({
    ...readInFlightInputs(markerDir),
    now: Date.now(),
    freshMs: inflightFreshMs(markerDir),
  });

  let canonical = markerDir;
  try {
    canonical = realpathSync(markerDir);
  } catch {
    // keep raw on the rare realpath failure
  }

  let logText = "";
  try {
    logText = readFileSync(logPath(canonical), "utf8");
  } catch {
    // no log yet — an in-flight first-ever review can still block below
  }

  const blocking = collectBlockingHighs({
    entries: canonicalizeEntries(selectLatestEntries(logText)),
    acks: readAcks(canonical),
    existsFn: existsSync,
    gitDirty: gitDirtySet(canonical),
    markerDir: canonical,
  });

  let blockReason = null;
  if (blocking.length > 0) {
    blockReason = formatBlockMessage(blocking, canonical);
    if (inFlight.any) blockReason = `${formatInFlightMessage(inFlight, canonical)}\n\n${blockReason}`;
  } else if (inFlight.any) {
    blockReason = formatInFlightMessage(inFlight, canonical);
  }
  return { pending, blockReason };
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (payload?.hook_event_name !== "Stop") process.exit(0);
  if (payload?.stop_hook_active) process.exit(0);

  // ADR-131 (#209): evaluate EVERY repo active this session, not just cwd. The
  // cwd marker may even be null (cwd repo has no .codex-pair) while edits landed
  // in a registered sibling repo — so we no longer early-exit on a missing cwd
  // marker; collectSessionMarkers unions cwd (if any) with the registered set.
  const cwdMarker = findMarkerUp(process.cwd());
  const markers = collectSessionMarkers(cwdMarker, payload?.session_id);
  if (markers.length === 0) process.exit(0);

  const allPending = [];
  const blockReasons = [];
  for (const markerDir of markers) {
    const { pending, blockReason } = evaluateMarker(markerDir);
    allPending.push(...pending);
    if (blockReason) blockReasons.push(blockReason);
  }
  // Cap the surfaced blob ONCE across all markers (MAX_SURFACE_VERDICTS is global,
  // not per-repo) — mirrors codex-pair-prompt-drain.mjs.
  const pendingCombined = allPending.length > 0 ? joinPendingForSurface(allPending) : null;

  // Block if ANY marker blocks; each repo keeps its own blockOn/timeoutMs. The
  // block reason folds in every blocking marker's message plus all pending text;
  // a non-blocking turn with pending verdicts surfaces them as Stop
  // additionalContext (preserved ADR-130 channel — block path uses `reason`).
  if (blockReasons.length > 0) {
    let reason = blockReasons.join("\n\n");
    if (pendingCombined) reason = `${pendingCombined}\n\n${reason}`;
    writeAndExit({ decision: "block", reason });
    return;
  }

  if (pendingCombined) {
    writeAndExit({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: pendingCombined },
    });
    return;
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(
    `[codex-pair] WARNING: stop-gate failed (${err?.message ?? err}). Allowing turn end — HIGH findings may remain.\n`,
  );
  process.exit(0);
});
