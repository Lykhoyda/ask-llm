// Durable hook state: cache, log, pause sentinel, inflight lock (extracted
// from codex-pair-watch.mjs per ADR-088, originally ADR-079/082/085/086/087).
//
// ADR-092: all hook state nests under <markerDir>/.codex-pair/:
//   .codex-pair/context.md         — marker + project context
//   .codex-pair/log.jsonl          — durable verdicts log
//   .codex-pair/ignore             — gitignore-style globs (ADR-081)
//   .codex-pair/cache/             — content-hash response cache (ADR-082)
//   .codex-pair/state/paused       — pause sentinel (ADR-085)
//   .codex-pair/state/inflight/    — per-file locks (ADR-087)
//
// Atomic-write semantics per ADR-086/091: cache writes use tmp+rename;
// log entries are clamped under PIPE_BUF for atomic appendFile O_APPEND;
// log rotation uses a PID-scoped tmp; inflight-lock recovery uses an
// identity-snapshot recheck.

import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

// ADR-092 unified layout — everything lives under PAIR_ROOT_DIR.
export const PAIR_ROOT_DIR = ".codex-pair";
export const CONTEXT_FILENAME = "context.md";
export const IGNORE_FILENAME = "ignore";
export const LOG_FILENAME = "log.jsonl";
export const MAX_LOG_BYTES = Number(process.env.CODEX_PAIR_MAX_LOG_BYTES ?? 2_000_000);
export const MAX_LOG_ENTRIES = 1000;
export const MAX_LOG_REASON_BYTES = 3500;

export const CACHE_DIR = "cache";
export const CACHE_TTL_MS = 10 * 60 * 1000;
export const CACHE_MAX_ENTRIES = 50;

export const STATE_DIR = "state";
export const PAUSE_SENTINEL_FILE = "paused";

export const INFLIGHT_DIR = "inflight";
export const INFLIGHT_TTL_MIN_MS = 600_000;

// ADR-096: codex-pair UX improvements.
// `.codex-pair/include` (optional inclusion-list, mirror of `.codex-pair/ignore`):
//   when present + non-empty, ONLY files matching at least one glob are
//   reviewed. Lets users scope codex-pair to high-stakes paths (e.g.
//   src/billing/**) and avoid paying $0.05/edit on routine refactor code.
//   Applied BEFORE the existing ignore-list — include-list narrows; ignore
//   excludes from the narrowed set.
// `.codex-pair/state/repetitions.json` (repetition-detector state):
//   tracks { file, contentHash } → consecutive-flag count. When a concern
//   reaches REPETITION_BLOCKING_THRESHOLD without being fixed, the hook
//   prefixes the systemMessage with a loud BLOCKING marker so the
//   consumer (Claude or human) can't ignore it again silently.
export const INCLUDE_FILENAME = "include";
// ADR-097 (ADR-096 hotfix): repetitions sharded per-file at
// `.codex-pair/state/repetitions/<sha256(file)[0:16]>.json` to eliminate
// the cross-file TOCTOU race that both /multi-review reviewers caught
// on ADR-096 (Gemini conf 95, Codex conf 88). Each shard's read-modify-
// write cycle is naturally serialized by ADR-087's per-file inflight
// lock; cross-file edits no longer share a serialization root.
export const REPETITIONS_FILENAME = "repetitions.json"; // legacy singleton (v1) — unused; left for reference
export const REPETITIONS_SHARDS_DIR = "repetitions";
export const REPETITION_BLOCKING_THRESHOLD = 3;
export const REPETITIONS_SHARD_SCHEMA_VERSION = 2;
// 30-day TTL on shard files. Sweep runs probabilistically on update
// (5% per call) so abandoned files don't accumulate state forever.
export const REPETITIONS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Path resolvers — single source of truth for every state-file location.
// The hook never hard-codes these strings; it routes through these helpers.
export const pairRoot = (markerDir) => join(markerDir, PAIR_ROOT_DIR);
export const contextPath = (markerDir) => join(pairRoot(markerDir), CONTEXT_FILENAME);
export const ignorePath = (markerDir) => join(pairRoot(markerDir), IGNORE_FILENAME);
export const logPath = (markerDir) => join(pairRoot(markerDir), LOG_FILENAME);
export const cacheRoot = (markerDir) => join(pairRoot(markerDir), CACHE_DIR);
export const stateRoot = (markerDir) => join(pairRoot(markerDir), STATE_DIR);
export const pausePath = (markerDir) => join(stateRoot(markerDir), PAUSE_SENTINEL_FILE);
export const inflightRoot = (markerDir) => join(stateRoot(markerDir), INFLIGHT_DIR);

