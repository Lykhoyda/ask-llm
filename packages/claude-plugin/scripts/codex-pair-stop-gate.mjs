#!/usr/bin/env node
// codex-pair Stop-gate (#142, ADR-118). Blocks turn-end while unaddressed HIGH
// findings remain — opt-in via `blockOn: HIGH` in .codex-pair/context.md.
// MUST exit 0 on every path: a throw/non-zero here would wedge every turn-end.
// Fail-open and LOUD (warn to stderr) on any internal error.
//
// findMarkerUp is duplicated by design (zero-workspace-imports; see prompt-drain).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^\s*blockOn:\s*(\S+)\s*$/m);
  return m ? m[1].trim() : null;
}

function gitDirtySet(markerDir) {
  try {
    const repoRoot = execFileSync("git", ["-C", markerDir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const porcelain = execFileSync("git", ["-C", markerDir, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseGitPorcelain(porcelain, repoRoot);
  } catch {
    return null; // not a repo / git missing → skip the [B] filter
  }
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

  const markerDir = findMarkerUp(process.cwd());
  if (!markerDir) process.exit(0);
  if (readBlockOn(markerDir) !== "HIGH") process.exit(0);

  let logText = "";
  try {
    logText = readFileSync(logPath(markerDir), "utf8");
  } catch {
    process.exit(0);
  }

  const blocking = collectBlockingHighs({
    entries: selectLatestEntries(logText),
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
