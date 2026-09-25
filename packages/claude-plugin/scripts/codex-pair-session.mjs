#!/usr/bin/env node
// Session lifecycle hook. Broker failures must not break per-edit reviews.

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { clearAllDebounceState } from "./lib/debounce-state.mjs";
import { clearSession } from "./lib/session-registry.mjs";
import {
  appendLog,
  CONTEXT_FILENAME,
  clearAutoPause,
  PAIR_ROOT_DIR,
  readPauseInfo,
  readPluginVersion,
  resolveAutoResume,
} from "./lib/state.mjs";

const MARKER_FILE = join(PAIR_ROOT_DIR, CONTEXT_FILENAME);

// Walk up from startDir looking for `.codex-pair/context.md`. Returns
// the marker directory (the directory CONTAINING `.codex-pair/`) or
// null. Mirrors codex-pair-watch.mjs and codex-pair-log.mjs — duplicated
// because zero-workspace-imports + the helper is too small to extract
// (15 LOC × 3 callers).
async function findMarkerUp(startDir) {
  const home = homedir();
  let current = resolve(startDir);
  for (let depth = 0; depth < 20; depth++) {
    const candidate = join(current, MARKER_FILE);
    try {
      await access(candidate);
      return current;
    } catch {
      // not found here
    }
    const parent = dirname(current);
    if (parent === current) return null;
    if (current === home) return null;
    current = parent;
  }
  return null;
}

async function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (c) => {
      data += c.toString();
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

// Broker modules are TypeScript run by Node type stripping; without it the broker is unavailable.
async function loadBroker() {
  try {
    const [broker, lifecycle] = await Promise.all([import("./lib/broker.ts"), import("./lib/broker-lifecycle.ts")]);
    return { ...broker, ...lifecycle };
  } catch {
    return null;
  }
}

async function handleSessionStart(broker, sessionId) {
  const cwd = process.cwd();
  const markerDir = await findMarkerUp(cwd);
  if (!markerDir) return; // no opt-in marker, nothing to do
  if (!sessionId) return;
  await broker.bootstrapBroker(markerDir, { sessionId });
}

async function handleSessionEnd(broker, sessionId) {
  const cwd = process.cwd();
  const markerDir = await findMarkerUp(cwd);
  if (!markerDir) return;
  // teardownBroker reads the descriptor, SIGTERMs the pid with a grace
  // window, escalates to SIGKILL via terminateProcessTree if needed,
  // unlinks the descriptor + socket + lock. Returns the descriptor
  // that was torn down (or null if none existed) — we ignore it; the
  // hook just needs to exit 0 either way per ADR-077.
  await broker.teardownBroker(markerDir, { sessionId });
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }

  const event = payload?.hook_event_name;
  if (event !== "SessionStart" && event !== "SessionEnd") {
    process.exit(0);
  }

  // SessionStart pause visibility (2026-07-02 seamless-pairing design; un-gated
  // by the broker flag). An auto-pause used to be notify-ONCE and manual-resume-
  // only — miss that single message and pairing is silently dead forever (the
  // dogfood repo spent 18 days that way). Now: an expired auto-pause self-heals
  // right here; a still-active pause gets a reminder the model actually sees
  // (SessionStart supports additionalContext; it does NOT support systemMessage).
  if (event === "SessionStart") {
    try {
      const markerDir = await findMarkerUp(process.cwd());
      const pauseInfo = markerDir ? readPauseInfo(markerDir) : null;
      if (pauseInfo) {
        const decision = resolveAutoResume(pauseInfo, {
          now: Date.now(),
          currentVersion: readPluginVersion(),
        });
        let context = null;
        // clearAutoPause aborts (false) when the sentinel changed since we
        // read it — either a concurrent SessionStart already resumed (sentinel
        // gone → say nothing; reviews are live) or a new pause raced in
        // (render the reminder from CURRENT state, not the stale pauseInfo).
        if (decision.resume && clearAutoPause(markerDir, pauseInfo)) {
          await appendLog(markerDir, {
            timestamp: new Date().toISOString(),
            verdict: "auto_resumed",
            reason: `${decision.why} (paused ${pauseInfo.at ?? "unknown"}, kind: ${pauseInfo.kind})`,
          });
          context = `codex-pair auto-resumed (${decision.why}): was ${pauseInfo.kind}-paused since ${pauseInfo.at ?? "unknown"}. Reviews are live again.`;
        } else {
          const current = decision.resume ? readPauseInfo(markerDir) : pauseInfo;
          if (current) {
            const since = current.manual ? "" : ` since ${current.at}`;
            const kind = current.manual ? "manually" : `auto (${current.kind})`;
            const reason = current.manual ? "" : ` Reason: ${current.reason}.`;
            context = `codex-pair is paused — ${kind}${since}.${reason} Edits are NOT being reviewed. Resume with /codex-pair-resume.`;
          }
        }
        if (context) {
          await new Promise((resolveWrite) => {
            const out = JSON.stringify({
              hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
            });
            process.stdout.write(`${out}\n`, () => resolveWrite());
          });
        }
      }
    } catch {
      // best-effort (ADR-077) — pause visibility must never break the session
    }
  }

  // Edit-debounce cleanup runs on SessionEnd only (un-gated by the broker flag,
  // since debounce is not broker-gated): a sleeping worker wakes to a missing
  // record and self-cancels. NOT on SessionStart — that would wipe a verdict
  // queued just before a new session begins; crash-orphaned state is reclaimed
  // by the TTL sweep (sweepStaleDebounce) instead.
  if (event === "SessionEnd") {
    const dbMarkerDir = await findMarkerUp(process.cwd());
    if (dbMarkerDir) {
      try {
        clearAllDebounceState(dbMarkerDir);
      } catch {
        // best-effort (ADR-077)
      }
    }
    // ADR-131 (#209): drop this session's cross-repo marker registry. Keyed by
    // session_id, not cwd — so it cleans up regardless of which repo cwd is.
    try {
      clearSession(payload?.session_id);
    } catch {
      // best-effort (ADR-077)
    }
  }

  const brokerMarkerDir = await findMarkerUp(process.cwd());
  if (!brokerMarkerDir) process.exit(0);
  const broker = await loadBroker();
  if (!broker || (event === "SessionStart" && !broker.resolveBrokerPreference(brokerMarkerDir))) process.exit(0);

  try {
    if (event === "SessionStart") await handleSessionStart(broker, payload.session_id);
    else if (event === "SessionEnd") await handleSessionEnd(broker, payload.session_id);
  } catch {
    // ADR-077 silent-on-error: a failed bootstrap MUST NOT break the
    // session. bootstrapBroker already catches internally, but defense
    // in depth.
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