export const ACKS_FILENAME = "acks.json";
export const acksPath = (markerDir) => join(stateRoot(markerDir), ACKS_FILENAME);

export function readAcks(markerDir) {
  try {
    return JSON.parse(readFileSync(acksPath(markerDir), "utf8"));
  } catch {
    return {}; // missing/corrupt → no acks
  }
}

// Append-merge a single ack. Best-effort; the slash command surfaces failures.
// Atomic tmp+rename so a kill mid-write can't corrupt/truncate acks.json
// (readAcks fails-open on a partial read, but rename keeps the file consistent).
export function addAck(markerDir, hash, { reason }) {
  const acks = readAcks(markerDir);
  acks[hash] = { reason, ts: new Date().toISOString() };
  mkdirSync(stateRoot(markerDir), { recursive: true });
  const path = acksPath(markerDir);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(acks, null, 2)}\n`);
  renameSync(tmp, path);
}
// ADR-096: include-list + repetitions resolvers
export const includePath = (markerDir) => join(pairRoot(markerDir), INCLUDE_FILENAME);
// Legacy v1 singleton path — kept for the one-time cleanup of pre-hotfix
// shard files. Production code uses repetitionsShardPath() (v2 sharded).
export const repetitionsPath = (markerDir) => join(stateRoot(markerDir), REPETITIONS_FILENAME);
// ADR-097: per-file shard layout.
export const repetitionsShardsRoot = (markerDir) => join(stateRoot(markerDir), REPETITIONS_SHARDS_DIR);
export function repetitionsShardPath(markerDir, file) {
  const hash = createHash("sha256").update(String(file)).digest("hex").slice(0, 16);
  return join(repetitionsShardsRoot(markerDir), hash + ".json");
}

// ── Pause sentinel (ADR-085, paths consolidated per ADR-092) ─────────────
export function isPaused(markerDir) {
  try {
    statSync(pausePath(markerDir));
    return true;
  } catch {
    return false;
  }
}

// ── Auto-pause (#176 / ADR-120) ───────────────────────────────────────────
// The hook can pause ITSELF: on provider quota exhaustion, or after
// AUTOPAUSE_FAILURE_THRESHOLD consecutive review failures of any kind.
// Same sentinel file as the manual /codex-pair-pause skill — an EMPTY file
// is a manual pause; a JSON body is an auto-pause with provenance. Resume
// is always manual (/codex-pair-resume or rm); there is no expiry logic.

export const FAILURES_FILENAME = "failures.json";
export const AUTOPAUSE_FAILURE_THRESHOLD = 3;
export const failuresPath = (markerDir) => join(stateRoot(markerDir), FAILURES_FILENAME);

// Returns null (not paused), { manual: true } (empty or unrecognized body),
// or the parsed auto-pause JSON ({ v, kind, reason, resetHint?, at }).
// Unrecognized bodies are treated as manual — the conservative read: an
// unknown pause never auto-expires and never gets overwritten. A string
// reason is required too, so downstream provenance rendering never sees
// a non-string ("[object Object]") reason.
export function readPauseInfo(markerDir) {
  let raw;
  try {
    raw = readFileSync(pausePath(markerDir), "utf8");
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { manual: true };
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.kind === "quota" || parsed.kind === "failures") &&
      typeof parsed.reason === "string"
    ) {
      return parsed;
    }
  } catch {
    // fall through to manual
  }
  return { manual: true };
}

// Write the auto-pause sentinel. `flag: "wx"` makes this atomic-exclusive:
// an existing pause (manual OR auto, including a concurrent hook racing us)
// is never overwritten — we return false and the caller skips its
// notification, which is what makes "notify once" hold under concurrency.
export function writeAutoPause(markerDir, { kind, reason, resetHint }) {
  const body = JSON.stringify({
    v: 1,
    kind,
    reason: clampReason(typeof reason === "string" ? reason : String(reason)),
    ...(resetHint ? { resetHint } : {}),
    at: new Date().toISOString(),
  });
  try {
    mkdirSync(stateRoot(markerDir), { recursive: true });
    writeFileSync(pausePath(markerDir), body, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

// ── Consecutive-failure counter (#176 backstop) ──────────────────────────
// Global per project (markerDir), spans files and sessions. Incremented on
// every non-quota review failure; cleared on every successful live review.
// Tolerant reads (missing/corrupt → 0); atomic tmp+rename writes.
// Accepted race: this read-modify-write is global per project and NOT
// serialized by ADR-087's per-file inflight locks — two concurrent
// failures on different files can lose an increment. Accepted: the
// threshold just fires one failure later, and the eventual sentinel
// write is still wx-safe.

export function readFailureCount(markerDir) {
  try {
    const parsed = JSON.parse(readFileSync(failuresPath(markerDir), "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.consecutive === "number" && parsed.consecutive > 0) {
      return Math.floor(parsed.consecutive);
    }
  } catch {
    // missing/corrupt → 0
  }
  return 0;
}

export function recordReviewFailure(markerDir, reason) {
  const consecutive = readFailureCount(markerDir) + 1;
  const payload = {
    v: 1,
    consecutive,
    lastAt: new Date().toISOString(),
    lastReason: clampReason(typeof reason === "string" ? reason : String(reason)),
  };
  try {
    mkdirSync(stateRoot(markerDir), { recursive: true });
    const p = failuresPath(markerDir);
    const tmp = `${p}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, p);
  } catch {
    // best-effort — counter loss degrades to "pause later", never breaks the hook
  }
  return consecutive;
}

