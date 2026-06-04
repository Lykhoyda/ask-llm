#!/usr/bin/env node
// UserPromptSubmit drain hook (design 2026-06-03 + plan red-team 2026-06-04).
//
// Surfaces any verdict a debounce worker queued, at the START of the next user
// turn — closing the gap where a single edit (with no following edit) leaves
// its review in the log but never in Claude's context. Cheap no-op when nothing
// is pending. MUST exit 0 on every path (ADR-077).
//
// findMarkerUp is duplicated from codex-pair-watch/session.mjs by design:
// zero-workspace-imports (marketplace git-subdir install has no node_modules)
// and the helper is too small to extract (15 LOC).

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONTEXT_FILENAME, PAIR_ROOT_DIR } from "./lib/state.mjs";
import { drainPending, joinPendingForSurface } from "./lib/debounce-state.mjs";

const MARKER_FILE = join(PAIR_ROOT_DIR, CONTEXT_FILENAME);

async function findMarkerUp(startDir) {
  const home = homedir();
  let current = resolve(startDir);
  for (let depth = 0; depth < 20; depth++) {
    try {
      await access(join(current, MARKER_FILE));
      return current;
    } catch {
      // not here
    }
    const parent = dirname(current);
    if (parent === current || current === home) return null;
    current = parent;
  }
  return null;
}

async function readStdin() {
  return new Promise((r) => {
    let data = "";
    process.stdin.on("data", (c) => {
      data += c.toString();
    });
    process.stdin.on("end", () => r(data));
    process.stdin.on("error", () => r(""));
  });
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (payload?.hook_event_name !== "UserPromptSubmit") process.exit(0);

  const markerDir = await findMarkerUp(process.cwd());
  if (!markerDir) process.exit(0);

  const messages = drainPending(markerDir);
  if (messages.length === 0) process.exit(0);

  // UserPromptSubmit context-injection contract: additionalContext is added to
  // the model's context for the upcoming turn.
  const out = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: joinPendingForSurface(messages),
    },
  });
  process.stdout.write(`${out}\n`, () => process.exit(0));
}

main().catch(() => process.exit(0));
