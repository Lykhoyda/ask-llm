# codex-pair edit-debounce — Design Spec (2026-06-03)

**Status:** 📋 Designed (brainstormed 2026-06-03, closes the last open item of #96). Not yet implemented.

**Goal:** Collapse a burst of rapid edits to the same file into a **single review of the settled state**, instead of reviewing every intermediate edit. Cuts Codex spend ~⅓ for typical "write → fix import → fix test" sequences and eliminates the false-alarm class from #96 Bug 2 (flagging a transient state that the very next edit corrects).

This implements the deferred enhancement tracked by **ADR-111** (debounce belongs in a process that outlives a single edit, not in the per-edit hook).

## Decisions (settled in brainstorming)

1. **Detached delayed-worker — no daemon.** Each edit hook spawns a cheap detached "sleeper" worker; only the *last* burst-edit's worker survives a supersede check and runs the review. Chosen over a plugin-owned coordinator daemon (too much new infra for an experimental, off-by-default broker) and over lazy next-edit coalescing (trailing edit never reviewed until an unrelated edit). Keeps debounce on the **default path** — it does **not** depend on `ASK_CODEX_BROKER=1`.
2. **Surface the deferred verdict on the next PostToolUse edit drain, with a `UserPromptSubmit` trailing drain.** The worker fires after the triggering hook has exited, so it has no stdout channel to Claude. It enqueues the verdict; the next `Edit|Write|MultiEdit` hook drains and emits it via `emitSystemMessage`. **Plan red-team refinement (2026-06-04):** because a single edit followed by no further edit would otherwise leave its (paid) review unsurfaced, a `UserPromptSubmit` hook also drains pending verdicts at the start of the next user turn — by which point the ~15s worker review has completed. `UserPromptSubmit` was chosen over `Stop` (fires before the review finishes) and avoids ADR-048's removed-Stop-hook baggage. Drains are idempotent (`drainPending` clears as it reads), so the two paths never double-surface.
3. **ON by default — 15s settle / 60s cap, configurable.** `debounceMs` defaults to `15000`, `debounceMaxMs` to `60000`, both overridable via marker frontmatter / env (same `frontmatter > env > default` precedence as `timeoutMs`). **`debounceMs <= 0` restores the v0.7.0 synchronous behavior** verbatim — the escape hatch and the regression anchor.
4. **Generation-counter supersede token.** A monotonically increasing per-file `generation` (not a `lastEditAt` timestamp) — collision-proof for same-millisecond `MultiEdit` bursts.
5. **Per-file JSON state files** under `.codex-pair/` (not a shared JSONL) — concurrent workers/hooks for *different* files never contend, and claim/cancel is a single atomic unlink.

## Why this is bounded

The expensive, fragile machinery already exists and is **reused unchanged**: `runCodexWithFallback` (cache → inflight-lock → broker/spawn → parse → log → cache → repetition shard), `buildVerdictMessage`, `emitSystemMessage`, the atomic-write helpers (ADR-091), and the TTL-sweep pattern (ADR-097). The detached `{detached:true}+unref()` spawn is already proven by `spawnBroker` (`broker-lifecycle.mjs:181`).

Net new surface is small: a timer worker, a per-file state module, a drain step + dispatch branch in the hook, and two config knobs. The hook's *review logic* is not rewritten — in debounce mode the hook becomes a **dispatcher + drainer** and the worker calls the existing review pipeline.

## Architecture

```
Edit N  (PostToolUse hook — short-lived)
  ├─ (a) DRAIN: emit any pending verdict from a prior settled review → emitSystemMessage
  ├─ (b) cheap gates (marker / inclusion-list / outside-tree / size / pause)   ← unchanged, still fast
  ├─ (c) bump per-file edit record { generation++, burstStartedAt, sessionId }
  └─ (d) spawn DETACHED worker(file, generation) → unref → exit 0              ← no review, no block

debounce worker  (detached — outlives the hook)
  ├─ sleep settleMs (default 15s)
  ├─ supersede check:  record.generation === myGeneration ?
  │      └─ NO → cap check: (now − burstStartedAt) ≥ maxMs (60s) ? proceed : exit silent
  ├─ CLAIM the burst (advance record.reviewedGen) so no sibling double-reviews
  ├─ run existing runCodexWithFallback pipeline on the SETTLED file state
  └─ ENQUEUE verdict into pending-surface store (worker has no stdout to Claude)
```

In debounce mode the hook stops running the review itself; the worker is the only thing that calls Codex.

### Components

| Component | Type | Responsibility |
|-----------|------|----------------|
| `scripts/codex-pair-watch.mjs` | **modified** | Add (a) drain-pending step at hook start; (b) `debounceMs` branch that dispatches to the worker. `debounceMs<=0` keeps the existing synchronous path byte-identical. On worker-spawn failure, fall back to a synchronous inline review (never silently lose a review). |
| `scripts/codex-pair-debounce-worker.mjs` | **new (detached)** | Sleep → supersede/cap check → claim → reuse `runCodexWithFallback` → write verdict to log+cache → enqueue pending-surface → clear record. Silent-on-error (ADR-077); exits 0 on every path. |
| `scripts/lib/debounce-state.mjs` | **new** | Per-file edit record (`.codex-pair/debounce/<hash(file)>.json`: `{ generation, burstStartedAt, reviewedGen, sessionId }`) + pending-surface store (`.codex-pair/pending/<hash(file)>.json`). Atomic read-modify-write (ADR-091 helpers) + TTL sweep of stale entries (ADR-097 pattern). |
| `scripts/codex-pair-session.mjs` | **modified** | `SessionEnd` clears `debounce/` + `pending/` dirs so orphaned sleepers self-cancel on wake. **This cleanup must run regardless of `ASK_CODEX_BROKER`** (debounce is not broker-gated). |
| `resolveConfig` (`codex-pair-watch.mjs:443`) + `codex-pair-defaults.json` | **modified** | Add `debounceMs` (default 15000) and `debounceMaxMs` (default 60000), same precedence chain as `timeoutMs`. |

## Data flow — burst of 3 edits to `device-list.ts`

```
Edit1 → record{gen:1, burstStart:T0} → worker#1(gen1)
Edit2 → record{gen:2}                → worker#2(gen2)
Edit3 → record{gen:3}                → worker#3(gen3)
worker#1 wakes T0+15s → gen 3≠1 → exit silent
worker#2 wakes        → gen 3≠2 → exit silent
worker#3 wakes        → gen 3==3 → CLAIM → review settled file → log+cache+pending
Edit4 (any file)      → hook drains pending(device-list.ts) → emitSystemMessage(verdict)
```

**3 edits → 1 review.** Intermediate states are never reviewed, so the #96 Bug 2 false-alarm class disappears.

### Max-cap (anti-starvation)

Without a cap, a steady stream (one edit every 14s) keeps incrementing `generation`, so every worker bows out and an actively-edited file is never reviewed. The cap forces a review when `(now − burstStartedAt) ≥ maxMs`: the waking worker proceeds *despite* a generation mismatch, claims the burst (resetting `burstStartedAt`), and the next edit starts a fresh burst. Net: a file under continuous editing is reviewed at least every ~60s.

### Claim (anti-double-review)

When a worker decides to proceed (latest-gen **or** cap), it first atomically advances `record.reviewedGen` to its generation. Any later-waking sibling whose `reviewedGen >= myGeneration` exits. The existing inflight-lock (`:1051`) remains the final concurrency backstop.

## Interaction with existing machinery (kept, not replaced)

- **Inflight-lock (`:1051`)** — concurrency backstop. If a worker's review is still running when a later burst's worker claims, the later one coalesce-skips (rare under debounce; logged).
- **Cache** — unchanged. The worker's review does the cache lookup first; undo/redo to a previously-reviewed state is a cache hit (no spend).
- **Repetition shard / surfaceThreshold / verdict message** — reused via `runCodexWithFallback` + `buildVerdictMessage`.

## Error handling (ADR-077 silent-on-error throughout)

- **Worker spawn fails** → hook performs a synchronous inline review for that edit (safety net).
- **Worker crashes mid-sleep / session ends** → SessionEnd unlinked its record; on wake the worker sees a missing/superseded record → exits. Records older than `maxMs + buffer` are swept.
- **Pending verdict drained late** → surfaced on whichever fires first: the next PostToolUse edit drain or the `UserPromptSubmit` drain at the start of the next user turn. Only if the session ends with no further edit *and* no further prompt does a verdict stay log-only (audit trail) — a genuinely terminal turn, where surfacing has no consumer anyway.

## Testing (TDD + live smoke)

- **Unit** (`codex-pair-debounce-worker.test.ts` + additions to `codex-pair-watch.test.ts`):
  - supersede-exits (stale generation → no review)
  - latest-gen-reviews
  - cap-overrides-supersede (proceeds when burst exceeds `maxMs`)
  - claim-prevents-double-review (concurrent latest + cap)
  - drain-emits-then-clears (and emits nothing when the store is empty)
  - **`debounceMs:0` → synchronous path byte-identical** (guards the v0.7.0 Bug 1 fix)
  - record read-modify-write atomicity
- **Fixture:** reuse the fake-codex fixture to drive worker reviews without real Codex.
- **Live smoke:** burst of 3 real edits → assert exactly 1 `concerns|none` review in the log + verdict surfaces on the 4th edit.

## Out of scope (v1)

- Cross-file batching / a single combined review of several files (per-file debounce only).
- A long-lived coordinator daemon (ADR-111's "true broker" path — explicitly deferred).
- Surfacing a trailing verdict via a `Stop` hook (the `UserPromptSubmit` drain in decision 2 covers the trailing case with better timing).

## Config reference

| Key | Default | Meaning |
|-----|---------|---------|
| `debounceMs` | `15000` | Settle window; reset on each edit. `<= 0` disables debounce (synchronous review, v0.7.0 behavior). |
| `debounceMaxMs` | `60000` | Hard cap from the first edit of a burst; forces a review even under a steady edit stream. |