export function clearReviewFailures(markerDir) {
  try {
    unlinkSync(failuresPath(markerDir));
  } catch {
    // already clear
  }
}

// ── Inflight lock (ADR-087, paths consolidated per ADR-092) ──────────────
export function inflightLockPath(markerDir, filePath) {
  const hash = createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  return join(inflightRoot(markerDir), hash);
}

export function tryAcquireInflightLock(markerDir, filePath, ttlMs) {
  const lockPath = inflightLockPath(markerDir, filePath);
  try {
    mkdirSync(dirname(lockPath), { recursive: true });
  } catch {
    // mkdir failures fall through — writeFileSync below will report the real error
  }
  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return { acquired: true, lockPath };
  } catch (err) {
    if (!err || err.code !== "EEXIST") {
      return { acquired: false, lockPath, reason: "error" };
    }
  }
  // Lock exists. Multi-review (ADR-091) caught a TOCTOU: a blind
  // unlink-after-stat can delete a FRESH lock that another concurrent
  // process wrote between our stat and our unlink. Defense: capture an
  // identity snapshot (mtime + PID content) before deciding the lock is
  // stale, then re-verify the identity right before unlinking. If
  // anyone refreshed it, treat as in-flight.
  let snapshot;
  try {
    const stats = statSync(lockPath);
    if (Date.now() - stats.mtimeMs <= ttlMs) {
      return { acquired: false, lockPath, reason: "in-flight" };
    }
    snapshot = { mtimeMs: stats.mtimeMs, pid: readFileSync(lockPath, "utf8") };
  } catch {
    // Lock vanished between EEXIST and stat — retry the create
    try {
      writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return { acquired: true, lockPath, recoveredStale: true };
    } catch {
      return { acquired: false, lockPath, reason: "race" };
    }
  }
  // Re-verify identity right before unlinking; if mtime or PID changed,
  // another actor refreshed the lock and we must back off.
  try {
    const recheck = statSync(lockPath);
    const recheckPid = readFileSync(lockPath, "utf8");
    if (recheck.mtimeMs !== snapshot.mtimeMs || recheckPid !== snapshot.pid) {
      return { acquired: false, lockPath, reason: "in-flight" };
    }
  } catch {
    // Vanished between snapshot and recheck — fall through to retry create
  }
  try {
    unlinkSync(lockPath);
  } catch {
    // someone else already cleaned up — fine, fall through to retry
  }
  try {
    writeFileSync(lockPath, String(process.pid), { flag: "wx" });
    return { acquired: true, lockPath, recoveredStale: true };
  } catch {
    return { acquired: false, lockPath, reason: "race" };
  }
}

