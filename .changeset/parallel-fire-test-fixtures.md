---
"@ask-llm/plugin": patch
---

# Parallel-fire test fixtures — closes the MultiEdit + concurrent-hook test gap

Adds 6 new tests + a `slow` scenario to the fake-codex fixture, closing
the empirical gap surfaced by the deep-investigation tracing: the 313
pre-existing plugin tests used `tool_name: "Edit"` exclusively, with
zero MultiEdit payloads and zero concurrent-hook scenarios. The actual
codex-pair workload — agentic Claude making multiple Edit/Write/Multi-
Edit tool calls per turn — wasn't exercised by any test.

## New tests (`packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts`)

1. **MultiEdit payload acceptance** — pins that `{tool_name: "MultiEdit",
   tool_input: {file_path, edits: [...]}}` reaches the codex-spawn path
   and logs a review entry with `tool: "MultiEdit"`. Guards against
   silent payload-shape drift if Claude Code's MultiEdit schema ever
   changes.

2. **Cache participation (MultiEdit→MultiEdit)** — pins that the cache
   key is content-derived (not tool-name-derived) so identical-content
   MultiEdit re-fires hit the cache. Closes a regression class: a
   tool_name-specific cache bypass.

3. **Cross-file parallel fires (3 concurrent processes)** — fires 3
   hooks concurrently via `Promise.all` on 3 different files. Verifies:
   - All 3 exit 0
   - 3 distinct review log entries with distinct file paths
   - 3 separate cache entries across cache buckets
   - 3 separate per-file repetition shards under `state/repetitions/`
   - No cross-file contention (ADR-097 sharded layout invariant)

4. **Same-file in-flight coalescing (ADR-087)** — fires hook A with the
   `slow` codex scenario, waits 250ms (past lock acquisition), fires
   hook B on the same file. Verifies hook B logs `verdict: "skipped"`
   with `coalesced` in the reason, emits no systemMessage, and that
   only ONE review verdict (from hook A) lands in the log.

5. **MultiEdit + ignore gate** — verifies an ignored file matched by
   `.codex-pair/ignore` is skipped pre-codex even when the tool is
   MultiEdit. Guards against a tool_name-specific gate bypass.

6. **Slow-scenario fixture self-test** — sanity-pins that the new
   `slow` scenario actually sleeps for `FAKE_CODEX_SLEEP_MS` before
   emitting NONE. If someone breaks the fixture, this gives a direct
   failure pointing at the cause rather than confusing race-flakes
   in the dependent coalescing test.

## New fake-codex `slow` scenario (`_fixtures/codex`)

Adds a configurable-latency scenario: sleeps `FAKE_CODEX_SLEEP_MS`
(default 500ms) then emits a NONE verdict. Enables deterministic
race-window control for the in-flight coalescing test without the
30-second `timeout` scenario's wall-clock penalty.

## Test count and wall-clock impact

- Test count: 313 → 319 (+6).
- Wall-clock: 4.2s → 7.1s (+2.9s), dominated by the 1.5s slow-scenario
  hold-time in the coalescing test plus ~500ms for 3 concurrent
  codex spawns in the cross-file test. Acceptable.
- Lint clean across 6 workspaces.

No production code changes. The fixture file (`_fixtures/codex`) is
test-only and not shipped to npm consumers.
