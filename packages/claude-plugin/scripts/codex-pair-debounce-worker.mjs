#!/usr/bin/env node
// Detached edit-debounce worker (design 2026-06-03, closes #96 Bug 2 / Idea 1).
//
// Spawned by codex-pair-watch.mjs on each edit when debounceMs > 0. Sleeps the
// settle window, then — only if no newer edit superseded it (trailing-edge) or
// the burst exceeded the max cap — re-invokes the hook in FORCED-SYNC mode to
// run the real review. The forced-sync hook acquires the existing per-file
// inflight lock itself, so concurrent workers race there and exactly one
// reviews (the inflight lock IS the claim — the worker holds no lock, which
// would otherwise deadlock against the hook).
//
// The worker has no stdout channel to Claude, so it captures the hook's emitted
// systemMessage and queues it in the per-file pending store; the next edit hook
// (or the UserPromptSubmit drain) surfaces it. MUST exit 0 on every path (ADR-077).

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideReview, markReviewed, readEditRecord, writePending } from "./lib/debounce-state.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(SCRIPT_DIR, "codex-pair-watch.mjs");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// The forced-sync hook writes one `{ "continue": true, "systemMessage": "..." }`
// JSON line to stdout. Pull systemMessage from the last parseable line.
function extractSystemMessage(stdout) {
  if (!stdout) return null;
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj.systemMessage === "string") return obj.systemMessage;
    } catch {
      // not JSON — skip
    }
  }
  return null;
}

async function main() {
  const markerDir = process.env.CP_MARKER_DIR;
  const file = process.env.CP_FILE;
  const tool = process.env.CP_TOOL || "Edit";
  const myGeneration = Number(process.env.CP_GENERATION);
  const settleMs = Number(process.env.CP_SETTLE_MS);
  const rawMaxMs = Number(process.env.CP_MAX_MS);
  // Guard maxMs like settleMs: a missing/NaN CP_MAX_MS must not silently
  // disable the anti-starvation cap (every `>= NaN` comparison is false).
  const maxMs = Number.isFinite(rawMaxMs) && rawMaxMs > 0 ? rawMaxMs : 60_000;
  if (!markerDir || !file || !Number.isFinite(myGeneration)) process.exit(0);

  await sleep(Number.isFinite(settleMs) ? settleMs : 15_000);

  const record = readEditRecord(markerDir, file);
  const decision = decideReview({ record, myGeneration, now: Date.now(), maxMs });
  if (!decision.review) process.exit(0);

  // Advance the burst marker so the next edit starts a fresh burst. The actual
  // concurrency claim is the inflight lock acquired by the forced-sync hook.
  markReviewed(markerDir, file, myGeneration);

  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: tool,
    tool_input: { file_path: file },
    session_id: process.env.CP_SESSION_ID || "",
  });
  const codexTimeout = Number(process.env.ASK_CODEX_TIMEOUT_MS ?? 800_000);
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    input: payload,
    cwd: markerDir,
    encoding: "utf-8",
    env: { ...process.env, CODEX_PAIR_FORCE_SYNC: "1" },
    timeout: codexTimeout + 60_000,
  });
  const message = extractSystemMessage(res.stdout);
  if (message) writePending(markerDir, file, message);
  process.exit(0);
}

main().catch(() => process.exit(0));