export function releaseInflightLock(lockPath) {
  if (!lockPath) return;
  try {
    unlinkSync(lockPath);
  } catch {
    // already gone — fine
  }
}

// ── Content-hash cache (ADR-082, atomic per ADR-086) ─────────────────────
export function computeCacheKey({ model, prompt, fileContent, surfaceThreshold }) {
  const h = createHash("sha256");
  h.update(model);
  h.update("\0");
  h.update(prompt);
  h.update("\0");
  h.update(fileContent);
  h.update("\0");
  h.update(surfaceThreshold);
  return h.digest("hex");
}

export function cachePathFor(markerDir, cacheKey) {
  return join(cacheRoot(markerDir), cacheKey.slice(0, 2), `${cacheKey.slice(2)}.json`);
}

export async function getCachedConcerns(markerDir, cacheKey) {
  const cachePath = cachePathFor(markerDir, cacheKey);
  try {
    const stats = await stat(cachePath);
    if (Date.now() - stats.mtimeMs > CACHE_TTL_MS) return null;
    const raw = await readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      !Array.isArray(parsed.high) ||
      !Array.isArray(parsed.med) ||
      !Array.isArray(parsed.low)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedConcerns(markerDir, cacheKey, value) {
  const cachePath = cachePathFor(markerDir, cacheKey);
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.tmp.${process.pid}`;
    await writeFile(tmpPath, JSON.stringify(value));
    await rename(tmpPath, cachePath);
  } catch {
    // intentional no-op — cache write failures must never break Claude's flow
  }
  await evictCacheOldest(markerDir);
}

export async function evictCacheOldest(markerDir) {
  try {
    const root = cacheRoot(markerDir);
    const entries = [];
    const prefixes = await readdir(root);
    for (const prefix of prefixes) {
      let files;
      try {
        files = await readdir(join(root, prefix));
      } catch {
        continue;
      }
      for (const file of files) {
        const full = join(root, prefix, file);
        try {
          const s = await stat(full);
          entries.push({ path: full, mtimeMs: s.mtimeMs });
        } catch {
          // skip unreadable entries
        }
      }
    }
    if (entries.length <= CACHE_MAX_ENTRIES) return;
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const drop = entries.slice(0, entries.length - CACHE_MAX_ENTRIES);
    for (const e of drop) {
      try {
        await unlink(e.path);
      } catch {
        // skip if already deleted by a concurrent run
      }
    }
  } catch {
    // intentional no-op — eviction is best-effort
  }
}

// ── Log (ADR-079 rotation + ADR-086 clamp + ADR-091 PID-scoped tmp) ──────
export async function rotateLogIfNeeded(targetLogPath) {
  try {
    const stats = await stat(targetLogPath);
    if (stats.size <= MAX_LOG_BYTES) return;
    const content = await readFile(targetLogPath, "utf8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    if (lines.length <= MAX_LOG_ENTRIES) return;
    const tail = lines.slice(-MAX_LOG_ENTRIES);
    // PID-scoped tmp prevents concurrent rotations from torn-writing the
    // same tmp file (ADR-091).
    const tmpPath = `${targetLogPath}.tmp.${process.pid}`;
    await writeFile(tmpPath, `${tail.join("\n")}\n`);
    await rename(tmpPath, targetLogPath);
  } catch {
    // intentional no-op — rotation is best-effort
  }
}

export function clampReason(reason) {
  if (typeof reason !== "string") return reason;
  // Use UTF-8 BYTE length, not JS char length — ADR-086's PIPE_BUF (4096)
  // atomicity contract is in bytes. Multi-review (ADR-091) flagged that
  // multibyte reasons (Cyrillic identifiers, em-dashes, accented filenames
  // in codex stderr) would slip past a char-count threshold.
  const byteLen = Buffer.byteLength(reason, "utf8");
  if (byteLen <= MAX_LOG_REASON_BYTES) return reason;
  // Slice the UTF-8 buffer, backing off any continuation bytes (high bits
  // 10xxxxxx) so we don't cut mid-codepoint and produce a U+FFFD.
  const buf = Buffer.from(reason, "utf8");
  let end = MAX_LOG_REASON_BYTES;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  const dropped = byteLen - end;
  return `${buf.subarray(0, end).toString("utf8")}…(${dropped}b truncated)`;
}

export async function appendLog(markerDir, entry) {
  const target = logPath(markerDir);
  // Ensure .codex-pair/ exists. The hook's main flow normally migrates
  // first, so this is a defensive belt — fresh installs hit it once.
  try {
    await mkdir(dirname(target), { recursive: true });
  } catch {
    // ignore — appendFile will surface the real failure
  }
  const safe = entry?.reason !== undefined ? { ...entry, reason: clampReason(entry.reason) } : entry;
  try {
    await appendFile(target, `${JSON.stringify(safe)}\n`);
  } catch {
    // logging failures must never break Claude's flow
    return;
  }
  await rotateLogIfNeeded(target);
}



// ADR-096 (sharded per ADR-097 hotfix): Repetition detector.
//
// Stores per-(file, concernHash) consecutive-flag counts so the hook can
// detect "this same concern has been flagged 3+ times and the consumer
// keeps ignoring it" and escalate the systemMessage with a 🛑 banner.
//
// Storage layout (v2): one shard file per reviewed file, at
//   `.codex-pair/state/repetitions/<sha256(file)[0:16]>.json`
// Shard schema: `{ v: 2, file, entries: [{hash, count, firstSeenAt, lastSeenAt}] }`
//
// Sharding (ADR-097 multi-review hotfix on ADR-096) eliminates the
// cross-file TOCTOU race: each shard's read-modify-write is naturally
// serialized by ADR-087's per-file inflight lock. The previous v1
// singleton design lost increments under concurrent edits on different
// files.
//
// `loadRepetitionsForFile`: read shard for a single file. Returns
// Map<hash, entry>. Tolerant of missing/malformed/wrong-version.
// `saveRepetitionsForFile`: atomic tmp+rename of one shard.
// `updateRepetitions`: increment-or-drop + save + return blocking
// entries (count >= REPETITION_BLOCKING_THRESHOLD).
// `getBlockingFromShard`: read-only — checks whether currently-cached
// concerns have already crossed threshold without incrementing (used
// by the cache-hit path to surface the banner without re-counting).
// `sweepStaleRepetitions`: drop shards older than REPETITIONS_TTL_MS.

export function hashConcernBody(body) {
  return createHash("sha256").update(String(body)).digest("hex").slice(0, 16);
}

export function loadRepetitionsForFile(markerDir, file) {
  const p = repetitionsShardPath(markerDir, file);
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return new Map();
    if (parsed.v !== REPETITIONS_SHARD_SCHEMA_VERSION) return new Map();
    if (!Array.isArray(parsed.entries)) return new Map();
    const map = new Map();
    for (const e of parsed.entries) {
      if (!e || typeof e !== "object") continue;
      if (typeof e.hash !== "string") continue;
      if (typeof e.count !== "number" || e.count <= 0) continue;
      map.set(e.hash, {
        hash: e.hash,
        count: e.count,
        firstSeenAt: e.firstSeenAt ?? new Date().toISOString(),
        lastSeenAt: e.lastSeenAt ?? new Date().toISOString(),
      });
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function saveRepetitionsForFile(markerDir, file, map) {
  const p = repetitionsShardPath(markerDir, file);
  const payload = {
    v: REPETITIONS_SHARD_SCHEMA_VERSION,
    file,
    entries: Array.from(map.values()),
  };
  try {
    await mkdir(dirname(p), { recursive: true });
    const tmp = p + ".tmp." + process.pid;
    await writeFile(tmp, JSON.stringify(payload));
    await rename(tmp, p);
  } catch {
    // best-effort — repetitions are advisory; failure must not break hook
  }
}

// Read-only check — used by the cache-hit path. Returns the subset of
// `newHashes` whose count already meets/exceeds the BLOCKING threshold.
// Does NOT mutate state, so rapid undo/redo producing cache hits won't
// increment counts (closes ADR-096 multi-review finding #3 — cache-hit
// double-count under content-identical re-saves).
export function getBlockingFromShard(markerDir, file, newHashes) {
  const map = loadRepetitionsForFile(markerDir, file);
  const blocking = [];
  for (const h of newHashes) {
    const e = map.get(h);
    if (e && e.count >= REPETITION_BLOCKING_THRESHOLD) {
      blocking.push({ file, hash: e.hash, count: e.count });
    }
  }
  return blocking;
}

// Update repetition state for a single file given the set of concern
// hashes from the just-completed LIVE review. (Cache-hit path uses
// `getBlockingFromShard` instead — read-only.) Returns blocking entries.
export async function updateRepetitions(markerDir, file, newHashes) {
  const map = loadRepetitionsForFile(markerDir, file);
  const newSet = new Set(newHashes);
  const now = new Date().toISOString();
  // Drop prior entries absent from new review (assumed fixed);
  // increment ones still flagged.
  for (const [hash, entry] of [...map.entries()]) {
    if (newSet.has(hash)) {
      entry.count += 1;
      entry.lastSeenAt = now;
      newSet.delete(hash);
    } else {
      map.delete(hash);
    }
  }
  // First-time-seen hashes
  for (const hash of newSet) {
    map.set(hash, { hash, count: 1, firstSeenAt: now, lastSeenAt: now });
  }
  await saveRepetitionsForFile(markerDir, file, map);
  // Probabilistic TTL sweep — 5% per update amortizes O(N_files) cost
  // without needing a dedicated SessionStart hook.
  if (Math.random() < 0.05) {
    sweepStaleRepetitions(markerDir).catch(() => {});
  }
  // Return entries at/over threshold
  const blocking = [];
  for (const entry of map.values()) {
    if (entry.count >= REPETITION_BLOCKING_THRESHOLD) {
      blocking.push({ file, hash: entry.hash, count: entry.count });
    }
  }
  return blocking;
}

// Drop shard files with mtime older than REPETITIONS_TTL_MS. Closes
// ADR-096 multi-review finding #2 (unbounded growth — entries leaked
// for files never re-reviewed). Runs probabilistically from
// updateRepetitions; best-effort, never throws.
export async function sweepStaleRepetitions(markerDir) {
  const root = repetitionsShardsRoot(markerDir);
  try {
    const files = await readdir(root);
    const cutoff = Date.now() - REPETITIONS_TTL_MS;
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const full = join(root, f);
      try {
        const s = await stat(full);
        if (s.mtimeMs < cutoff) await unlink(full);
      } catch {
        // skip unreadable / racing-unlink
      }
    }
  } catch {
    // shards dir doesn't exist yet — nothing to sweep
  }
}

// Backward-compat shims for the v1 singleton API. Used by tests that
// haven't migrated yet. New code should use the per-file shard helpers.
export function loadRepetitions(markerDir) {
  // v1 singleton is dead — return empty Map. Any v1 file is treated as
  // stale and ignored. The TTL sweep will not touch it (different path)
  // but it's small and harmless; documented as a known dangling artifact.
  // Tests that exercised v1 semantics need to migrate to loadRepetitionsForFile.
  void markerDir;
  return new Map();
}
export async function saveRepetitions(markerDir, map) {
  // v1 no-op. Documented as dead in ADR-097.
  void markerDir;
  void map;
}
