# Roadmap

## Active plan: codex-pair stability hardening (2026-05-18)

Following the v0.6.0 batch and v0.6.1 / v0.6.2 patches, the next ship cadence is **driven by stability**, informed by:

- Multi-provider brainstorm of `openai/codex-plugin-cc` patterns (Gemini + Codex + Claude Opus).
- Multi-review of the resulting plan that revoked one recommendation (Stop hook migration — invalidated by our own ADR-048) and promoted the fake-codex fixture from Tier 3 to Tier 1.

**Sequencing for v0.6.3 → v0.7.0+:**

1. **v0.6.3 — Tier 1 hardening (no architectural decision required):** fake-codex test fixture, SKILL.md docs-drift fix, structured JSON output contract (replaces regex parser), cross-platform process-tree termination, atomic state writes audit.
2. **v0.6.4–v0.7.0 — Tier 2 (ADR-required):** PostToolUse debounce/coalesce (replaces dropped Stop migration), targeted `lib/` extraction (3-5 files), prompt template externalization with golden tests, app-server broker + SessionStart/SessionEnd lifecycle.
3. **v0.7.0+ — Tier 3 (defer):** health-check helpers, persistent job state, model aliases.

Full design + per-item effort estimates + ADR dependencies + verified empirical basis: [`docs/plans/2026-05-18-codex-plugin-cc-adoption-roadmap.md`](plans/2026-05-18-codex-plugin-cc-adoption-roadmap.md).

**ADRs to author during this work:** ADR-083 (output contract), ADR-084 (debounce semantics), ADR-085 (module boundary policy), ADR-086 (broker transport + lifecycle).

### Recently shipped (post-Tier 2 follow-ons)

