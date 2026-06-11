# codex-pair auto-pause on provider failure — design (#176)

**Date:** 2026-06-11
**Issue:** [#176](https://github.com/Lykhoyda/ask-llm/issues/176) — codex-pair: auto-pause on provider quota exhaustion instead of erroring on every edit
**Labels:** `kano:must-be`, `effort:m`
**ADR:** ADR-120 (to be written at implementation time)

## Problem

Once the Codex provider quota is exhausted, the codex-pair PostToolUse hook fails on
every Edit/Write for the rest of the session, surfacing an unhelpful error each time
(`review failed: Reading prompt from stdin...`). Each failed invocation burns hook
latency and adds transcript noise with zero review value, until the user diagnoses it
and manually runs `/codex-pair-pause`.

Two root causes, both verified in source:

1. **Classification bug** — `spawnCodex`'s non-zero-exit branch reports
   `stderr.trim()` only (`scripts/codex-pair-watch.mjs`, close handler). The codex CLI
   prints its `Reading prompt from stdin...` banner to stderr while the actual quota
   error is emitted as a JSONL `{"type":"error"}` event on **stdout**, which that
   branch discards. The user sees the banner, not the error.
2. **Signal gap** — `QUOTA_SIGNALS = ["rate_limit_exceeded", "quota_exceeded", "429",
   "insufficient_quota"]` matches API-style errors only. The ChatGPT-plan message
   "You've hit your usage limit" matches nothing, so quota exhaustion doesn't even
   trigger the existing gpt-5.5 → gpt-5.5-mini fallback — let alone any pause.

The plugin already has a pause mechanism (`.codex-pair/state/paused` sentinel, checked
by `isPaused()` at the top of `main()`); the hook just never invokes it itself.

## Decisions (settled in brainstorm)

| Question | Decision |
|---|---|
| Resume policy | **Manual only.** `/codex-pair-resume` (or `rm state/paused`) is the sole un-pause path. A pause is a pause — the user may have other reasons to stay paused. No expiry logic anywhere. |
| Sentinel | **Reuse `state/paused` with a JSON body.** Empty file = manual pause (existing skill, unchanged). JSON body = auto-pause with provenance. `isPaused()` stays an existence check. |
| Backstop | **3 consecutive non-quota failures → auto-pause.** Counter resets on any successful live review. Same manual-resume rule. |
| Approach | **A — extend existing modules.** Pause-state + counter helpers in `lib/state.mjs` (where `isPaused`/`pausePath` live); classification + catch-path wiring in `codex-pair-watch.mjs` (where `isQuotaError`/`QUOTA_SIGNALS` live). No new modules — follows the ADR-088 extraction layout. |

Key architectural fact: the debounce worker re-invokes `codex-pair-watch.mjs` in
forced-sync mode, so **every codex spawn funnels through `runCodexWithFallback()` +
`main()`'s catch** — one choke point for all policy.

## Design

### 1. Error classification

In `spawnCodex`'s `close` handler (non-zero exit), build the rejection reason from, in
order of preference:

```
lastJsonlErrorEvent(stdout) ?? stderrTail ?? `codex exit ${code}`
```

- Extract `{"type":"error"}` events from stdout JSONL (small helper reused/shared with
  `parseCodexJsonl`).
- `stderrTail` = the last non-empty line(s) of stderr, capped at 500 bytes (the quota
  line, when present, follows the stdin banner — the tail is the informative part;
  `clampReason` still applies downstream for log entries).
- Extend `QUOTA_SIGNALS` (lowercase substring matching, as today) with:
  `"you've hit your usage limit"`, `"usage limit"`, `"rate limit"`.
  This alone repairs the existing quota fallback for ChatGPT-plan errors.

### 2. Quota exhaustion → auto-pause

- `runCodexWithFallback`: when the **fallback model also** fails with a quota error
  (or `model === fallbackModel`), set `err.quotaExhausted = true` before propagating.
  Primary-only quota keeps today's behavior (silent fallback to mini).
- `main()` catch, when `err.quotaExhausted`:
  1. Write the auto-pause sentinel (§4) with `kind: "quota"`.
  2. Emit **one** systemMessage:
     `codex-pair auto-paused: provider quota exhausted (resets ~<hint>). Resume with /codex-pair-resume.`
     (reset-hint clause omitted when nothing parseable).
  3. Skip the regular per-edit error message — the pause notice replaces it.
- **Reset hint** is parsed best-effort from the error text (patterns like
  `try again in 3h 25m`, `try again at <time>`, `resets at <time>`) and is
  **display-only**. No timestamp math, no expiry.
- **Notify-once is structural:** once the sentinel exists, subsequent hook fires exit
  at the existing `isPaused` gate (log-only, no systemMessage).
- **Worker path needs no extra work:** in forced-sync mode the pause notice goes to
  the worker's captured stdout → `writePending` → surfaced on the next edit or
  UserPromptSubmit drain, exactly like review verdicts.

### 3. Backstop: consecutive-failure counter

- New state file `.codex-pair/state/failures.json`:
  `{ v: 1, consecutive: number, lastAt: ISO, lastReason: string }`.
  Atomic tmp+rename writes, tolerant reads (missing/corrupt → 0), consistent with all
  other state files.
- `lib/state.mjs` helpers:
  - `recordReviewFailure(markerDir, reason)` → increments, returns new count.
  - `clearReviewFailures(markerDir)` → resets to 0; called on every successful **live**
    review (cache hits don't touch the counter — they prove nothing about provider
    health and aren't failures).
- `main()` catch, when **not** `quotaExhausted`:
  - count = `recordReviewFailure(...)`.
  - count ≥ 3 → auto-pause with `kind: "failures"`, message:
    `codex-pair auto-paused after 3 consecutive review failures (last: <reason>). Resume with /codex-pair-resume.`
  - count 1–2 → today's error message, suffixed `(failure <n>/3 before auto-pause)`.
- Counter is **global per project** (markerDir), spanning files and sessions —
  matches the issue's "a broken provider never error-spams an entire session".
  All failure verdicts count: `timeout`, `spawn_failed`, `parse_failed`, `error`.
- Threshold constant `AUTOPAUSE_FAILURE_THRESHOLD = 3` in `lib/state.mjs`.

### 4. Sentinel format (backwards compatible)

- Path unchanged: `.codex-pair/state/paused`.
- Manual pause (existing `/codex-pair-pause` skill): empty file — **unchanged**.
- Auto-pause body:
  `{ "v": 1, "kind": "quota" | "failures", "reason": <clamped>, "resetHint"?: string, "at": ISO }`.
- Written with `flag: "wx"` — **never overwrites an existing pause**. A manual pause
  is never clobbered with auto provenance, and concurrent in-flight failures racing to
  pause dedupe naturally (EEXIST → skip the notification too).
- New `readPauseInfo(markerDir)` in `lib/state.mjs` → `null` (not paused),
  `{ manual: true }` (empty/unparseable body), or the parsed JSON. Used by:
  - the `isPaused` skip-log entry, so logs say *why* (`auto-paused: quota exhausted…`
    vs `paused via /codex-pair-pause`);
  - the `/codex-pair` dashboard and `/codex-pair-resume` skill docs (provenance shown
    when resuming).
- `/codex-pair-resume`'s `rm` flow works unchanged. Skill docs get a minor touch-up
  mentioning auto-pause; no behavioral change.

### 5. Out of scope

- Auto-resume of any kind (explicitly rejected — manual resume only).
- Widening the `VERDICT_PREFIXES` taxonomy (approach C, rejected).
- New `lib/auto-pause.mjs` module (approach B, rejected).
- Broker-path (`brokerFailure`) errors: these already fall back silently to the spawn
  path and never reach the user; they do not feed the failure counter.

## Error handling summary

| Failure | Today | After |
|---|---|---|
| Primary model quota | Fallback to mini (only if API-style message) | Fallback to mini (plan-style messages now classified too) |
| Both models quota | Per-edit error spam, banner-only reason | One-time auto-pause notice with real reason + reset hint |
| Non-quota failure ×1–2 | Per-edit error | Same error + `(failure n/3 before auto-pause)` |
| Non-quota failure ×3 | Per-edit error spam forever | One-time auto-pause notice |
| Successful review | — | Resets failure counter |
| Paused (any kind) | Log-only skip | Log-only skip, log states pause provenance |

## Testing

Vitest, `packages/claude-plugin/src/__tests__/` (existing conventions):

1. **Classification:** new quota phrasings match `isQuotaError`; JSONL `error` events
   win over stderr banner on non-zero exit; stderr tail used when no JSONL error.
2. **State helpers:** `readPauseInfo` on empty file / JSON body / corrupt body;
   `wx` no-clobber (manual pause survives auto-pause attempt); failure counter
   increment → threshold → reset; corrupt `failures.json` treated as 0.
3. **Catch-path integration:** `quotaExhausted` → sentinel written + single pause
   message; 3rd failure → sentinel + backstop message; 2nd failure → suffix only,
   no sentinel.
4. **Reset-hint parser:** the supported phrasings, plus garbage-in → no hint.

## Docs & release

- ADR-120 in `docs/DECISIONS.md` (decision log per repo convention).
- `docs/ROADMAP.md` updated.
- `/codex-pair-resume` + `/codex-pair` skill doc touch-ups.
- Changeset: `@ask-llm/plugin` patch (plugin is distributed via marketplace
  `git-subdir`; hook scripts ship with the plugin package).
