#!/usr/bin/env node
// codex-pair Stop-gate (#142, ADR-118). Blocks turn-end while unaddressed HIGH
// findings remain — opt-in via `blockOn: HIGH` in .codex-pair/context.md.
// MUST exit 0 on every path: a throw/non-zero here would wedge every turn-end.
// Fail-open and LOUD (warn to stderr) on any internal error.
//
// findMarkerUp is duplicated by design (zero-workspace-imports; see prompt-drain).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONTEXT_FILENAME, PAIR_ROOT_DIR, contextPath, logPath, readAcks } from "./lib/state.mjs";
import { collectBlockingHighs, formatBlockMessage, parseGitPorcelain, selectLatestEntries } from "./lib/stop-gate.mjs";

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
  if (readBlockOn(markerDir) !== "HIGH") process.exit(0);
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
    process.exit(0);
  }

  const blocking = collectBlockingHighs({
    entries: canonicalizeEntries(selectLatestEntries(logText)),
    acks: readAcks(markerDir),
    existsFn: existsSync,
    gitDirty: gitDirtySet(markerDir),
    markerDir,
  });

  if (blocking.length === 0) process.exit(0);

  const out = JSON.stringify({ decision: "block", reason: formatBlockMessage(blocking, markerDir) });
  process.stdout.write(`${out}\n`, () => process.exit(0));
}

main().catch((err) => {
  process.stderr.write(`[codex-pair] WARNING: stop-gate failed (${err?.message ?? err}). Allowing turn end — HIGH findings may remain.\n`);
  process.exit(0);
});
