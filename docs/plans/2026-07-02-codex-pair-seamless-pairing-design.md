# codex-pair seamless-pairing design (2026-07-02)

## Problem

Three defects break the core "pairing" promise — all evidence-backed from the dogfood repo's own `.codex-pair/log.jsonl`:

1. **Sticky auto-pause silently kills pairing.** The hook auto-paused on 2026-06-14 (3 consecutive `gpt-5.5-mini` 400s on a ChatGPT-plan account). The root cause was fixed and released weeks ago (ADR-126/127), but the pause sentinel has no expiry and no reminder beyond the single notify-once message (ADR-120: "no expiry logic"). Result: **all 315 log entries in the last 14 days are `skipped — auto-paused`** — pairing was dead for 18 days while the owner believed it active.
2. **Verdicts never reach the model on the PostToolUse path.** Claude Code's `systemMessage` hook field is user-facing only; it is NOT injected into the model's context (verified against current hooks docs). Every verdict surface in `codex-pair-watch.mjs` — live reviews, cached hits, drained debounce verdicts, the 🛑 repeated-ignored banner — goes through `emitSystemMessage()`. Only the `UserPromptSubmit` drain uses `additionalContext` (the field that reaches the model). In the default debounced flow, Claude only hears codex when the human sends their next prompt.
3. **The Stop gate races in-flight reviews.** `codex-pair-stop-gate.mjs` reads only `log.jsonl`. With the 15s settle window plus p50=35.5s / p90=84s review latency (measured), reviews are routinely still in flight at turn-end: the gate passes, and a HIGH finding lands after Claude already said "done". Queued pending verdicts are not drained at Stop either.

Adjacent bug found during diagnosis: `/codex-pair-resume` removes the pause sentinel but not `state/failures.json`, so a resumed project re-pauses on the very next single failure (counter already ≥ threshold).

## Design

All changes live in `packages/claude-plugin/scripts/` (plugin-only; zero-workspace-imports constraint per ADR-078 continues to hold).

### Fix 1 — dual-channel verdict emission (model + user)

`emitSystemMessage(text)` in `codex-pair-watch.mjs` becomes dual-channel:

```json
{
  "continue": true,
  "systemMessage": "<text>",
  "hookSpecificOutput": { "hookEventName": "PostToolUse", "additionalContext": "<text>" }
}
```

- `systemMessage` stays (user transcript visibility + the debounce worker's `extractSystemMessage()` contract is unchanged).
- `additionalContext` makes every verdict reach the model on the same event that produced it.
- Applies to ALL emissions from the watch hook: live verdicts, cached verdicts, drained pending verdicts, unreadable-file skips, failure notices, auto-pause notices.

### Fix 2 — self-healing auto-pause

Auto-pauses gain expiry; manual pauses (empty sentinel) never auto-expire.

- `writeAutoPause` records `pluginVersion` (best-effort from the plugin's package.json) alongside the existing `{v, kind, reason, resetHint?, at}`.
- New pure helper `resolveAutoResume(pauseInfo, {now, currentVersion})` in `lib/state.mjs`:
  - `manual` → never resume.
  - `kind: "quota"` → resume when `now - at >= CODEX_PAIR_QUOTA_PAUSE_TTL_MS` (default 6h). `resetHint` is display-only free text, so TTL is used instead of parsing it.
  - `kind: "failures"` → resume when `now - at >= CODEX_PAIR_FAILURES_PAUSE_TTL_MS` (default 24h) OR when `pluginVersion` differs from the running version (a plugin update plausibly fixed the cause — exactly the June-14 case).
  - Missing/unparseable `at` → treated as expired (liveness-biased; the manual pause remains the reliable off-switch).
- `codex-pair-watch.mjs`: when `readPauseInfo()` is non-null and `resolveAutoResume` says resume → unlink sentinel, `clearReviewFailures()`, log `{verdict: "auto_resumed"}`, emit a dual-channel notice, and **continue into the normal review flow** (don't exit). A failed retry re-pauses through the existing paths (`wx` write succeeds because the sentinel was removed) — notify-once is preserved per pause episode.
- `codex-pair-session.mjs` (SessionStart, before the broker gate, un-gated by `ASK_CODEX_BROKER`):
  - Paused and not expired → emit `hookSpecificOutput.additionalContext` (SessionStart does not support `systemMessage`): "codex-pair is paused (kind, since, reason). Resume with /codex-pair-resume." — the silent-death reminder.
  - Paused and expired → perform the auto-resume (unlink + clear failures + log) and say so in `additionalContext`.
- `/codex-pair-resume` skill: also remove `state/failures.json` (bug fix).

### Fix 3 — Stop-gate pending drain + in-flight awareness

`codex-pair-stop-gate.mjs` (still exits 0 on every path, still honors `stop_hook_active`):

- **Pending drain (all users, not just `blockOn: HIGH`):** at Stop, `drainPending(markerDir)`; if verdicts were queued, deliver them via Stop `hookSpecificOutput.additionalContext` (non-blocking channel). When the gate also blocks, fold the drained text into the block `reason` instead (one output object).
- **In-flight awareness (`blockOn: HIGH` only):** detect reviews that haven't landed yet —
  - unconsumed debounce records (`reviewedGen < generation`) → worker still sleeping/settling;
  - fresh inflight locks under `state/inflight/` (mtime within the review TTL) → codex call running.
  If any exist, block once with a reason telling Claude reviews are in flight for N file(s) and to wait for the verdicts (poll `.codex-pair/log.jsonl` / re-attempt stop) before finishing. `stop_hook_active` exits 0 as today, so the gate cannot loop.

### Explicitly out of scope

- Broker-path changes (env-gated experiment, untouched).
- PostToolUse:Bash drain (approach B) — deferred; re-evaluate after the trio lands.
- Parsing `resetHint` into a timestamp.

## Error handling

Unchanged philosophy (ADR-077): every hook exits 0 on every path; all new state operations are best-effort try/catch; auto-resume failures degrade to "stay paused" (today's behavior).

## Testing

- `stop-gate.test.ts`: pure-function tests for in-flight detection + drain folding (fixture dirs, no codex).
- `auto-pause.test.ts`: `resolveAutoResume` matrix (manual/quota/failures × fresh/expired × version match/mismatch/absent), sentinel version field, resume-clears-failures.
- `codex-pair-watch.test.ts` / fake-codex scenarios: dual-channel emit shape; auto-resume → live review continuation.
- `codex-pair-prompt-drain.test.ts` / debounce worker: unchanged contracts pinned (worker still extracts `systemMessage`).

## Compatibility

- Old sentinels (no `pluginVersion`) still parse (`readPauseInfo` ignores unknown fields); TTL alone heals them — including this repo's June-14 sentinel.
- Verdict message text unchanged; only the JSON envelope gains a field.
- New env knobs: `CODEX_PAIR_QUOTA_PAUSE_TTL_MS`, `CODEX_PAIR_FAILURES_PAUSE_TTL_MS`.
