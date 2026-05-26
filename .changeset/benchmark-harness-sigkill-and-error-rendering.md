---
"@ask-llm/plugin": patch
---

# Benchmark harness fixes — SIGKILL timeout respect + graceful error-state report rendering

Two defects in the ADR-100 prompt A/B benchmark harness (`packages/claude-plugin/scripts/benchmark/`) discovered during the first real run validating ADR-099. Both fixes are isolated to maintainer tooling — no runtime impact, no test-suite changes needed.

## Fix 1: `lib/invoke-codex.mjs` — SIGKILL respect + settled guard

**Defect**: codex ignored `SIGTERM` when mid-turn. The first benchmark run recorded fixture durations of **712s / 985s / 908s** past a 240-second `SIGTERM` — codex held the script open until its own internal lifecycle decided to exit. The promise-rejection from the timer fired, but the child process kept the Node script alive via its still-open stdio pipes.

**Fix**:
- Switch from `SIGTERM` to `SIGKILL` — codex respects the latter immediately
- Explicit `child.stdout.destroy()` + `child.stderr.destroy()` + `child.stdin.destroy()` to release stdio backpressure when killing
- `settled` guard variable prevents the `close` handler from double-settling the promise if it fires after the timer
- `child.on("error", ...)` handler added so spawn-failure (ENOENT, EACCES) routes through the same settle path instead of crashing the driver
- Default `timeoutMs` bumped 120s → 300s; codex with reasoning tokens occasionally needs >2 min for complex fixtures
- Timeout error message now includes captured stdout/stderr byte counts for diagnostic visibility

## Fix 2: `lib/report.mjs` — error-state rendering without crashing

**Defect**: when ANY fixture errored on EITHER arm, `report.mjs` crashed with `Cannot read properties of undefined (reading 'recall')` because per-fixture iteration accessed `run.score.recall` without checking whether `run` had an `error` instead.

**Fix**:
- Per-fixture loop now branches on `run.error` and renders a `FAILED — <message>` section with the duration, instead of trying to render score data that doesn't exist
- Aggregate section now detects "at least one arm errored on every fixture" and surfaces that explicitly instead of computing a nonsensical recall delta on empty data

## Why these matter

The harness will be re-run for every future prompt change (severity-vs-urgency refactor, structured-output tweaks, additional baseline rules). Without these fixes, a single codex non-determinism event would cost 12+ minutes of wall-clock per hung fixture, and the report would crash trying to render the result. The fixes turn the harness from "works when codex is cooperative" into "works regardless of codex's mood."

## What's unchanged

Hook source, broker, cache, lock, parser, prompt rendering — none of these touch runtime code. Pure maintainer-tooling fix.

Plugin test count unchanged at 313; lint clean across 6 workspaces.
