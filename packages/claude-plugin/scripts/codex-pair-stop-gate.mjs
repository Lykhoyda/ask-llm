#!/usr/bin/env node
// codex-pair Stop-gate (#142, ADR-118). Blocks turn-end while unaddressed HIGH
// findings remain — opt-in via `blockOn: HIGH` in .codex-pair/context.md.
// MUST exit 0 on every path: a throw/non-zero here would wedge every turn-end.
// Fail-open and LOUD (warn to stderr) on any internal error.
//
// findMarkerUp is duplicated by design (zero-workspace-imports; see prompt-drain).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { debounceRoot, drainPending, joinPendingForSurface, reviewingRoot } from "./lib/debounce-state.mjs";
import {
  CONTEXT_FILENAME,
  INFLIGHT_TTL_MIN_MS,
  PAIR_ROOT_DIR,
  contextPath,
  inflightRoot,
  logPath,
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

// Minimal frontmatter scalar read — only need `blockOn`. Looks for `blockOn: X`
// inside the leading `---` block.
function readBlockOn(markerDir) {
  let text;
  try {
    text = readFileSync(contextPath(markerDir), "utf8");
  } catch {
    return null;
  }
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/); // tolerate CRLF (Windows)
  if (!fm) return null;
  const m = fm[1].match(/^\s*blockOn:\s*(\S+)\s*$/m);
  return m ? m[1].trim() : null;
}

function gitDirtySet(markerDir) {
  // timeout guards against a hung git (locked index, slow FS) wedging turn-end.
  const opts = { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 };
  try {
    const repoRoot = execFileSync("git", ["-C", markerDir, "rev-parse", "--show-toplevel"], opts).trim();
    const porcelain = execFileSync("git", ["-C", markerDir, "status", "--porcelain"], opts);
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

// Lock freshness mirrors the watch hook's inflight-lock TTL (env timeout vs
// the 10-min floor, plus buffer) so the gate and the lock lifecycle agree on
// what "still reviewing" means.
function inflightFreshMs() {
  return Math.max(Number(process.env.ASK_CODEX_TIMEOUT_MS ?? 800_000), INFLIGHT_TTL_MIN_MS) + 60_000;
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

  let markerDir = findMarkerUp(process.cwd());
  if (!markerDir) process.exit(0);

  // Drain queued debounce verdicts at turn-end (2026-07-02 seamless-pairing
  // design) — previously they waited for the NEXT edit or user prompt, i.e.
  // after Claude already said "done". Delivered below on whichever path runs:
  // folded into the block reason, or as non-blocking Stop additionalContext.
  const pending = drainPending(markerDir);
  const pendingText = pending.length > 0 ? joinPendingForSurface(pending) : null;

  if (readBlockOn(markerDir) !== "HIGH") {
    if (pendingText) {
      writeAndExit({
        hookSpecificOutput: { hookEventName: "Stop", additionalContext: pendingText },
      });
      return;
    }
    process.exit(0);
  }

  // In-flight detection reads the RAW markerDir (matches where the watch hook
  // writes state); canonicalization below is only for git/log path alignment.
  const inFlight = collectInFlight({
    ...readInFlightInputs(markerDir),
    now: Date.now(),
    freshMs: inflightFreshMs(),
  });

  // Canonicalize so markerDir aligns with git's realpath'd repo root (macOS).
  try {
    markerDir = realpathSync(markerDir);
  } catch {
    // keep raw on the rare realpath failure
  }

  let logText = "";
  try {
    logText = readFileSync(logPath(markerDir), "utf8");
  } catch {
    // no log yet — in-flight reviews (first ever review) can still block below
  }

  const blocking = collectBlockingHighs({
    entries: canonicalizeEntries(selectLatestEntries(logText)),
    acks: readAcks(markerDir),
    existsFn: existsSync,
    gitDirty: gitDirtySet(markerDir),
    markerDir,
  });

  if (blocking.length > 0) {
    let reason = formatBlockMessage(blocking, markerDir);
    if (inFlight.any) reason = `${formatInFlightMessage(inFlight, markerDir)}\n\n${reason}`;
    if (pendingText) reason = `${pendingText}\n\n${reason}`;
    writeAndExit({ decision: "block", reason });
    return;
  }

  if (inFlight.any) {
    let reason = formatInFlightMessage(inFlight, markerDir);
    if (pendingText) reason = `${pendingText}\n\n${reason}`;
    writeAndExit({ decision: "block", reason });
    return;
  }

  if (pendingText) {
    writeAndExit({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: pendingText },
    });
    return;
  }

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`[codex-pair] WARNING: stop-gate failed (${err?.message ?? err}). Allowing turn end — HIGH findings may remain.\n`);
  process.exit(0);
});
