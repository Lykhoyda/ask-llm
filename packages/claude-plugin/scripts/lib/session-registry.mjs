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

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SESSION_REGISTRY_DIRNAME = "codex-pair-sessions";
// 7-day default. The sweep only reclaims crash-orphaned dirs (SessionEnd clears
// them normally), so a long TTL is cheap — and it shrinks the window in which one
// session's sweep could delete a *concurrent* live-but-idle session's registry
// (see the accepted-limitation note in ADR-131; the case self-corrects on that
// session's next edit). Override via CODEX_PAIR_SESSION_REGISTRY_TTL_MS.
const DEFAULT_SESSION_REGISTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Guard a non-numeric env override: Number("nope") is NaN, which would make
// sweepStaleSessions' `newest < (now - NaN)` always false and silently disable
// the sweep (slow tmpdir leak). Mirrors the stop-gate's inflightFreshMs guard.
const ttlOverride = Number(process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS);
export const SESSION_REGISTRY_TTL_MS =
  Number.isFinite(ttlOverride) && ttlOverride > 0 ? ttlOverride : DEFAULT_SESSION_REGISTRY_TTL_MS;

// Registry root: always `<base>/codex-pair-sessions`, where <base> is
// CODEX_PAIR_SESSION_REGISTRY_ROOT (tests point it at an isolated fixture dir;
// containerized setups relocate it) or os.tmpdir() by default. The env var is a
// BASE dir, never used raw as the sweep root — sweepStaleSessions rmSyncs stale
// child dirs, so pointing the root straight at /tmp, $HOME, or a repo would let
// it delete unrelated data. Appending the dedicated SESSION_REGISTRY_DIRNAME
// confines every sweep to a codex-pair-owned subdir it can't escape.
export const sessionRegistryRoot = () =>
  join(process.env.CODEX_PAIR_SESSION_REGISTRY_ROOT || tmpdir(), SESSION_REGISTRY_DIRNAME);

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
    const p = markerEntryPath(sessionId, markerDir);
    // Atomic tmp+rename (ADR-086/091, matching state.mjs/debounce-state.mjs): a
    // plain writeFileSync truncates the target before the new bytes are durable,
    // so an interrupted write or a concurrent readRegisteredMarkers could see an
    // empty/partial JSON file — which readRegisteredMarkers skips as malformed,
    // silently dropping that repo from the session set (the exact gap this
    // registry closes). rename is atomic, so readers see old-or-new, never torn.
    // Overwrite is idempotent; per-(session,project) files mean concurrent
    // registrations of DIFFERENT repos never clobber each other.
    const tmp = `${p}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ markerDir, at: new Date().toISOString() }));
    renameSync(tmp, p);
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
      const names = readdirSync(sdir);
      // An EMPTY dir is either mid-registration (a concurrent registerMarker
      // caught between its mkdirSync and its first writeFileSync) or a transient
      // leftover — never sweep it, or we'd delete the dir out from under that
      // pending write and lose the marker (the write ENOENTs and best-effort-
      // swallows). Non-empty dirs age out by their newest entry mtime.
      if (names.length === 0) continue;
      let newest = 0;
      for (const name of names) {
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
