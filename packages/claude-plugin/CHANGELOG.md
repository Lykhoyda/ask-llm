# @ask-llm/plugin

## 0.7.8

### Patch Changes

- Updated dependencies [[`fc40dcb`](https://github.com/Lykhoyda/ask-llm/commit/fc40dcbca3256d1558c2910bb30df64f373876ab)]:
  - ask-gemini-mcp@1.6.11
  - ask-codex-mcp@0.3.11
  - ask-ollama-mcp@0.3.6
  - ask-antigravity-mcp@0.2.2

## 0.7.7

### Patch Changes

- Updated dependencies [[`2f12b43`](https://github.com/Lykhoyda/ask-llm/commit/2f12b43c5b8111e3f726ee52fc237ca31df0b4b0)]:
  - @ask-llm/shared@0.3.4
  - ask-codex-mcp@0.3.10
  - ask-antigravity-mcp@0.2.1
  - ask-gemini-mcp@1.6.10
  - ask-ollama-mcp@0.3.5

## 0.7.6

### Patch Changes

- Updated dependencies [[`0e14e19`](https://github.com/Lykhoyda/ask-llm/commit/0e14e19fd55dad04c4cc31b55336a970de01ef0b)]:
  - ask-antigravity-mcp@0.2.0

## 0.7.5

### Patch Changes

- Updated dependencies [[`fe3ee41`](https://github.com/Lykhoyda/ask-llm/commit/fe3ee41b65908125a88f711b0a2fd560cb286e30)]:
  - ask-gemini-mcp@1.6.9

## 0.7.4

### Patch Changes

- Updated dependencies [[`d88606f`](https://github.com/Lykhoyda/ask-llm/commit/d88606f9ec7c1dcc48308d4cadfd8731c9ade8d8)]:
  - ask-gemini-mcp@1.6.8

## 0.7.3

### Patch Changes

- [#123](https://github.com/Lykhoyda/ask-llm/pull/123) [`f12e43c`](https://github.com/Lykhoyda/ask-llm/commit/f12e43cd1926c399f6ee1778ea711f9093ed8620) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # Release workflow hardening — failure-tracking issue + Release status badge

  Two complementary fixes that make release-workflow failures visible
  after the fact, born from the lived-experience finding that PR [#112](https://github.com/Lykhoyda/ask-llm/issues/112)'s
  release run sat with a red X for 5 days without anyone noticing.

  ## What changes

  ### `release.yml` — open a tracking issue on failure

  Adds a final step gated on `if: failure() && steps.changesets.outcome ==
'failure'` that uses `actions/github-script@v7` to:

  - Check for an existing open issue with the `release-broken` label
  - If one exists: post a comment with the new run URL + commit SHA
    (avoids issue-spam on consecutive failures)
  - If none exists: open a new issue titled "Release workflow failed on
    <sha7> — publish blocked" with labels `release-broken` + `urgent`,
    body containing the run URL, commit SHA, likely-cause checklist
    (NODE_AUTH_TOKEN expired/wrong-type, package permission change, npm
    outage), and the fix path

  Safety note: uses the octokit API exclusively, no shell evaluation of
  untrusted input. All `context.*` values are GitHub-runtime trusted
  (sha, runId, serverUrl, repo).

  ### `README.md` — Release status badge

  Adds a Release badge next to the existing CI badge so the workflow
  failure state is visible to anyone visiting the repo:

  ```markdown
  [![Release](https://img.shields.io/github/actions/workflow/status/Lykhoyda/ask-llm/release.yml?branch=main&label=release&logo=npm)](https://github.com/Lykhoyda/ask-llm/actions/workflows/release.yml)
  ```

  ## What this does NOT change

  The publish step itself is unchanged. These fixes don't prevent
  failures — they make failures surface loudly so they get fixed
  promptly. Publish behavior, version-bump logic, MCP Registry sync,
  unified GitHub Release creation — all byte-identical.

- Updated dependencies [[`53c0708`](https://github.com/Lykhoyda/ask-llm/commit/53c07080f7e62355d18a4d423bf76a65ab473dc7)]:
  - @ask-llm/shared@0.3.2
  - ask-gemini-mcp@1.6.6
  - ask-codex-mcp@0.3.8
  - ask-ollama-mcp@0.3.3

## 0.7.2

### Patch Changes

- [#113](https://github.com/Lykhoyda/ask-llm/pull/113) [`c28c90c`](https://github.com/Lykhoyda/ask-llm/commit/c28c90c0cbfce994c99618244dcab3215e78e297) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # ADR-098 — codex-pair task-agnostic re-positioning + `/codex-pair` user-invocable dashboard

  Two coupled documentation + UX changes for the codex-pair surface:

  ## 1. Task-agnostic re-framing across 5 documentation surfaces

  Every place that described codex-pair's value via the ADR-077 four-task
  benchmark's specific probe domains ("float-money precision, validation
  bypass, edge-case clamping") in sentences like "Use codex-pair when handling
  money / security-sensitive code" caused LLMs reading the ask-llm codebase
  as project context to hallucinate that ask-llm itself has money handling
  and auth paths. ask-llm is a CLI bridge between MCP clients and LLM CLIs
  with none of that code.

  The rewrite replaces domain-specific framing with code-characteristic
  language ("code with hidden invariants the model can't infer from one
  file", "code where latent bugs cost more than per-edit review", the
  "looks fine, runs wrong" failure-mode class). The recall improvement is
  explicitly attributed as task-agnostic — measured across four
  structurally different fixtures (todo CRUD, URL shortener, RFC-spec
  implementation, stateful business logic), not just one. Each surface
  that lives in the LLM-readable corpus now includes an explicit "ask-llm
  itself is a CLI/MCP bridge with none of these properties; codex-pair
  runs here for dogfooding" disclaimer. Empirical numbers (2/10 → 7/10
  → 10/10) are preserved verbatim — only surrounding framing changes.

  Surfaces touched: `packages/claude-plugin/skills/codex-pair/SKILL.md`,
  `packages/claude-plugin/README.md`, `apps/docs/plugin/hooks.md`,
  `apps/docs/plugin/skills.md`, `apps/docs/plugin/overview.md`.

  ## 2. `/codex-pair` user-invocable dashboard

  `codex-pair/SKILL.md` flips from `user_invocable: false` to `true` with
  a Phase 1–5 orchestration block at the top:

  - **Phase 1**: Detect state (marker walk, pause sentinel check, recent
    log tail)
  - **Phase 2**: Branch on detected state
  - **Phase 3** (no marker → setup): Auto-detect project context by
    reading `README.md` + `package.json` + alternative manifests; draft a
    `.codex-pair/context.md` with project-purpose summary + 3-5 inferred
    domain invariants; use `AskUserQuestion` with the draft as the
    recommended option's `preview` field so the user sees content before
    deciding; ASK before modifying `.gitignore`
  - **Phase 4** (paused): Structured status table with paused-since
    timestamp + resume instruction
  - **Phase 5** (active): Structured status table with marker
    model + surface threshold + cost-per-review estimate + last 5 reviews
    summary + active ignore/include patterns + pause instruction

  The existing hook reference documentation (when-to-use, cost
  characteristics, output format, configuration knobs, empirical
  justification) moves below the orchestration block but is unchanged
  in substance — it serves as Claude's reference for explaining hook
  behavior to users mid-orchestration.

  Zero new code under `scripts/` — the entire orchestration uses Claude's
  existing tool surface (Bash, Read, AskUserQuestion). Plugin test count
  unchanged at 313 (no new code to test; the orchestration is natural-
  language phase instructions, structural pinning would over-couple).
  Lint clean across 6 workspaces.

- [#120](https://github.com/Lykhoyda/ask-llm/pull/120) [`daeec3d`](https://github.com/Lykhoyda/ask-llm/commit/daeec3dd989e6bc70616cc37bdb612dd05812823) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # ADR-099 — codex-pair Karpathy baseline principles in review prompt

  Adds a new `## Baseline review principles` section to the codex-pair
  review prompt template at `packages/claude-plugin/prompts/review.txt`,
  adapting three diff-evaluable rules from the Karpathy CLAUDE.md
  (https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md):

  1. **Simplicity** — flag features beyond what was asked, single-use
     abstractions, unrequested configurability, impossible-scenario error
     handling, 200-line code that could be 50.

  2. **Surgical scope** — flag drive-by refactors of unrelated adjacent
     code, style refactors mixed with substantive logic edits, orphan
     imports/variables/functions, style drift from the file's existing
     conventions.

  3. **Hidden assumptions** — flag behavior depending on unstated
     invariants the next reader can't see, simpler alternatives the diff
     didn't consider when obvious, multiple valid interpretations of the
     task with one silently picked.

  The fourth Karpathy rule (Goal-Driven Execution) was intentionally
  excluded — it's a metaprocess rule about how to approach a task with
  no concrete evaluation target on a code diff. Tracked as a candidate
  for separate CLAUDE.md inclusion in a follow-on.

  ## Why universal (Option A) over project-scoped opt-in

  The baseline is intentionally on for every opted-in project: same
  review criteria everywhere, regardless of whether the project supplied
  a marker. Project-specific invariants in `.codex-pair/context.md`
  take precedence per the section's framing ("Treat violations as MED or
  HIGH findings unless a project-context rule below explicitly overrides
  them"), so projects retain the ability to override baseline behavior
  without removing it.

  ## Cost + cache impact

  - ~360 tokens per review of prompt overhead (~$0.0015 at current
    codex pricing — negligible vs the $0.04–0.07 per-review codex spend)
  - Cache invalidation is one-time per project on the first edit after
    upgrade because the prompt content change → cache key change. Each
    opted-in project pays one extra codex spawn per file on the first
    post-upgrade edit, then back to normal cache-hit rates.

  ## What's unchanged

  The hook source (`codex-pair-watch.mjs`) is byte-identical. This is a
  prompt-only change. ADR-077 silent-on-error, ADR-082 cache key shape,
  ADR-087 inflight lock, ADR-089 golden-fixture contract — all unchanged
  in mechanism (the golden fixture content is updated to match the new
  template, preserving the byte-identical pin).

  Plugin test count unchanged at 313; lint clean across 6 workspaces.

  ## Reversibility

  Two file edits + one test-assertion update if empirical follow-on
  shows the baseline doesn't earn its keep. ADR-099 documents the
  reversal cost up front.

- [#121](https://github.com/Lykhoyda/ask-llm/pull/121) [`5bb4dff`](https://github.com/Lykhoyda/ask-llm/commit/5bb4dff1793939c26303239c93b8f0b271cdeef3) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # ADR-100 — codex-pair prompt A/B benchmark harness

  Scaffolds an empirical validation harness for prompt-template changes
  at `packages/claude-plugin/scripts/benchmark/`. Built initially to
  validate ADR-099 (Karpathy baseline principles), but reusable for any
  future prompt change.

  ## What's in the harness

  ```
  packages/claude-plugin/scripts/benchmark/
  ├── README.md                       # usage + decision rule
  ├── prompt-ab.mjs                   # driver
  ├── lib/
  │   ├── render-prompt.mjs           # mirrors lib/prompt.mjs substitution
  │   ├── invoke-codex.mjs            # spawns codex exec --json, parses JSONL
  │   ├── score.mjs                   # keyword-based probe matching
  │   └── report.mjs                  # markdown report generator
  ├── fixtures/
  │   ├── README.md
  │   ├── 01-overcomplication/        # Simplicity rule
  │   ├── 02-drive-by-refactor/       # Surgical scope rule
  │   ├── 03-orphan-imports/          # Surgical scope rule
  │   └── 04-hidden-assumption/       # Hidden assumptions rule
  └── templates/
      ├── pre-baseline.txt            # main's prompt as of ADR-098
      └── baseline.txt                # ADR-099's prompt with Karpathy block
  ```

  ## Methodology

  1. Each fixture has three files: `code.ts` (sent to codex), `context.md`
     (marker context), `probes.json` (ground-truth `should_flag` entries).
  2. The driver renders each fixture against both templates, invokes real
     `codex exec --json`, scores findings against probes via keyword
     match (≥2 keyword hits per probe), emits a markdown comparison.
  3. Decision rule for ADR-099 validation: ship if recall delta ≥ +10 pp
     AND extra-finding delta ≤ +1/fixture; otherwise execute ADR-099's
     documented two-file rollback.

  ## Cost

  ~$0.40 per full benchmark run (4 fixtures × 2 arms × ~$0.05/review).

  ## What this is NOT

  - NOT a runtime change — the harness is standalone tooling under
    `scripts/benchmark/` with no imports from the runtime layer
  - NOT auto-run on PRs — manual invocation only until variance data
    justifies a CI gate
  - NOT tested by vitest — one-off maintainer scripts, exercised
    manually when run; lint covers syntax via Biome

  Plugin test count unchanged at 313; lint clean across 6 workspaces.

  ## Forward use

  Future prompt changes (severity-vs-urgency, structured-output tweaks,
  baseline rule extensions) can vendor a new template snapshot into
  `templates/` and re-run against the same fixtures + decision rule.
  The harness itself is the durable artifact; ADR-099 is the first
  use-case.

  Run with:

  ```bash
  node packages/claude-plugin/scripts/benchmark/prompt-ab.mjs \
    --out benchmark-report.md
  ```

- [#122](https://github.com/Lykhoyda/ask-llm/pull/122) [`971ddf7`](https://github.com/Lykhoyda/ask-llm/commit/971ddf7d1e96bbab7d98eebae7d9ef065598e6e0) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # Benchmark harness fixes — SIGKILL timeout respect + graceful error-state report rendering

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

- [#119](https://github.com/Lykhoyda/ask-llm/pull/119) [`0f67df2`](https://github.com/Lykhoyda/ask-llm/commit/0f67df285fa8b892dc31c5b8e3bc68388431d36a) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # Parallel-fire test fixtures — closes the MultiEdit + concurrent-hook test gap

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

## 0.7.1

### Patch Changes

- [#111](https://github.com/Lykhoyda/ask-llm/pull/111) [`ab40290`](https://github.com/Lykhoyda/ask-llm/commit/ab40290fecdbabec75436579d06152f6218251d6) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # ADR-097 — codex-pair UX hotfix on ADR-096

  Closes the four `/multi-review` findings explicitly tracked as "follow-on hotfix
  before wide adoption" in the v0.7.0 changeset. Both Gemini and Codex
  independently flagged each at 80+ confidence; all four reproduced empirically
  before fixing per the ADR-095 verify-before-fixing discipline.

  1. **TOCTOU race on singleton `repetitions.json`** (Gemini 95, Codex 88) →
     state moves from `<markerDir>/.codex-pair/state/repetitions.json` to
     `<markerDir>/.codex-pair/state/repetitions/<sha256(file)[0:16]>.json`. Each
     shard's read-modify-write is now naturally serialized by ADR-087's per-file
     inflight lock. Schema bumped to `v: 2`.

  2. **Unbounded state growth** (Codex 85) → `sweepStaleRepetitions` drops
     shards older than 30 days, called probabilistically (5% per update) so
     abandoned files don't accumulate state.

  3. **Cache-hit double-count under rapid re-saves** (Gemini 87) → new
     read-only `getBlockingFromShard` surfaces blocking entries without
     mutating state. Cache-hit branch in `codex-pair-watch.mjs` uses this
     instead of `updateRepetitions`. Rapid undo/redo cycles can no longer
     push a finding to BLOCKING without a real new live review.

  4. **Include-list negation-only edge case** (Codex 82) → `.codex-pair/include`
     with ONLY negation rules (e.g. just `!build/**`) previously gated every
     file out (no positive rule = no match for anything). Now the negations
     transform into positive ignore-list entries with an info-level log line
     explaining the semantic mapping.

  Backward-compat shims keep the v1 `loadRepetitions`/`saveRepetitions` exports
  as no-ops so external scripts that imported the v1 surface don't break at
  import time. No data migration needed — repetition state is advisory and
  regenerates from continued reviews; any lingering v1 `repetitions.json` file
  on disk is harmless (different path, ignored by new code, won't be swept by
  the new TTL).

  Test count 308 → 313 (+5 ADR-097 regressions). Lint clean across 6 workspaces.

- Updated dependencies [[`ab40290`](https://github.com/Lykhoyda/ask-llm/commit/ab40290fecdbabec75436579d06152f6218251d6)]:
  - ask-gemini-mcp@1.6.5
  - ask-codex-mcp@0.3.7
  - ask-ollama-mcp@0.3.2

## 0.7.0

### Minor Changes

- [#108](https://github.com/Lykhoyda/ask-llm/pull/108) [`190e5c9`](https://github.com/Lykhoyda/ask-llm/commit/190e5c9ee95b8241b0c788e3df2ea4fd3721b074) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # v0.7.0 — Tier 3 broker, layout consolidation, codex-pair UX improvements

  Major release across the codex-pair feature: shipped the full Tier 3
  `codex app-server` broker (eliminates ~3-10s cold-spawn per edit when
  opted in via `ASK_CODEX_BROKER=1`), consolidated all hook state under
  a single `.codex-pair/` directory, removed the deprecated PreToolUse
  Gemini pre-commit hook, and added three codex-pair UX improvements
  born from end-of-Tier-3 lived-experience review.

  ## Highlights

  ### Tier 3 broker — `codex app-server` integration (ADR-093)

  A long-lived `codex app-server` JSON-RPC sidecar replaces the per-edit
  cold-spawn cost (15-30s) with a warm-connection path (~5-15s, savings
  of 3-10s per fire). Spawned once per Claude Code session, torn down at
  SessionEnd, with stale-broker recovery for crashed-session orphans.

  Implementation across four milestones:

  - **M1**: Protocol discovery via `codex app-server generate-json-schema`.
    Refined `lib/broker.mjs` interface; pinned `BROKER_PROTOCOL_VERSION =
"v2"`, `JSONRPC_METHODS`, `JSONRPC_NOTIFICATIONS`, `buildVerdictSchema()`.

  - **M2**: Hand-rolled minimal RFC 6455 WebSocket client (`broker-transport.
mjs`, ~280 LOC) supporting both `unix://` and `ws://`; JSON-RPC 2.0
    layer with tolerant parsing (`broker-rpc.mjs`); SessionStart spawn +
    handshake + atomic descriptor write; SessionEnd SIGTERM grace +
    cleanup; `clearStaleBrokerState` for orphan recovery (`broker-
lifecycle.mjs`).

  - **M3**: Real `submitReview` body — `thread/start { ephemeral: true,
approvalPolicy: "never", sandbox: "read-only" }` → `turn/start` with
    `outputSchema` constraint matching `parser.mjs::parseConcernsJson` →
    listen for `turn/completed` → extract final agentMessage → return.
    `rpc.waitFor(method, predicate, timeoutMs)` race-safe notification
    primitive. Error mapping via `err.verdict` (matches existing
    `verdictFromError` contract) with structured `err.timeout`,
    `err.aborted` markers.

  - **M4**: Hook integration. `isBrokerEnabled(markerDir)` checks env +
    descriptor + protocol version + pid liveness. `runCodexWithFallback`
    dispatches to the broker via `runWithBroker` when enabled; on
    `err.brokerFailure` (transport / handshake / parse failures) silently
    falls back to per-edit `spawnCodex` per the ADR-077 silent-on-error
    contract. Cache integration unchanged — broker and spawn modes share
    the same cache entries (cross-mode reuse is a feature).

  Opt-in via `ASK_CODEX_BROKER=1`. Default-off behavior byte-identical
  to v0.6.x.

  ### `.codex-pair/` layout consolidation (ADR-092)

  All hook state nested under a single project-local directory:

  | Before (flat)                 | After (nested)                |
  | ----------------------------- | ----------------------------- |
  | `.codex-pair-context.md`      | `.codex-pair/context.md`      |
  | `.codex-pair-log.jsonl`       | `.codex-pair/log.jsonl`       |
  | `.codex-pair-ignore`          | `.codex-pair/ignore`          |
  | `.codex-pair-cache/`          | `.codex-pair/cache/`          |
  | `.codex-pair-state/paused`    | `.codex-pair/state/paused`    |
  | `.codex-pair-state/inflight/` | `.codex-pair/state/inflight/` |

  `.gitignore` collapses from 4 enumerated codex-pair entries to one
  `.codex-pair/` line — future state files inherit the ignore
  automatically. Path-resolver pattern in `lib/state.mjs` is the single
  source of truth.

  **Migration for existing users**: manual `mv` of legacy flat paths into
  `.codex-pair/`. No migration helper ships; behavior is byte-identical
  to v0.6.x once paths are moved. Cache JSON shape, log JSONL shape,
  broker interface, atomicity contracts all unchanged.

  ### Codex-pair UX improvements (ADR-096)

  Three improvements identified from end-of-Tier-3 lived-experience
  review (ADR-095), targeting the 81% finding-ignored rate observed in
  real M2 development:

  1. **Inclusion-list scoping** (`.codex-pair/include`). Gitignore-style
     globs, mirror of `.codex-pair/ignore`. When present + non-empty,
     ONLY files matching at least one rule are reviewed. Lets users
     restrict codex-pair to high-stakes paths (`src/billing/**`,
     `src/auth/**`) and avoid paying ~$0.05/edit on routine refactor
     code. Include gate runs BEFORE ignore (include narrows; ignore
     excludes from narrowed set).

  2. **Repetition detector** (`.codex-pair/state/repetitions.json`).
     Tracks per-(file, concernHash) consecutive flag counts. Concerns
     absent from a re-review are dropped (assumed fixed); concerns
     present again increment. When count crosses `REPETITION_BLOCKING_
THRESHOLD` (3), the finding is escalated.

  3. **Loud-formatting** for repeated-ignored findings. When the
     threshold is crossed, `buildVerdictMessage` prefixes the
     systemMessage with a multi-line 🛑 banner so the consumer
     (Claude or human) cannot silently scroll past. Poor-man's STOPPER
     mode within PostToolUse hook constraints (Claude Code's hook
     protocol doesn't currently support blocking the next tool call).

  ### PreToolUse pre-commit Gemini hook removed (ADR-094)

  The advisory-only PreToolUse hook that ran Gemini against staged
  diffs has been removed:

  - Codex-pair delivers strictly better recall continuously during
    editing (HIGH/MED concerns surface to Claude on next turn; LOW
    concerns log).
  - `/gemini-review` covers the on-demand explicit-review need with
    the same Gemini-CLI dependency.
  - Removing eliminates per-Bash dispatch latency and simplifies the
    "what hooks does this plugin install?" model.

  **For users who relied on the advisory output**: switch to
  `git diff --cached | ask-gemini-run "review these staged changes"`
  or `/gemini-review` before committing. Both are documented in the
  README.

  ### Internal: codex-pair debt paydown + reviewer-agent calibration (ADR-095)

  End-of-Tier-2 forensic audit of `.codex-pair/log.jsonl` revealed
  codex-pair flagged 32 unique bugs during development; 21 were
  ignored in flight (2 of them BLOCKING — un-sent WebSocket upgrade

  - ESM `require()` — that `/multi-review` independently re-caught
    5+ hours later).

  * 6 verified-real bug fixes after empirical reproduction tracing
  * 1 documented false-positive (`child.unref()` is by design per ADR-090)
  * 3 deferred-known-limitations tracked in ROADMAP
  * `agents/codex-reviewer.md` calibration: severity-first reporting,
    mandatory reproduction paths, ADR-aware false-positive filtering,
    anti-noise heuristics

  ## What's not in this release (known follow-ons)

  - Full severity-vs-urgency refactor (breaking prompt + parser change).
  - True platform-level STOPPER signal (requires upstream Claude Code
    support for `decision: "block"` on PostToolUse).
  - Per-finding "acknowledged" persistence.
  - Multi-review ADR-096 findings (TOCTOU race on repetitions.json
    cross-file updates; unbounded state growth without TTL; include-list
    negation-only edge case; cache-hit double-count under rapid re-saves)
    — tracked for a follow-on hotfix before wide adoption.

  ## Test count trajectory

  230 → 245 (M2 PR1) → 254 (M2 PR2) → 264 (M2 PR3) → 271 (M2 hotfix [#103](https://github.com/Lykhoyda/ask-llm/issues/103))
  → 278 (ADR-095 debt) → 284 (M3) → 289 (M3 hotfix) → 300 (M4) → 308
  (ADR-096). All tests pass; lint clean across 6 workspaces.

## 0.6.2

### Patch Changes

- Fix two ≥80-confidence findings from the multi-review on PR [#76](https://github.com/Lykhoyda/ask-llm/issues/76):

  **1. Catch handler now uses hoisted `markerAnchor` instead of `process.cwd()`** (both Gemini and Codex flagged). The unhandled-exception path in `main().catch(...)` previously walked up from `process.cwd()` to find the marker, which undermined the v0.6.1 cross-repo fix for any error that happened AFTER payload parsing. Now: `markerAnchor` is hoisted to module scope; `main()` sets it to `dirname(filePath)` once payload is validated; the catch handler reads `markerAnchor ?? process.cwd()` — using cwd only as a true last resort when `main()` threw before payload parsing.

  **2. Documented Windows compatibility caveat** for the `$PWD` workaround in `apps/docs/plugin/hooks.md`. The `sh -c '...'` form requires a POSIX shell, which Windows users on cmd.exe/PowerShell don't have natively. Added a one-line note pointing Windows users at Git for Windows (which provides `sh` via MINGW64) or recommending an absolute Windows path instead.

  Both fixes are tiny (~5 LOC each), no architectural changes. New structural test pins the catch-handler hoist invariant so a future refactor can't silently regress.

## 0.6.1

### Patch Changes

- Fix: codex-pair marker resolution now anchors to the edited file's directory, not `process.cwd()` (issue [#65](https://github.com/Lykhoyda/ask-llm/issues/65)). In multi-repo workflows where Claude Code's cwd is one repo but the edit happens in another, the previous behavior wrote logs to the cwd's repo instead of the edited file's repo, producing "where did my log go?" confusion. The fix uses `dirname(tool_input.file_path)` — always absolute per Claude Code's hook payload contract — as the marker walk's anchor. The `main().catch` unhandled-exception fallback retains its cwd-based lookup since `filePath` isn't in scope there; the structural test was tightened to allow this distinction.

  Side effect: shipping this as v0.6.1 also triggers Claude Code's plugin cache refresh for pre-existing sessions still pinned to the stale v0.6.0 install (issue [#74](https://github.com/Lykhoyda/ask-llm/issues/74)) — the next `/reload-plugins` or session restart will see "new version available" and re-fetch from origin.

## 0.6.0

### Minor Changes

- Prep v0.6.0 — codex-pair hook improvements release. Umbrella version covering a coordinated batch of hardening, observability, speed, and DX improvements to the codex-pair PostToolUse hook. Planned scope across three phases:

  **Phase 1 — Hardening + observability (bundled PR):**

  - Log rotation: cap `.codex-pair-log.jsonl` at ~2MB / 1000 entries via atomic rewrite (env override `CODEX_PAIR_MAX_LOG_BYTES`).
  - Structured run-state verdicts: explicit `none | concerns | skipped | error | spawn_failed | timeout | parse_failed | cached`, mirrored into the `systemMessage` prefix.
  - Expanded skip patterns: add font files, archives, language-specific lockfiles, minified assets.
  - Default-model drift guard: read model defaults from a shipped `codex-pair-defaults.json` instead of hardcoded literals; structural test links the file to `codex-mcp/constants.ts`.

  **Phase 2 — Foundation + adaptive context (sequential PRs):**

  - Local config in marker frontmatter: YAML frontmatter in `.codex-pair-context.md` for `model`, `fallbackModel`, `timeoutMs`, `maxFileBytes`, `surfaceThreshold`. Hand-rolled zero-dependency parser.
  - Adaptive context strategy at the file-size boundary: under-cap → full file (unchanged); over-cap + tracked → imports header + `git diff -U20 HEAD` + partial-view instruction; over-cap + untracked → head+tail slice with same instruction. Replaces today's silent skip.
  - `.codex-pair-ignore`: gitignore-style globs for granular per-file/per-directory opt-out, no `systemMessage` on match (preserves silent-gating UX).

  **Phase 3 — Speed + recovery (parallelizable PRs):**

  - Content-hash response cache: `sha256(model + prompt + fileContent + surfaceThreshold)` keyed cache under `<markerDir>/.codex-pair-cache/`, 10-minute TTL, 50-file LRU eviction.
  - Log viewer CLI: standalone `scripts/codex-pair-log.mjs` with `--latest`, `--summary`, `--file`, `--since` subcommands. Zero workspace imports.
  - Failure-class retry with jitter: retry-once on transient network/5xx errors (`ECONNRESET`, `ETIMEDOUT`, `502`/`503`/`504`, etc.). Quota and timeout failures keep their existing terminal paths.

  Constraints preserved through all items: zero workspace imports (marketplace install compatibility), always exit 0 (never break Claude's tool flow), LOW concerns stay in log only by default (ADR-077 threshold-in-hook), synchronous-blocking hook semantics (agent-accountability argument). Reasoning-effort tuning and async/fire-and-forget patterns are explicitly out of scope for this batch.

## 0.5.0

### Minor Changes

- codex-pair hook now emits a `systemMessage` notice to Claude Code on every run — `OK` when no concerns are found, `WARN` with HIGH/MED bodies when concerns surface, and `SKIP`/`ERROR` when the hook attempts work but can't complete (unreadable file, oversize file, codex timeout). Previously the hook was silent on the happy path, so review activity was only visible in `.codex-pair-log.jsonl`. The threshold-in-hook design from ADR-077 is preserved: LOW concern bodies still go to the log only, with a count surfaced in the verdict header.