- **ADR-098 — codex-pair documentation reframing + `/codex-pair` user-invocable dashboard** (PR pending, 2026-05-21). Two coupled changes: (1) task-agnostic re-framing of codex-pair positioning across 5 documentation surfaces (plugin SKILL.md, plugin/README.md, apps/docs/plugin/hooks.md + skills.md + overview.md) — the "money / security-sensitive paths / auth" framing is replaced with code-characteristic language ("hidden invariants the model can't infer from one file", "looks fine, runs wrong" failure mode), and each surface now includes an explicit "ask-llm itself is a CLI/MCP bridge with none of these properties; codex-pair runs here for dogfooding" disclaimer so LLM corpus consumers (codex-pair on itself, reviewer agents, brainstorm dispatches) no longer hallucinate concerns about money/auth code that doesn't exist in ask-llm. The ADR-077 empirical claims are unchanged; only surrounding framing changes. (2) `codex-pair/SKILL.md` flips to `user_invocable: true` with a Phase 1–5 orchestration block at the top — `/codex-pair` is now a one-command setup-and-status dashboard: detects current state (marker present? paused? recent log activity?), branches to interactive setup (auto-detects project context from README + manifests, drafts marker, asks before writing) OR active/paused dashboard with structured status table. The hook reference documentation moves below the orchestration block but is unchanged. Zero new code under `scripts/` — the orchestration uses Claude's existing tool surface (Bash, Read, AskUserQuestion). Plugin test count unchanged at 313 (no new code to test).
- **ADR-097 — codex-pair UX hotfix on ADR-096 (per-file sharded repetitions + TTL sweep + read-only cache-hit path + negation-only include semantics)** (PR pending, 2026-05-21). `/multi-review` of the merged ADR-096 diff surfaced four findings both Gemini and Codex independently flagged at 80+ confidence — all four were called out as known follow-ons in the v0.7.0 changeset. (1) TOCTOU race on the singleton `repetitions.json` (cross-file edits could lose increments) closed by sharding state to `.codex-pair/state/repetitions/<sha256(file)[0:16]>.json` so each shard inherits ADR-087's per-file inflight-lock serialization. (2) Unbounded state growth closed by `sweepStaleRepetitions` (30-day TTL, probabilistic 5% sweep per update). (3) Cache-hit double-count under rapid re-saves closed by routing the cache-hit branch through new read-only `getBlockingFromShard` (live reviews remain the only path that mutates state). (4) Include-list negation-only edge case (only `!build/**`-style rules) now transforms each negation into a positive ignore-list entry and proceeds with no inclusion gate — matches user intent ("review everything except…") instead of silently skipping every file. Backward-compat shims keep the v1 `loadRepetitions`/`saveRepetitions` exports as no-ops so import sites don't break. Test count 308 → 313.
- **ADR-096 — codex-pair UX improvements (inclusion-list + repetition detector + loud-formatting)** (PR pending, 2026-05-21). Implements the three highest-leverage suggestions from ADR-095's lived-experience critique: (1) `.codex-pair/include` glob-list that narrows reviews to high-stakes paths before the existing `.codex-pair/ignore` exclusion-list runs; (2) repetition detector at `.codex-pair/state/repetitions.json` that increments per-concern flag counts and promotes findings flagged 3+ times to a BLOCKING tier; (3) `buildVerdictMessage` prefixes the systemMessage with a multi-line 🛑 banner when repeated-ignored findings exist (poor-man's STOPPER mode — Claude Code's PostToolUse hooks can't actually block the next tool call, but the visual weight forces the consumer to see the finding). Test count 300 → 308. Deferred: full severity-vs-urgency refactor (breaking change to prompt + parser) and platform-level STOPPER (requires upstream Claude Code changes).
- **ADR-095 — codex-pair lived-experience lessons + M2 debt paydown** (PR pending, 2026-05-20). End-of-M2 forensic audit of `.codex-pair/log.jsonl` revealed codex-pair flagged 32 unique bugs during M2 development; 21 were ignored in flight (2 of them BLOCKING — the un-sent WebSocket upgrade and the require()-in-ESM — which /multi-review independently re-caught 5+ hours later). This PR: (a) fixes 6 verified-real bugs after empirical reproduction tracing (sleep helper unref leak, missing spawn error handler, Math.max budget floors, hardcoded "v2" instead of constant, bootstrap-connection leak on descriptor failure, clearStaleBrokerState treating junk URLs as live); (b) documents one false-positive (`child.unref()` is by design per ADR-090); (c) calibrates `codex-reviewer.md` for severity-first reporting + mandatory reproduction paths + ADR-aware false-positive filtering; (d) codifies the consumption-pattern discipline (tail log between bursts; treat HIGH as immediately blocking). The deeper lesson: ADR-077's 5x recall claim is empirically real but conditional on consumption — a reviewer surfacing 30 findings to a sink no-one reads produces zero value. Test count 271 → 278.
- **ADR-094 — Remove PreToolUse pre-commit Gemini-review hook** (PR pending, 2026-05-20). The hook always shipped as "advisory only" (warned but never blocked commits). Codex-pair now delivers strictly better recall continuously during editing (HIGH/MED concerns surface on next turn, LOW concerns log) against the project's `.codex-pair/context.md` invariants, and `/gemini-review` covers the on-demand explicit-review need with the same Gemini-CLI dependency the hook used. Removing the hook eliminates per-Bash dispatch latency, simplifies the "what hooks does this plugin install?" mental model to one sentence, and shrinks the install surface by one script + one test file. Migration is zero-effort — existing users get a faster `git commit` and lose passive review they rarely read.
- **ADR-093 — `codex-pair` broker protocol discovery** (PR #97, 2026-05-20). Tier 3 Milestone 1: probed codex-cli 0.130.0's `codex app-server` JSON-RPC protocol via the binary's own schema generator. Found that `review/start` is the wrong primitive for codex-pair (git-changeset-based), correct primitive pair is `thread/start` + `turn/start` with `ephemeral: true` + `outputSchema`. Refined `lib/broker.mjs` interface to match the documented contract; bodies remain stubbed pending milestones 2–4.
- **ADR-092 — Consolidated `.codex-pair/` directory layout** (PR #92, 2026-05-19). All hook state (marker, log, ignore globs, cache, pause sentinel, inflight locks) nests under a single `.codex-pair/` directory; `.gitignore` collapses from 4 enumerated entries to 1; path-resolver pattern in `lib/state.mjs` is the single source of truth so future state files require no consumer changes. No migration helper per maintainer direction. Byte-identical behavior to v0.6.7 — cache, log shape, broker interface, atomicity contracts all unchanged.
- **Docs refinement for codex-pair communication** (PR #93, 2026-05-19). Six brainstorm-driven copy/structural improvements across README, hooks.md, overview.md, skills.md, and SKILL.md: inlined the empirical 2/10 → 7/10 → 10/10 benchmark numbers (previously buried behind an ADR-077 hyperlink); removed `codex-pair` from Skills tables (it's a hook, not a slash command) and replaced with a redirect callout; added per-developer / do-not-commit guidance to README; reordered hooks.md to put decision-frame before mechanics; reconciled $0.04–0.07/file cost across all surfaces (resolving a SKILL.md $0.20/edit-pass contradiction Claude alone caught in cross-surface review); broadened marker-context placeholder to categorized concrete invariants (Security/Specs/State/Concurrency).

## ~~Priority 2: Claude Code Plugin~~ ALL DONE
- See [design doc](plans/2026-02-25-claude-code-plugin-design.md)

## Priority 4: Features from Community PRs
- [x] LRU response caching — in-memory LRU with 30min TTL, 10MB max, provider+prompt+model key (upstream PR #44)
- [x] Gemini API compatibility mode (upstream PR #35) — simplified `ask-gemini` to 2 params (prompt + model), moved changeMode to dedicated `ask-gemini-edit` tool (ADR-034)

## Priority 6: Documentation Site Redesign (ADR-036)
- [x] **Dark-only theme** — `appearance: 'force-dark'`, indigo accent (#818CF8), Geist Sans/Mono fonts
- [x] **Design token system** — `design-tokens.css` with brand, surface, text, spacing tokens + VitePress remaps
- [x] **Anti-grid card corners** — CSS `clip-path` with layered pseudo-element border technique
- [x] **Component rebuilds** — SetupTabs, DiagramModal, TroubleshootingModal restyled with tokens
- [x] **Multi-provider navigation** — Providers dropdown, sidebar section, 4 provider pages
- [x] **Provider cards** — Per-provider accent colors with gradient-glow hover effects
- [x] **Rebrand** — "Ask LLM" title, multi-provider hero, updated tagline
- [x] Convert config.js / theme/index.js to TypeScript
- [x] Add provider installation commands to SetupTabs per provider page

## Priority 7: Distribution & Discovery
- [x] Add OpenGraph metadata and badges to README for better link previews
- [ ] Publish blog post / dev.to article about the tool and AI-to-AI collaboration pattern
- [ ] Add to MCP client directories (Cursor, Windsurf, Cline marketplace listings)

## Priority 8: Multi-LLM Support (ask-llm-mcp) — ADR-020, ADR-026
- [x] **Phase 1: Monorepo restructure** — yarn workspaces, packages/shared + packages/gemini-mcp + packages/plugin (ADR-026)
- [x] **Phase 2: Plugin providers** — Gemini + Codex in packages/claude-plugin: ask-codex-run binary, codex-reviewer agent, /codex-review skill (ADR-031)
- [x] **Phase 3: Codex MCP** — packages/codex-mcp/ (`ask-codex-mcp`), codexExecutor with JSONL parsing, gpt-5.5 default with gpt-5.5-mini fallback on quota errors (ADR-028; default bumped from 5.4→5.5 in ADR-067)
- [x] **Phase 4: Orchestrator** — packages/llm-mcp/ (`ask-llm-mcp`), dynamic provider import via `./register` subpath, `isCommandAvailable()` gating, tool dedup, startup logging (ADR-029)
- [x] **Phase 5: Ollama** — packages/ollama-mcp/ (`ask-ollama-mcp`), HTTP executor via native fetch against POST /api/chat, qwen2.5-coder:7b default with 1.5b fallback, OLLAMA_HOST env var, /api/tags availability probe (ADR-032)
- [x] **Local smoke tests** — Husky pre-push hook runs integration tests using locally installed CLIs (ADR-043). Replaced weekly GA workflow with per-push local testing via `scripts/smoke-test.sh`
- [x] **Benchmark** — token overhead + latency comparison of MCP vs Skill vs Subagent vs Orchestrator (ADR-030, static analysis complete, manual runs pending)
- See [design doc](plans/2026-02-26-ask-llm-mcp-design.md)

## Priority 9: Bug Fixes (GitHub Issues)
- [x] **codex-pair v0.6.0 umbrella release — 10 hardening/observability/speed/DX improvements under one version bump** — Bump-first release model: PR #64 set the manifests to v0.6.0 with no code, then 7 implementation PRs (#66 bundled phase 1; #67–#72 sequential phase 2 + parallelizable phase 3) shipped under that umbrella without further bumps. (1) Log rotation at 2MB/1000 entries via atomic tmp-write+rename in `appendLog`; (2) structured run-state verdicts (`none | concerns | skipped | error | spawn_failed | timeout | parse_failed | cached | retried`), mirrored into the `systemMessage` prefix; (3) expanded skip patterns (fonts, archives, sourcemaps, snapshots, minified, lockfiles for pnpm/Cargo/Gemfile/composer/poetry/go); (4) default-model drift guard via new `packages/claude-plugin/codex-pair-defaults.json` + structural test linking values to `codex-mcp/src/constants.ts:MODELS`; (5) YAML frontmatter config in `.codex-pair-context.md` (model, fallbackModel, timeoutMs, maxFileBytes, surfaceThreshold) with hand-rolled zero-dep parser, precedence frontmatter > env > default; (6) adaptive context replaces over-cap silent-skip with three strategies — "diff" (header-80 + git diff -U20 HEAD for tracked files), "head-tail" (head-150 + omission + tail-80 for untracked / git-fail), "truncated" (for few-lines-but-huge-bytes); (7) `.codex-pair-ignore` with gitignore-style globs and `!` negation, silent log-only skip (NO systemMessage), preserves silent-gating UX; (8) content-hash response cache `sha256(model+prompt+fileContent+surfaceThreshold)` under `<markerDir>/.codex-pair-cache/<hash[0:2]>/<rest>.json`, 10min mtime TTL, 50-file LRU eviction, `[cached]` tag in systemMessage on hit; (9) standalone log viewer CLI `packages/claude-plugin/scripts/codex-pair-log.mjs` with `--latest [N]` / `--summary` / `--file <p>` / `--since <dur>` subcommands; (10) failure-class retry with jitter — transient errors (`ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR|502\b|503\b|504\b`) retry once at `1000+rand*1500`ms, quota errors keep model-fallback path, timeout/parse_failed never retry. Marker file `.codex-pair-context.md` committed to dogfood the hook against this very codebase. Test count 141 → 194 (+53). ADRs 079 (frontmatter), 080 (adaptive context), 081 (ignore file), 082 (cache).
- [x] **codex-pair PostToolUse hook — recall-first complement to /codex-review (opt-in via marker file)** — The existing /codex-review skill is precision-first (confidence ≥80, "don't flag style/linter-catchable"), appropriate for routine PR review. A four-task benchmark on branch `experiment/codex-pair-poc` found that calibration structurally suppresses a specific class of bug: domain-level "wrong but won't crash" issues. Task 4's three-arm comparison was decisive — against the same Run-A natural-Claude shopping-cart code, /codex-review caught 7/10 differential probes; a recall-first per-file hook caught 10/10. The three missed probes were float-money precision, validation cross-cutting gap, and discount clamping — exactly the issues the confidence filter classifies as below threshold. New PostToolUse hook in `packages/claude-plugin/scripts/codex-pair-watch.mjs` self-gates on `.codex-pair-context.md` marker file (no marker = zero cost no-op; with marker = per-edit Codex review with HIGH/MED/LOW grading, surface HIGH+MED to Claude on next turn). Threshold lives in the hook, not the prompt, so it's tunable without re-asking codex to recalibrate. Coexists with /codex-review — explicit "when to use each" in the new `skills/codex-pair/SKILL.md`. Tests: 19 new in `src/__tests__/codex-pair-watch.test.ts` (13 structural + 6 runtime-behavior with synthesized stdin, no real codex calls). Plugin minor bump 0.3.1 → 0.3.2 via changesets. ADR-077
- [x] **Adopt Changesets + `changesets/action` for release automation** — Manual package.json edits + tag-push dance got us through v1.6.3 and v1.6.4 but failed twice: forgotten-bump tripwires on the bundled-deps cascade, and a week-stuck release when the SSH agent dropped between `main` push and `tag` push (motivated #52/#54 daily bot reports as "fix not landed"). Now mechanical: `yarn changeset` per PR queues a bump intent; bot auto-opens `chore: version packages` PR aggregating queued changesets; merging that PR triggers npm publish + MCP Registry + unified `v<gemini>` GitHub Release. Load-bearing config: `updateInternalDependents: "always"` forces the bundled-deps cascade to fire even when `workspace:*` always satisfies the range. Legacy v1.5.x..v1.6.x tag URLs preserved via custom unified-release step coexisting with changesets/action's per-package tags. CONTRIBUTING.md documents the new contributor flow. ADR-076
- [x] **#46 Upstream CLI compat — codex `--sandbox workspace-write` + gemini trust env-var co-emit** — Two upstream regressions our v1.6.3 shipped against: (1) codex 0.128 deprecates `--full-auto` (warning today, hard trap in 0.129-alpha); replaced with the canonical `--sandbox workspace-write` per codex's own deprecation message — `codex exec` is non-interactive by definition so approval-never is implicit. (2) gemini-cli main (→0.42) renamed `GEMINI_TRUST_WORKSPACE` to `GEMINI_CLI_TRUST_WORKSPACE` with no backward-compat alias, silently breaking ADR-069's auto-trust default once users upgrade. Co-emit both env-var names so one release covers any gemini-cli in current rotation without runtime version detection. Error message + README updated. Tests: codex assertion-shape updates in 3 places, gemini +1 escape-hatch test (99→100). Supersedes audit issues #41, #49, #50, #51. ADR-075
- [x] **#45 Per-provider timeouts — `ASK_CODEX_TIMEOUT_MS` / `ASK_GEMINI_TIMEOUT_MS` (codex default 800s)** — Long codex prompts with reasoning models routinely exceed the 210s global default; user reported timeout errors on substantive prompts that would have completed in ~300–600s. Added per-provider env-var override with codex-specific 800s default (gemini stays at 210s, ollama deferred since it goes via HTTP not subprocess). Resolution ladder: `ASK_{CODEX,GEMINI}_TIMEOUT_MS` > `GMCPT_TIMEOUT_MS` > provider default. Diagnose tool now surfaces both per-provider timeouts in its environment block. Forensic note in ADR-074: the issue's hypothesized "race between timer and close event with stats recorded post-hoc" is structurally impossible given current code (no streaming JSONL parser, no async usage tracker), so future contributors don't chase that dead end. Closes #45. ADR-074
- [x] **Codex `reasoning_output_tokens` plumbed through to shared `thinkingTokens`** — codex 0.125+ ships per-turn reasoning-token counts for `gpt-5.5` family; previously dropped on the floor (hard-coded `thinkingTokens: undefined`). Now mapped to the shared `UsageStats.thinkingTokens` field so cross-provider aggregation in `get-usage-stats` and `formatSessionUsage` works correctly across Gemini + Codex. `[Codex stats: ...]` footer now surfaces `"7,500 thinking tokens"` lines in the same position as Gemini. Drains P1 §2 from #28's punch list. ADR-072
- [x] **#32 Integration test for spawn env propagation** — Closes the coverage gap left by ADR-069's workspace-trust hotfix: existing trust-handling tests mock `executeCommand` directly, never exercising the real `process.env` → `getSpawnEnv()` → `spawn`'s `env` option chain. Added 3 real-spawn tests in `commandExecutor.test.ts` using `node -e "console.log(process.env.X)"` to verify (a) `GEMINI_TRUST_WORKSPACE=true` propagates to children, (b) test isolation works (unset stays unset), (c) propagation is generic across arbitrary env vars. The sessionId-round-trip half of #32 is deferred — needs Gemini v0.39.1+ binary; mocking `--resume` would only re-test existing unit-test territory.
- [x] **#31 Codex `--ignore-user-config` + `--ignore-rules`** — Codex 0.124+ stabilized hooks; user-installed `~/.codex/config.toml` could potentially break our `--ephemeral` exec path with hook-error events. Preempted by adding both flags by default so the MCP wrapper is deterministic regardless of host machine codex config. Opt-out via `ASK_CODEX_LOAD_USER_CONFIG=1` for users with custom MCP servers registered in their codex config (mirrors the `ASK_GEMINI_REQUIRE_WORKSPACE_TRUST` opt-out from ADR-069). Auth credentials in `CODEX_HOME` always load. Closes #31, addresses action #5 from #26 / #24 / #25. ADR-071
- [x] **#30 Pipe large prompts via stdin** — Above 16 KiB the `@largefile` expansion + `/multi-review` / `/brainstorm` flows pushed argv close to ARG_MAX (256 KiB on macOS, 2 MiB on Linux). Fix: `executeCommand` accepts an optional 5th `stdin?: string` payload; both Gemini and Codex executors flip to stdin above `EXECUTION.STDIN_THRESHOLD_BYTES` (16 KiB). Gemini passes empty `-p ""` since headless mode requires the flag; Codex omits the positional argv entirely (its CLI reads from stdin when no prompt is given). Bonus: keeps full prompts out of `ps` output. ADR-070
- [x] **#26 Gemini CLI v0.39.1 workspace-trust gate** — gemini-cli v0.39.1 added `FatalUntrustedWorkspaceError` to headless (`-p`) mode, breaking fresh installs in directories never marked trusted. Fix: `geminiExecutor` sets `GEMINI_TRUST_WORKSPACE=true` by default (forward-compatible env var, ignored on older Geminis); opt-out via `ASK_GEMINI_REQUIRE_WORKSPACE_TRUST=1`. Trust errors short-circuit before the Flash retry (same dir would just fail again) and surface a friendly remediation message. ADR-069
- [x] **npm 9 EUNSUPPORTEDPROTOCOL workspace:*** — `npx -y ask-llm-mcp` failed under Claude Desktop's Node 18 / npm 9.7.1. Root cause + fix in ADR-052; lifecycle corrected in 1.5.7 / 0.2.7
- [x] **MCP Registry publish failures** — `server.json` versions were all set to the gemini tag version, causing 404 validation errors for codex/ollama/llm on the MCP registry. Fixed by reading each package's own `package.json` version
- [x] **Smoke test rate-limit-self-defeating loop** — Pre-push smoke tests burned the very Gemini quota the next push needed, causing intermittent push failures within ~10-minute windows. Added quota-detection escape (`scripts/smoke-test.sh`) that treats 429/quota errors as skip-with-warning, with `FORCE_SMOKE=1` opt-in to restore hard-fail (ADR-051)
- [x] **#23 brainstorm-coordinator** — Sub-agent background job lifecycle bug: Codex at high reasoning was SIGKILLed silently when the coordinator's turn ended. Rewrote Phase 3 to run sequentially (3B then 3A) with a single foreground blocking Bash dispatch using direct backgrounding + per-PID wait + 10-minute timeout (ADR-050)
- [x] **#22 brainstorm-coordinator** — Claude Opus as first-class research participant (Phase 3B), not just orchestrator; verified findings weighted higher than inferred (ADR-049)
- [x] **#21 Gemini fallback** — Multi-pattern quota detection for newer CLI versions (ADR-044)
- [x] **#20 Claude Desktop timeout** — Lowered default timeout to 210s, actionable error messages (ADR-045)
- [x] **ANT-242 Codex hangs + Node detection** — Added `--full-auto` flag, Node.js v20+ startup check (ADR-046)
- [x] **Shell PATH resolution** — macOS GUI apps (Claude Desktop) don't inherit shell PATH; added login shell extraction + heuristic fallback (ADR-047)

## Priority 10: MCP Best Practices & Plugin Quality
- [x] **Input validation** — `.max(100000)` on all prompt schemas, `path.isAbsolute()` on includeDirs (ADR-048 implied)
- [x] **LLM-actionable errors** — `sanitizeErrorForLLM()` replaces raw stack traces with guidance
- [x] **Test coverage** — 20 new tests for progressTracker, shellPath, sanitizeErrorForLLM (176→199)
- [x] **Plugin hooks** — Extracted to shell scripts, configurable timeout, PATH resolution
- [x] **Agent tool restrictions** — Reviewers limited to Bash/Glob/Grep/Read + provider MCP
- [x] **Skill trigger phrases** — Descriptions include invocation patterns for auto-matching

## Undecided / Potential Improvements
- **Streaming JSON output** — expose `--output-format stream-json` for real-time JSONL progress events (`init`, `message`, `tool_use`, `result`). Would replace keepalive messages with live content streaming. Now available in Gemini CLI 0.37.0.
- **Gemini `--approval-mode`** — New in 0.37.0: `default`, `auto_edit`, `yolo`, `plan`. Could use in hooks for safer non-interactive mode.
- **MCP `outputSchema`** — Structured responses via `structuredContent`. SDK supports it but clients may not handle it yet. Deferred.
- ~~**Extract tool registration loop**~~ — Done (ADR-053). Shared `registerTools()` in `@ask-llm/shared/serverFactory.ts`. ~130 lines eliminated. (`createSandboxServer()` later removed in ADR-054.)

## Priority 11: Session Usage Tracking & Smithery Removal (ADR-054)
- [x] **Session usage accumulator** — `@ask-llm/shared/usage.ts` with `UsageStats`, `SessionUsage`, `formatUsageStats`, `formatSessionUsage` (16 unit tests)
- [x] **Per-executor `UsageStats`** — Gemini, Codex, Ollama executors now return structured token + duration + fallback data alongside the response string
- [x] **`onUsage` callback** — `UnifiedTool.execute` and `executeTool` thread an optional usage callback; `registerTools` records into a per-server `SessionUsage` accumulator
- [x] **`get-usage-stats` MCP tool** — first-class `UnifiedTool` via `createUsageStatsTool(sessionUsage)` factory. Exposed by all 4 servers (Gemini 4→5 tools, Codex/Ollama/orchestrator 2→3 tools)
- [x] **Multi-review caught ADR contradiction** — Codex flagged that the original `registerUsageStatsTool` helper bypassed the registry, contradicting ADR-004/029/034 tool-count claims AND diverging from the sandbox-scanned schema (ADR-017). Fix: promoted to first-class tool via factory + registry path
- [x] **Smithery removal** — `createSandboxServer` infrastructure deleted from shared + all 3 provider `index.ts` files. Smithery was never adopted (skipped per "requires paid plan for stdio servers"); the abstraction was dead code formalized by ADR-053. ADR-017 superseded
- [x] **MCP `outputSchema` on `get-usage-stats`** — `UnifiedTool` extended with optional `outputSchema` and `ToolResult = string | {text, structuredContent}` return type. The usage tool now emits both markdown and a Zod-validated `SessionUsageSnapshot` for programmatic consumers (ADR-055)
- [x] **MCP Resource `usage://current-session`** — Live JSON snapshot exposed as a `resources/read` target via `registerSessionUsageResource` helper. Costs zero against the tool-token budget (ADR-029) since Resources sit in a separate namespace

## Priority 12: Doctor / Diagnostic Surface (ADR-056)
- [x] **Shared `runDiagnostics()` core** — `@ask-llm/shared/doctor.ts` with `DiagnosticReport`, per-check status, env + provider probe, formatter (16 unit tests)
- [x] **`npx ask-llm-mcp doctor` CLI subcommand** — works when MCP server can't start; `--json` flag for machine output; exit code 0 on ok/warning, 1 on error
- [x] **`diagnose` MCP tool on orchestrator** — 4th tool on `ask-llm-mcp`, structured `outputSchema` matching `DiagnosticReport`. Per-provider servers intentionally excluded (would only see their own provider)
- [x] **Smoke-tested live** — detects Node v24.13.0, 52 PATH entries, gemini 0.37.0, codex-cli 0.118.0, Ollama endpoint reachable

## Priority 13: Streaming Output for Gemini (ADR-057)
- [x] **`--output-format stream-json`** — Gemini CLI 0.37+ emits JSONL events; executor now uses this instead of buffered `--output-format json`
- [x] **Live progressive content** — `makeStreamingProgressForwarder` extracts assistant message deltas from the JSONL stream and forwards them to the existing `onProgress` callback. MCP clients now display the model's prose unfolding in real time inside progress notifications
- [x] **`parseGeminiStreamJsonl`** — Aggregates stream events into the same `GeminiExecutorResult` shape (sessionId, response, usage stats). Stream stats format converted to canonical `GeminiCliStats` shape via small adapter
- [x] **Backward-compat fallback** — Detects pre-0.37 Gemini output and falls back to legacy `parseGeminiJsonOutput`; existing tests using `JSON.stringify({response:...})` mocks continue to pass via this path
- [ ] **Codex streaming** — Deferred to future ADR (Codex JSONL parses already, just needs progressive consumption)
- [ ] **Ollama streaming** — Deferred to future ADR (HTTP `stream: true` body iteration)

## Priority 14: Session Continuity Across All Providers (ADR-058)
- [x] **Shared sessions store** — `@ask-llm/shared/sessions.ts` mirrors chunkCache pattern: 24h TTL, 200-file cap, 40-message cap, `isSafeSessionId` regex blocks path traversal (18 tests)
- [x] **Codex native resume** — `codex exec resume <id> <prompt>` wired via `buildArgs(prompt, model, sessionId)`; the existing `thread.started` event capture surfaces the resumable id automatically
- [x] **Ollama server-side replay** — `buildPriorMessages(id)` + `appendAndSaveSession()` maintain conversation history client-side; full message array sent on each turn, response footer includes `[Session ID: <id>]`
- [x] **Re-added `sessionId` to all 4 tool schemas** — partial reversal of ADR-034's sessionId removal (intent preserved: optional param, clearly described). Orchestrator's `ExecutorFn` routes to native or replay path per provider
- [x] **Cache disabled when sessionId is set** — same prompt in different conversations should yield different answers

## Priority 15: Plugin Test Coverage (ADR-059)
- [x] **Vitest added to plugin** — Replaces `"test": "echo 'No tests yet'"`. 57 new tests in 4 files
- [x] **Manifest validation** — `plugin.json`, `marketplace.json`, `hooks.json` shapes; bin entries point to existing files
- [x] **Skill + agent frontmatter validation** — Every skill's `name`/`description`, every agent's `name`/`description`/`model`/`color`; reviewer agents restricted from edit/write tools (over-privilege check)
- [x] **brainstorm-coordinator regression coverage** — Tests assert the load-bearing sections from ADR-049 (Phase 3A/3B sequential structure, WebFetch+WebSearch tools) and ADR-050 (sub-agent background-job warning, blocking-foreground language)
- [x] **pre-commit script safety patterns** — `set -euo pipefail`, secret pathspec exclusions, `trap` cleanup (ADR-040), `mktemp` use, PATH resolution (ADR-047), executable bit. Each maps to a documented historical bug
- [x] **Minimal frontmatter parser** — `_helpers.ts` provides `parseMarkdownFrontmatter()` inline (~30 lines) — avoided pulling a YAML dep for what is fundamentally a regression-protection layer

## Priority 16: `/compare` Skill — Side-by-Side Provider Responses (ADR-060)
- [x] **New skill** — `packages/claude-plugin/skills/compare/SKILL.md`, user-invocable, no agent
- [x] **Reuses ADR-050 dispatch pattern** — single foreground Bash call, direct backgrounding, per-PID wait, 10-minute timeout. Dispatches via plugin `dist/*-run.js` binaries (proper stdin + quota fallback)
- [x] **Synthesis-rejection** — skill body explicitly forbids paraphrasing or adjudicating; differentiated from `/brainstorm` (which synthesizes) and `/multi-review` (which validates code reviews)
- [x] **Test coverage** — 7 dedicated tests assert load-bearing structure (dispatch pattern, anti-pattern warnings, timeout requirement, dist/ runner usage); existing it.each gives the standard frontmatter coverage
- [x] **Docs updated** — Root README, plugin README, docs site overview all list `/compare`

## ~~Priority 17: GitHub Action — Multi-Provider Review in CI (ADR-061)~~
**Withdrawn 2026-04-17** — strategic refocus to CLI/agentic workflows; CI integration deferred indefinitely. A `/multi-review` pass against the implementation caught a critical ESM path-resolution bug in `runner.mjs`, and the broader decision to deprioritize CI integration in favor of CLI-driven agentic development meant the action was removed rather than fixed. Files deleted: `.github/actions/review/` and `packages/claude-plugin/src/__tests__/github-action.test.ts`. Work is preserved in git history. See ADR-061 (Withdrawn) for the path-resolution lesson if anyone revives this.

---

# Triage Complete (2026-04-17 cycle)

- ~~#1 Claude provider~~ — skip
- ~~#2 Multimodal~~ — skip
- ✅ #3 Plugin tests (ADR-059)
- ✅ #4 Doctor (ADR-056)
- ✅ #5 Streaming (ADR-057)
- ~~#6~~ — skip
- ⊘ #7 GitHub Action — implemented then withdrawn (ADR-061 Withdrawn). Strategic refocus to CLI agentic
- ✅ #8 (handled in ADR-058 design)
- ✅ #9 Sessions (ADR-058)
- ✅ #10 mcp-publisher binary removal (Wave 1)
- ✅ #11 CONTRIBUTING.md + SECURITY.md (Wave 1)
- ✅ #12 Cost/usage (ADR-054 supersedes the original add)
- ✅ #13 outputSchema + Resources (ADR-055)
- ✅ #14 /compare (ADR-060)

ADRs added in this triage cycle: ADR-052 through ADR-061 (9 accepted, 1 withdrawn).
Net new tests: 136 (199 → 335; the action's 31 tests were removed when the action was withdrawn).

# Strategic focus: MCP tools + Claude Code plugin

The CLI/agentic exploration was scoped intentionally. The REPL (Priority 18 below) shipped as a working feature but is **scope-capped at its current state** — it serves as a maintainer dev tool and a minimal multi-provider differentiator, but is NOT being grown into a competitor to `claude` / `gemini` / `codex` CLIs. Future engineering effort goes into the MCP tool surface and the Claude Code plugin, where user energy is actually showing up.

## Priority 18: Interactive CLI REPL (ADR-062) — SCOPE-CAPPED
- [x] **`npx ask-llm-mcp repl` subcommand** — Joins `doctor` and the default server-start path in `cli.ts`
- [x] **Per-provider session map** — Switching providers picks up that provider's last session (Gemini `--resume`, Codex `exec resume`, Ollama server-side replay all flow through the same code path)
- [x] **Slash commands** — `/help`, `/provider`, `/providers`, `/new`, `/session`, `/sessions`, `/usage`, `/clear`, `/quit`. All pure-function-tested
- [x] **Live streaming** — `onProgress` chunks from Gemini stream-json (ADR-057) write deltas directly to stdout
- [x] **Live usage tracking** — `/usage` shows `formatSessionUsage` snapshot from ADR-054
- [x] **End-to-end smoke-tested** — `printf "/help\n/quit" | node dist/cli.js repl` works against real provider detection
- [x] **29 new tests** — covering every slash command path, state mutations, and `dispatchPrompt` happy/error/streaming paths
- ⊘ **No further investment planned**. Multi-line input, persistent sessions across invocations, `@file` syntax, history navigation, syntax highlighting — all explicitly out of scope. Use `claude` / `gemini` / `codex` / Claude Code for richer terminal UX. Use the REPL specifically for multi-provider switching from one shell.

## Priority 23: `/codex-verify` skill + `codex-verifier` agent (ADR-073)
- [x] **New `codex-verifier` agent** at `packages/claude-plugin/agents/codex-verifier.md` — read-only tool surface (Bash/Glob/Grep/Read + mcp__codex__ask-codex; no Write/Edit), atomic claim decomposition, five-grade CONFIDENCE ladder (`PERFECT | VERIFIED | PARTIAL | FEEDBACK | FAILED`), Report block contract
- [x] **New `/codex-verify` skill** at `packages/claude-plugin/skills/codex-verify/SKILL.md` — gathers diff + assistant's last message verbatim, dispatches the agent, **defensively parses** the Report block (derives missing CONFIDENCE from STATUS, mirrors Pi's `verifier.ts:1029-1049`), surfaces PARTIAL gaps loudly as templates for future fixtures
- [x] **`/multi-review` skill update** — added "Two kinds of verification — pick the right skill" callout with intent → skill table so users routing "did the assistant do what it claimed?" land on `/codex-verify` rather than spending a multi-provider dispatch
- [x] **No MCP server changes** — value lives entirely in agent + skill prose contracts; published packages untouched
- [x] **Same-day follow-on: synthesis-confidence on `brainstorm-coordinator`** — Phase 4 now grades the whole brainstorm with a four-level ladder (`PERFECT | VERIFIED | PARTIAL | FAILED`); FEEDBACK is explicitly dropped because brainstorming has no fix-loop semantic. Surfaced as the first line of the output. `/codex-image` was deliberately not extended — its Phase 4 already verifies via `ls -la` against the filesystem and the ladder doesn't fit a binary present/absent surface
- [ ] **Future:** parallel `gemini-verifier` once a constraining-prompt experiment shows Gemini can return parseable single-line verdicts; optional cross-validator pass (verify the verifier with the other provider); `.claude/verification-audits/<date>.json` audit log; auto-trigger via Claude Code Stop hook (defaults debate worth having separately)

## Priority 22: `multi-llm` MCP tool (ADR-066)
- [x] **New `packages/llm-mcp/src/multiLlm.ts`** — `dispatchMultiLlm`, `formatMultiLlmReport`, `buildMultiLlmInputSchema`, schema definitions
- [x] **Orchestrator-only tool** — registered inline as the 5th MCP tool on `ask-llm-mcp` (was 4); per-provider servers don't get it (they only have one executor)
- [x] **Promise.all parallelism** — not Bash dispatch; the MCP tool handler runs in the persistent server process so ADR-050's sub-agent lifecycle concern doesn't apply
- [x] **Per-provider failure isolation** — one provider's exception/timeout doesn't fail the whole call; `results[i].ok=false` with error message; consumer decides what to do
- [x] **Structured outputSchema** — `MultiLlmReport` shape with `dispatchedAt`, `totalDurationMs`, `successCount`, `failureCount`, per-result `{provider, ok, response?, model?, sessionId?, usage?, durationMs, error?}`
- [x] **Coexists with `/compare` skill** — different audiences (skill is Claude Code-only with Claude verification; tool is any-MCP-client with raw structured)
- [x] **15 new tests** — happy path, usage callback, throws/missing handling, threadId fallback, parallelism timing, schema round-trip, formatter rendering, input schema validation
- [ ] **Future**: per-provider sessionId continuity, per-provider model override, early-termination ("any N of M complete"), streaming the merged report

## Priority 21: `outputSchema` on `ask-*` tools (ADR-065)
- [x] **Canonical `AskResponse` shape** in `@ask-llm/shared/askResponse.ts` — `{ provider, response, model, sessionId?, usage? }` with Zod validation
- [x] **`response` field is raw model text only** (no footer/prefix) — formatted text in `content[0].text` keeps backward-compat
- [x] **Unified `sessionId` field across providers** — Codex's threadId and Gemini's sessionId both map here; clients can resume any provider with one field
- [x] **All 4 free-form ask-* tools updated** — `ask-gemini`, `ask-codex`, `ask-ollama`, `ask-llm` (orchestrator). Each gains outputSchema + structured execute return
- [x] **`ask-gemini-edit` deferred** — its output shape (changeMode edit blocks) is fundamentally different; deserves its own `editResponseSchema` in a follow-up
- [x] **7 new schema validation tests** — all 3 providers accepted, unknown rejected, optional fields work, malformed usage rejected
- [x] **Backward compat preserved** — `content[0].text` unchanged; `structuredContent` purely additive

## Priority 20: Skill polish for /multi-review and /brainstorm (ADR-064)
- [x] **Diff preprocessing** — `git add -N` for untracked, pathspec exclusion of docs/binaries/lockfiles, 3-tier size policy (<50KB / 50–150KB warn / >150KB ask)
- [x] **Per-finding verification** — Phase 3 of /multi-review now requires Read-based source verification of every >=80 confidence finding; classifies as VERIFIED / REJECTED / UNVERIFIABLE. Built specifically to catch the 2026-04-17 case where Gemini returned two 95/100 false positives
- [x] **Fallback dispatch** — when reviewer agents aren't available, skill instructs Claude to use the project's `dist/run.js` / `dist/codex-run.js` runners with the ADR-050 pattern; explicitly forbids raw `gemini -p` / `codex exec` (would bypass quota fallback + stdin handling + PATH resolution)
- [x] **Failure resilience** — failed providers surface inline with stderr instead of silently dropping; partial results are explicit
- [x] **brainstorm-coordinator Phase 4 cross-check** — coordinator now spot-checks high-confidence external claims against source before promoting to consensus; new Rejected section in synthesis surfaces false positives
- [x] **16 new tests** — pin every load-bearing structural element across the three files so future edits can't silently regress the polish

## Priority 19: Session Continuity Hardening (ADR-063)
All three open issues from the 2026-04-17 multi-review are now fixed and tested:
- [x] **Codex `--ephemeral` only when no session is wanted** — `buildArgs` drops the flag when `sessionId` is set so resume actually persists. Cache key gate also moved to `wantsSession = sessionId !== undefined`
- [x] **Session file permissions hardened** — `0o700` on dir, `0o600` on files, atomic temp+rename write, lstat-based symlink rejection (defense-in-depth against tmp races)
- [x] **Ollama empty-string sessionId disables cache** — Documented "pass empty string to start a new session" UX path now works end-to-end. The downstream `appendAndSaveSession` already handled empty string correctly; only the cache short-circuit needed the fix
- [x] **10 new tests** — 4 in codex (ephemeral conditional, exec-resume sequence, empty-string cache), 4 in sessions (dir/file modes, retroactive tightening, no leftover tmp), 2 in ollama (undefined hits cache, empty bypasses)

## Candidate next directions (MCP/plugin)

After the open issues are fixed:
- **Provider routing intelligence in `ask-llm` tool** — Auto-pick provider per task type (code review → Codex, large-context → Gemini, private/fast → Ollama). The orchestrator's `provider` parameter becomes optional with a routing function as fallback
- **`/compare` and `/brainstorm` polish** — Apply lessons from real usage (the 2026-04-17 multi-review session showed both work but have rough edges around large diffs and timeout handling)
- **`outputSchema` on more tools** — Currently only `get-usage-stats` and `diagnose` have it. Adding to `ask-gemini`, `ask-codex`, `ask-ollama` would let MCP clients structurally extract sessionId, threadId, usage rather than parsing the response text
- **Subagent orchestration patterns as MCP** — Formalize the brainstorm-coordinator pattern as `spawn-subagent` + `wait-for-subagent` MCP tools instead of skill instructions. Lets any MCP client compose multi-agent workflows
- **Marketplace publish polish** — Better `/plugin install ask-llm` UX, version pinning guidance, upgrade story

## Completed

### Plugin Marketplace & Refinement (ADR-038/039/040/041)
- [x] **Marketplace distribution** — `.claude-plugin/marketplace.json` at repo root, `git-subdir` source, `/plugin marketplace add Lykhoyda/ask-llm` (ADR-038)
- [x] **Plugin rename** — `ask-gemini` → `ask-llm`, multi-provider description and keywords
- [x] **Agent colors** — cyan (Gemini), green (Codex), yellow (Ollama), magenta (brainstorm)
- [x] **Hooks → gemini CLI** — replaced `node dist/run.js` with `gemini -p @tempfile`, no build dependency
- [x] **Hook temp file cleanup** — `trap 'rm -f "$tmp"' EXIT HUP INT TERM` (ADR-040)
- [x] **MCP server names** — shortened from `gemini-cli`/`codex-cli` to `gemini`/`codex`, then moved to user-scope to avoid `plugin:` prefix
- [x] **/multi-review skill** — parallel Gemini + Codex code review with consensus highlighting
- [x] **Concurrency fix** — module-level progress state → `ProgressHandle` closure pattern in all 4 servers (ADR-039)
- [x] **Async stop()** — `ProgressHandle.stop()` now awaits final progress notification (ADR-040)
- [x] **Shared progress tracker** — extracted `createProgressTracker` into `@ask-llm/shared`, −180 lines (ADR-041)
- [x] **Package cleanup** — `bin` object form, `prompt_processed` → `promptProcessed`, ollama-mcp tsconfig ref
- [x] **Version bump** — all packages bumped to next minor (gemini 1.5.0, others 0.2.0)

### Priority 1: Critical Fixes (all resolved)
- [x] Fix deprecated `-p` flag for Gemini CLI v0.23+ (upstream PRs #56, #43)
- [x] Fix exit code 42 on Gemini CLI v0.29.5+: revert to `-p` flag for non-interactive mode (ADR-015)
- [x] Windows compatibility: ENOENT spawn errors, `.cmd` handling (upstream PRs #23, #27, #41, #43)
- [x] Add process timeout to prevent indefinite hangs (5min default, `GMCPT_TIMEOUT_MS` env var)
- [x] Fix all utils/ audit issues (logger, commandExecutor, geminiExecutor, parsers, cache)

### Priority 3: Gemini CLI Parameter Expansion (all resolved)
- [x] **Structured JSON output** — pass `--output-format json` (ADR-019)
- [x] **Multi-turn session support** — expose `--resume <sessionId>` (ADR-021)
- [x] **Include additional directories** — expose `--include-directories <dirs>` (ADR-022)
- [x] **Expose thinking tokens in stats** — display thinking token count in stats footer

### Priority 4: Features from Community PRs (partial)
- [x] MCP tool annotations per spec (upstream PR #46) (ADR-023)
- [x] Update default model to `gemini-3.1-pro-preview` (upstream PR #54)

### Priority 5: Open Issues (all resolved)
- [x] ~~Allow model configuration via MCP JSON settings~~ (upstream Issue #49) — Won't fix: per-call `model` param already exists; Gemini CLI picks its own default
- [x] ~~Fix excessive token responses for small prompts~~ (upstream Issues #6, #26) — Won't fix: root cause was `gemini-2.5-pro` model bug (always returned ~45k tokens); mitigated by changing default to `gemini-3.1-pro-preview`. Gemini CLI has no `--max-output-tokens` flag.
- [x] Add automated test suite (Vitest, 99 tests across 6 files, ADR-014)
- [x] Set up linter and formatter (Biome v2.4.4)

### Priority 6: Project Structure & Docs (all resolved)
- [x] Move deployable VitePress docs to `apps/docs/`
- [x] Keep `docs/` for internal project docs only (ROADMAP, DECISIONS, BUGS, plans/)
- [x] Update VitePress config, build scripts, and deploy workflow for new path
- [x] Remove public roadmap page from VitePress site
- [x] Redesign homepage: replace feature grid with tabbed SetupTabs installation component
- [x] Fix light theme readability: use `html:not(.dark)` selectors
- [x] Add orange syntax highlighting for JSON strings in light mode code blocks
- [x] Remove unused components (ClientGrid, CodeBlock, ConfigModal, ad/funding components)
- [x] Apply Prettier formatting to all docs Vue/CSS/JS files

### Priority 7: Distribution & Discovery (partial)
- [x] Publish to official MCP Registry via `mcp-publisher` (ADR-016)
- [x] Automated release workflow: `git tag v* && git push` → npm + MCP Registry (ADR-016)
- [x] ~~Smithery~~ (requires paid plan for stdio servers — skipped)
- [x] Add GitHub Release with changelog in release workflow
- [x] Improve npm discoverability: added keywords
- [x] Document global (user-scope) install option in README
- [x] Submit to awesome-mcp-servers list (PR [#2581](https://github.com/punkpeye/awesome-mcp-servers/pull/2581))
- [x] Submit to mcp.so and mcpservers.org directories

### CI & Workflow Hardening
- [x] Update all GitHub Actions to latest versions (checkout@v6, setup-node@v6, upload-pages-artifact@v4)
- [x] Add lint step to CI pipeline, remove `continue-on-error` on tests
- [x] Use `pull_request_target` for Claude auto-review to support fork PRs (ADR-025)
- [x] Fix Claude workflow permissions (`contents: write`, `pull-requests: write`, `additional_permissions`)
- [x] Add `labeled` trigger for `@claude` mentions on issue label events

### Priority 2: Claude Code Plugin (all resolved)
- [x] Add direct CLI binary `ask-gemini-run` (`src/run.ts`) — calls geminiExecutor directly, supports stdin piping
- [x] Create subagent `gemini-reviewer.md` — isolated Gemini review in separate context
- [x] Create `/gemini-review` skill — on-demand Gemini consultation via agent delegation
- [x] ~~Add Stop hook — background Gemini review of session changes~~ **Removed (ADR-048)** — `Stop` event fired per-turn not per-session, and `git diff HEAD` missed untracked files. Use `/gemini-review` on demand instead.
- [x] Add pre-commit hook — PreToolUse hook on Bash, reviews staged diff via Gemini before `git commit`
- [x] Bundle as Claude Code plugin (`plugin.json`, `.mcp.json`, agents, skills, hooks)
- [x] Add subpath export `ask-gemini-mcp/executor` for direct executor access (ADR-027)

### Other Completed
- [x] Remove non-core tools (`brainstorm`, `help`, `timeout-test`) per ADR-004
- [x] Transfer ownership: update all references from `jamubc/gemini-mcp-tool` to `Lykhoyda/ask-gemini-mcp`
- [x] Rewrite README.md with updated value proposition and accurate tool list
- [x] Remove previous owner sponsorship/funding content from docs
- [x] Update LICENSE copyright
- [x] Remove unused dependencies (`ai`, `chalk`, `d3-shape`, `inquirer`, `archiver`)
- [x] Delete dead code (empty `timeoutManager.ts`, missing `contribute.ts` script)
- [x] Clean up orphaned funding Vue components
- [x] Fix stale docs (commands.md, sandbox.md, getting-started.md)
- [x] Upgrade `@modelcontextprotocol/sdk` from 0.5.0 to ^1.27.0
- [x] Raise minimum Node.js to 20 (LTS only), update CI matrix to test 20, 22
- [x] Clean orphaned dist/ files from deleted sources
- [x] Rename project from `claude-ask-gemini-mcp` to `ask-gemini-mcp` (ADR-012)
- [x] MCP Registry publishing: `server.json`, `mcpName` in package.json (ADR-016)
- [x] Fix stale server name/version in `src/index.ts` — now reads from `package.json` at runtime
- [x] ~~Fix Smithery CJS bundling: `createSandboxServer()` export, separate CLI entry point (ADR-017)~~ — Smithery removed entirely in ADR-054 (no consumers; project distributes via npm + MCP Registry + Claude Code marketplace)
- [x] Fix `npx` bin resolution: renamed bin from `gemini-mcp` to `ask-gemini-mcp` to match package name
- [x] Prevent AI clients from using outdated models: updated tool/param descriptions
- [x] Expose thinking tokens in `formatStats` stats footer
- [x] Fix `extractJson` greedy first-match bug — now prefers Gemini-shaped JSON
- [x] Fix `extractJson` escape-outside-string bug — backslash escapes only inside JSON strings
