# codex-pair: cross-repo Stop drain + gate (issue #209)

**Date:** 2026-07-03
**Issue:** [#209](https://github.com/Lykhoyda/ask-llm/issues/209) — codex-pair: Stop-hook drain and gate only see the cwd project
**ADR:** ADR-131 (extends ADR-130 seamless-pairing Stop drain; shares the cwd-anchoring of the ADR-118 gate)
**Package:** `@ask-llm/plugin` (`packages/claude-plugin`)
**Kano:** must-be · **Effort:** m

## Problem

In a multi-repo Claude Code session — cwd is repo **A**, but an `Edit`/`Write`/`MultiEdit`
touches repo **B** — the watch hook (`codex-pair-watch.mjs`) correctly anchors marker
resolution to the *edited file's* path (`dirname(filePath)`, per #65) and writes B's
debounce, pending, and pause state under `B/.codex-pair/`.

But the three turn/prompt/session-scoped hooks resolve their marker from
`process.cwd()` only:

| Hook | File | Anchor | Consequence for repo B |
|------|------|--------|------------------------|
| Stop gate | `codex-pair-stop-gate.mjs:172` | `findMarkerUp(process.cwd())` | B's queued verdicts never drain at turn-end; B's `blockOn:HIGH` gate + in-flight check never fire |
| Prompt drain | `codex-pair-prompt-drain.mjs:59` | `findMarkerUp(process.cwd())` | B's queued verdicts drain only on a later cwd-repo turn |
| Session | `codex-pair-session.mjs` | `findMarkerUp(process.cwd())` | B's SessionEnd cleanup / pause visibility skipped (out of scope — see below) |

The result is the exact "after Claude already said done" gap that ADR-130's Stop
drain closes for the cwd project — but silently left open for every non-cwd project.

**Why this is structural, not a regression:** `Stop`, `UserPromptSubmit`,
`SessionStart`, and `SessionEnd` hook events carry **no file paths**, so they have
nothing to anchor to except cwd. ADR-130 did not introduce this — it inherited the
same cwd anchoring the ADR-118 gate and the original UserPromptSubmit drain already had.

**Why it's a `must-be`:** the gate's entire value proposition is "no unaddressed HIGH
finding survives past 'done'." A silent per-repo skip gives users *less* safety than
they believe they have — a silent failure in a trust feature.

## Approach

**Chosen: a session-scoped marker registry (issue Option 1).**

The watch hook is the only hook that knows *both* the `session_id` (payload field) and
the edited repo's `markerDir`. On each fire it records "this project saw activity in
this session" into a global index under `os.tmpdir()`, keyed by `session_id`. The Stop
and prompt hooks read that index for their own `session_id` and drain/gate **every**
registered marker, unioned with the cwd-anchored marker for safety.

### Rejected alternatives

- **Option 2 — parse `transcript_path`.** The Stop payload carries `transcript_path`;
  we could parse it for edited-file paths and resolve each to a marker. Rejected:
  couples to Claude Code's transcript JSON format (not a stable contract), re-reads a
  potentially large file on every turn-end, and is heavier to test. The issue itself
  flags it as the heavier option.
- **Option 3 — document only.** Unacceptable for a must-be correctness gap.

### Why Option 1 fits the codebase

Per-project state already shards into **one independent file per entity**
(`pending/<hash>.json`, `inflight/<hash>`, `debounce/<hash>.json`,
`repetitions/<hash>.json`) precisely to avoid read-modify-write races under concurrent
hook fires (ADR-087/097). The registry mirrors that pattern exactly: one file per
`(session, project)` pair, so concurrent registrations from parallel edits never race.

## Storage layout

```
$TMPDIR/codex-pair-sessions/<sha256(session_id)[:16]>/<sha256(markerDir)[:16]>.json
    → { "markerDir": "/abs/path/to/repo", "at": "2026-07-03T…Z" }
```

- One directory per session, one file per registered project marker.
- **Registration** = a single idempotent `writeFileSync` (overwrite is fine; no
  read-modify-write, so parallel watch-hook fires for different repos never lose
  entries). Mirrors `tryAcquireInflightLock`'s per-file write.
- **Read** = `readdirSync` the session dir, parse each entry, collect `markerDir`s.
  Malformed/vanished entries are skipped (tolerant reads, per ADR-077).
- Directory perms follow the existing `mkdirSync(..., { recursive: true })` convention
  used by the other tmp/state stores.

## New module: `scripts/lib/session-registry.mjs`

Zero workspace imports (marketplace git-subdir install has no `node_modules`), mirroring
`lib/state.mjs` / `lib/debounce-state.mjs`. Exports:

- `sessionRegistryRoot()` → `join(os.tmpdir(), "codex-pair-sessions")`
- `sessionDir(sessionId)` → hashed session subdir
- `registerMarker(sessionId, markerDir)` — idempotent per-entry write; best-effort
  (never throws). No-op when `sessionId` is falsy.
- `readRegisteredMarkers(sessionId)` → `string[]` of markerDirs (deduped, tolerant).
  Returns `[]` when `sessionId` is falsy or the dir is missing.
- `clearSession(sessionId)` — remove the session's registry dir (SessionEnd).
- `sweepStaleSessions(now, ttlMs)` — drop session dirs whose newest entry mtime is older
  than `ttlMs`. TTL default 24h (`CODEX_PAIR_SESSION_REGISTRY_TTL_MS`). Called
  probabilistically (~5%) from `readRegisteredMarkers` so a crash that skips SessionEnd
  can't leak session dirs forever. Best-effort; never throws.

## Changes to existing hooks

### `codex-pair-watch.mjs`
Immediately after `markerDir` resolves (line ~1001, `if (!markerDir) process.exit(0)`):
```js
registerMarker(payload?.session_id, markerDir);
```
Placed there so *any* edit in a marker-enabled repo registers it — even if the file is
later skipped/ignored, the repo may still hold earlier HIGH findings the gate must see.
Best-effort; a registry write failure must not affect the review path.

### `codex-pair-prompt-drain.mjs`
Replace the single-marker drain with a union:
```js
const cwdMarker = await findMarkerUp(process.cwd());          // may be null
const registered = readRegisteredMarkers(payload?.session_id); // [] if no session_id
const markers = dedupe([cwdMarker, ...registered].filter(Boolean));
const messages = markers.flatMap((m) => drainPending(m));
```
Surface `joinPendingForSurface(messages)` exactly as today. No `session_id` and no cwd
marker → same silent no-op as today.

### `codex-pair-stop-gate.mjs`
Extract today's inline single-marker logic (drain → read `blockOn` → collect in-flight →
collect blocking HIGHs → decide) into a pure-ish helper:
```js
function evaluateMarker(markerDir) → { pendingText, blocked, blockReason }
```
`main()` then:
1. Builds `markers = dedupe([findMarkerUp(cwd), ...readRegisteredMarkers(session_id)])`.
2. Runs `evaluateMarker` per marker. Each repo keeps its **own** `blockOn`/`timeoutMs`
   (read from that repo's `context.md`), so a repo that didn't opt into `blockOn:HIGH`
   still only contributes drained pending text, never a block.
3. Aggregates: **block if any marker blocks**; the block `reason` concatenates every
   blocking marker's message plus all pending text. If nothing blocks but pending text
   exists, emit it as non-blocking `Stop` `additionalContext` (today's behavior).
4. Preserves every existing invariant: `stop_hook_active` short-circuit, exit-0-on-every-
   path, fail-open-and-loud, per-marker realpath canonicalization for git/log alignment.

### `codex-pair-session.mjs`
`handleSessionEnd` (and the un-gated SessionEnd branch) additionally call
`clearSession(payload?.session_id)` so the registry entry is dropped at session end.
**Out of scope (deferred):** extending SessionEnd `clearAllDebounceState`, SessionStart
pause-visibility, and broker bootstrap/teardown to every registered marker. The broker is
env-gated (`ASK_CODEX_BROKER`, off by default), and debounce cleanup already self-heals
via the TTL sweep; these are follow-ups, tracked as a note on #209, not part of this fix.

## Degradation & safety

- **No `session_id` on payload:** `readRegisteredMarkers` returns `[]`, so every hook
  falls back to today's exact cwd-only behavior. Blast radius is confined to multi-repo
  sessions with a present `session_id` (the real Claude Code case).
- **Registry unavailable (tmp write fails):** registration is best-effort; the gate still
  sees the cwd marker. Worst case is the pre-fix behavior — never worse.
- **Every hook still exits 0 on every path** (ADR-077); the registry helpers never throw.

## Testing

- **`session-registry.test.ts`** (new): register/read round-trip; idempotent re-register;
  dedupe; falsy `sessionId` → no-op / `[]`; malformed entry tolerated; `clearSession`;
  `sweepStaleSessions` drops only stale dirs.
- **`stop-gate.test.ts`** (extend): with a registered second marker B holding a pending
  verdict and/or an unacked HIGH under `blockOn:HIGH`, a Stop fired from cwd=A **drains
  B's pending** and **blocks on B's HIGH**; existing single-repo cases unchanged; no
  `session_id` → cwd-only behavior unchanged. Test payloads must now include `session_id`
  (current fixtures omit it) and register B via the registry helper before firing.
- **`codex-pair-prompt-drain.test.ts`** (extend): registered marker B's pending drains on
  a UserPromptSubmit fired from cwd=A; no-session fallback unchanged.
- **`codex-pair-watch.test.ts`** (extend): a watched edit registers its markerDir under the
  payload's `session_id`.

## Rollout artifacts

- **ADR-131** in `docs/DECISIONS.md` — records the session-registry decision, the rejected
  alternatives, and the deferred-scope boundary.
- **Changeset** for `@ask-llm/plugin` (plugin-only change; `scripts/` is not
  `packages/shared/src/`, so the 5-MCP shared-changeset guard does not apply).
- **ROADMAP.md** run-log entry; **#209** updated with the deferred-scope note.
- No docs-site or Postman changes (no MCP tool/endpoint surface touched).

## Non-goals

- Cross-repo broker lifecycle and pause-visibility (deferred, see above).
- Changing marker resolution for the watch hook (already correct per #65).
- Any change to the single-repo happy path's observable behavior.
