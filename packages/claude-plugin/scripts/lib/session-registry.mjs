// Session-scoped marker registry (ADR-131, issue #209).
//
// The watch hook (PostToolUse) knows both the session_id and the EDITED repo's
// markerDir; the Stop / UserPromptSubmit hooks know only session_id + cwd. This
// registry bridges them: the watch hook records every project marker it touches
// this session, and the turn/prompt-scoped hooks read the set back so they drain
// + gate every repo active this session, not just cwd.
//
// Storage: <tmpdir>/codex-pair-sessions/<sha256(session)[:16]>/<sha256(marker)[:16]>.json
// One independent file per (session, project) — registration is a single
// idempotent write, so parallel watch fires for DIFFERENT repos never race
// (mirrors the per-file sharding of inflight/ and pending/, ADR-087/097).
//
// Zero workspace imports (marketplace git-subdir install has no node_modules).
// Every export is best-effort and MUST NOT throw (ADR-077).

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SESSION_REGISTRY_DIRNAME = "codex-pair-sessions";
export const SESSION_REGISTRY_TTL_MS = Number(
  process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS ?? 24 * 60 * 60 * 1000,
);

export const sessionRegistryRoot = () => join(tmpdir(), SESSION_REGISTRY_DIRNAME);

function hash16(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export const sessionDir = (sessionId) => join(sessionRegistryRoot(), hash16(sessionId));

const markerEntryPath = (sessionId, markerDir) =>
  join(sessionDir(sessionId), `${hash16(markerDir)}.json`);

// Record that `markerDir` saw activity in `sessionId`. Idempotent, best-effort.
// No-op when either argument is falsy (e.g. payload lacked session_id).
export function registerMarker(sessionId, markerDir) {
  if (!sessionId || !markerDir) return;
  try {
    mkdirSync(sessionDir(sessionId), { recursive: true });
    // Overwrite is fine (idempotent) — a single write, no read-modify-write,
    // so concurrent registrations of DIFFERENT repos never clobber each other.
    writeFileSync(
      markerEntryPath(sessionId, markerDir),
      JSON.stringify({ markerDir, at: new Date().toISOString() }),
    );
  } catch {
    // best-effort (ADR-077) — a registry write failure must never affect review
  }
}

// Deduped set of markerDirs registered for `sessionId`. Tolerant of missing dir
// / malformed entries. Returns [] when sessionId is falsy. Runs a probabilistic
// TTL sweep (~5%) so a crash that skipped SessionEnd can't leak dirs forever.
export function readRegisteredMarkers(sessionId) {
  if (!sessionId) return [];
  const dir = sessionDir(sessionId);
  const markers = new Set();
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const { markerDir } = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (typeof markerDir === "string" && markerDir.length > 0) markers.add(markerDir);
    } catch {
      // skip malformed / vanished entry
    }
  }
  // Pass sessionId as exceptSessionId so a read NEVER sweeps its own live session
  // (a session idle >TTL since its last edit would otherwise erase its registry
  // mid-session and silently fall back to cwd-only — reopening the #209 gap).
  if (Math.random() < 0.05) sweepStaleSessions(Date.now(), SESSION_REGISTRY_TTL_MS, sessionId);
  return [...markers];
}

// The one place both drain hooks agree on "which markers to act on this turn":
// the cwd-resolved marker (may be null) unioned with the session-registered set.
export function collectSessionMarkers(cwdMarker, sessionId) {
  const set = new Set();
  if (cwdMarker) set.add(cwdMarker);
  for (const m of readRegisteredMarkers(sessionId)) set.add(m);
  return [...set];
}

// Drop the whole registry entry for a session (SessionEnd). Best-effort.
export function clearSession(sessionId) {
  if (!sessionId) return;
  try {
    rmSync(sessionDir(sessionId), { recursive: true, force: true });
  } catch {
    // already gone
  }
}

// Drop session dirs whose NEWEST entry mtime is older than ttlMs — a backstop
// for sessions whose SessionEnd never fired (crash). Skips `exceptSessionId` so a
// live session's own read can never sweep it. Best-effort; never throws.
export function sweepStaleSessions(now, ttlMs, exceptSessionId) {
  const skip = exceptSessionId ? hash16(exceptSessionId) : null;
  let sessions;
  try {
    sessions = readdirSync(sessionRegistryRoot());
  } catch {
    return;
  }
  const cutoff = now - ttlMs;
  for (const s of sessions) {
    if (s === skip) continue; // never sweep the live session that's reading us
    const sdir = join(sessionRegistryRoot(), s);
    try {
      let newest = 0;
      for (const name of readdirSync(sdir)) {
        try {
          newest = Math.max(newest, statSync(join(sdir, name)).mtimeMs);
        } catch {
          // entry vanished between readdir and stat
        }
      }
      if (newest < cutoff) rmSync(sdir, { recursive: true, force: true });
    } catch {
      // skip unreadable / racing session dir
    }
  }
}
