# Bug Reports

## Open

### ~~Legacy provider smoke runner never ran the provider suites, and log-wide quota matching could mask real failures~~ FIXED (ADR-150)
- **Severity:** Medium (the opt-in legacy live runner was not exercising the provider integration tests; after the first fix, a real Codex auth/integration failure could be skipped as "quota")
- **Discovered:** 2026-08-23, while validating issue #280 (PR #296); the second defect was raised as a P1 in PR review.
- **Root cause:** (1) `scripts/smoke-test.sh` ran `yarn workspace <pkg> run test`, which resolved the repository-root Vitest project (scripts only) instead of the package suite. (2) The first fix selected whole package directories, so unit tests ran too and `QUOTA_PATTERN` — scanned over the entire log — matched successful fixture strings from `packages/codex-mcp/src/__tests__/quota-detection.test.ts`, turning a non-quota failure into a quota skip.
- **Status:** **FIXED** (ADR-150): each smoke entry now runs exactly one `packages/<name>/src/__tests__/integration.test.ts` from the repository root, so the scanned log holds only live-integration output. `scripts/smoke-test.test.mjs` pins that every entry selects the intended package integration test (never the root project or a unit file) and that a non-quota Codex integration failure stays a hard failure. ADR-149's deterministic harness matrix remains the canonical pre-PR gate.

### codex-pair reviewer hallucinates "injected review prompt" findings on files containing box/arrow glyphs
- **Severity:** Medium (false HIGH findings; with the opt-in Stop gate enabled these could block sessions on phantom issues)
- **Discovered:** 2026-07-13/14, dogfooding during the docs-overhaul brainstorm/plan
- **Repro:** write a markdown/HTML file whose prose contains the glyphs `U+25AE` (black vertical rectangle) / `U+21C0` (rightwards harpoon) / `U+21BD` (leftwards harpoon), written here as code points because the literal characters retrigger the bug on edits to this very file (e.g. a bullet listing typographic glyphs). The per-edit codex-pair review reports a HIGH claiming "the entire review prompt / `<file_content>` markers were pasted into the file" at that line. Observed twice on two different files (`docs/superpowers/specs/2026-07-13-docs-overhaul-design.md:67`, `docs/superpowers/plans/2026-07-14-docs-overhaul-terminal-noir.md:23`); both verified clean (`grep -c "file_content"` returns 0).
- **Hypothesis:** the reviewer model conflates the glyph sequence in the diff with its own prompt-delimiter markers, i.e. a prompt/content boundary-confusion in the review payload rather than actual injection. Also observed (lower confidence): stale project context in the review prompt caused two MED false positives claiming `ask-claude-mcp` / GPT-5.6 don't exist while both are on the branch.
- **Fix direction:** delimit file content in the review prompt with unambiguous fenced markers (or base64/indent framing) so content glyphs can't read as structure; refresh the project-context snapshot the hook embeds.

### ~~`/compare` skill: two pre-existing robustness gaps (file context + temp-file race)~~ FIXED
- **Severity:** Low–Medium (pre-existing; surfaced by the codex-pair review of the 2026-07-04 Antigravity-parity edit, not introduced by it)
- **Discovered:** 2026-07-04, codex-pair review of `skills/compare/SKILL.md`
- **File:** `packages/claude-plugin/skills/compare/SKILL.md`
- **Gap 1 — `@file` context silently dropped for non-Gemini providers (Medium):** the skill (line ~27) tells Claude to "preserve the `@path/to/file` syntax in the per-provider prompt," but `@file` expansion is a **Gemini-CLI-only** feature. `codex-run.js` / `ollama-run.js` / `antigravity-run.js` receive `@path` as literal prompt text, so a compare that relies on file context sends only a path string to those providers. Fix: instruct the skill to read referenced files and inline their contents (or pipe via stdin) rather than relying on `@` for non-Gemini legs.
- **Gap 2 — shared `/tmp` filenames race across concurrent runs (Low):** the dispatch `rm -f /tmp/ask-llm-compare-*.out` + fixed per-provider filenames mean two overlapping `/compare` runs (or two sessions) can wipe/overwrite each other's outputs and surface the wrong provider response or a false failure. Fix: allocate a per-run dir via `mktemp -d` and thread it through the dispatch/read/present phases.
- **Note:** both are independent of the Antigravity leg added in PR #218; fixing either is a skill-behavior change (own PR).
- **Status:** **FIXED** (ADR-136): referenced files are now Read and inlined into the provider-neutral prompt; each invocation allocates a unique `mktemp -d` work directory, dumps labeled provider output before cleanup, and never touches another session's files. Contract tests pin both invariants.

### ~~`apps/docs/plugin/hooks.md` marketplace workaround relies on GNU-only `sort -V`~~ FIXED
- **Severity:** Low (docs-only; the workaround command silently misbehaves on macOS/BSD `sort`)
- **Discovered:** 2026-07-02, dogfood codex-pair review of the hooks docs page during the seamless-pairing pass
- **File:** `apps/docs/plugin/hooks.md` (marketplace-workaround "Form B" pipeline)
- **Recommended:** replace with a portable Node one-liner version picker, or give separate macOS/Linux commands.
- **Status:** **FIXED** (2026-07-09): Form B now uses a Node numeric `localeCompare` version picker and inherits stdin into the selected hook process.

### ~~`apps/docs/plugin/hooks.md` workaround ends with `/reload-plugins`, which does not re-register hooks~~ FIXED
- **Severity:** Low (docs-only; users can follow the workaround exactly and still see zero PostToolUse executions)
- **Discovered:** 2026-07-02, dogfood codex-pair review (second pass on the same page)
- **File:** `apps/docs/plugin/hooks.md` (marketplace-workaround closing step)
- **Description:** Claude Code binds hooks at session start; `/reload-plugins` doesn't re-register them in a live session (the plugin README says as much). The step should say "fully restart Claude Code", then verify with the `codex-pair-log` CLI that the hook fired.
- **Status:** **FIXED** (2026-07-09): the page now requires a full restart and gives an explicit log verification path.

### ~~`apps/docs/plugin/hooks.md` "CLI Binaries" section documents commands the marketplace install does not ship~~ FIXED
- **Severity:** Low (docs-only; misleading for normal plugin installs)
- **Discovered:** 2026-07-02, dogfood codex-pair review (second pass on the same page)
- **File:** `apps/docs/plugin/hooks.md` (CLI Binaries section)
- **Description:** `ask-*-run` bin entries point at `dist/*` files that aren't tracked in the git-subdir marketplace install path, so the documented commands don't exist for marketplace users. Scope the section to source-built/local-dev installs, or point users at the published MCP package CLIs (`npx ask-codex-mcp` etc.).
- **Status:** **FIXED** (2026-07-09): the hooks and overview pages now scope the binaries to built/linked source checkouts and direct marketplace users to MCP tools.

### ~~`parseGitPorcelain` does not decode git's C-style quoted paths~~ FIXED
- **Severity:** Low (fail-open direction; affects only paths with quotes/backslashes/control chars)
- **Discovered:** 2026-07-02, dogfood codex-pair review during the seamless-pairing pass
- **File:** `packages/claude-plugin/scripts/lib/stop-gate.mjs:13`
- **Description:** porcelain v1 quotes paths containing special characters; the parser strips the surrounding quotes but doesn't unescape the body, so such paths never match log-entry paths and the Stop-gate's `[B]` git-dirty filter drops their HIGH findings (fail-open, never a wrong block). Fix direction: `git status --porcelain=v1 -z` with a NUL parser.
- **Status:** **FIXED** (ADR-136): the Stop gate now invokes `git status --porcelain=v1 -z`; the parser preserves raw quotes, backslashes, control characters, and newlines, and handles NUL-mode rename source records. Regression tests cover renamed and special-character paths.

### ~~`/compare` excluded Antigravity while `/brainstorm-all` and `/multi-review` included it~~ FIXED
- **Severity:** Low (feature-parity gap; the skill's docs had been self-consistent with its implementation)
- **Discovered:** 2026-07-04, docs-consistency audit (flagged for a maintainer decision, then approved to fix)
- **File:** `packages/claude-plugin/skills/compare/SKILL.md`
- **Description:** `/compare` dispatched to gemini/codex/ollama only — three `*-run.js` legs — while `/brainstorm-all` and `/multi-review` both included Antigravity after it became a first-class provider (ADR-125/128). Not originally classed as docs drift (docs matched code); closing it was a deliberate behavior change.
- **Status:** **FIXED** (`docs/getting-started-antigravity-register`, PR #218): added the `antigravity-run.js` dispatch leg (ADR-050 backgrounding + per-PID wait), a fourth `### Antigravity` output section, and updated the description + default-set prose. The load-bearing contract test in `skills-and-agents.test.ts` now pins the `dist/antigravity-run.js` leg so it can't silently regress. Patch changeset for `@ask-llm/plugin`; 473 plugin tests green. (The same review surfaced two *pre-existing* robustness gaps in the skill — logged separately under Open.)

### ~~Docs omitted Antigravity + two factual errors across README env/tool tables (post-getting-started sweep)~~ FIXED
- **Severity:** Medium for the two factual errors (a user configuring the codex timeout, or reading the orchestrator's tool surface, gets wrong information); Low for the parity omissions
- **Discovered:** 2026-07-04, deterministic docs-consistency audit following the getting-started registration fix
- **Files:** `packages/codex-mcp/README.md`, `packages/llm-mcp/README.md`, `docs/CONTRIBUTING.md`, `apps/docs/providers/unified.md`, `apps/docs/plugin/overview.md`, `apps/docs/plugin/hooks.md`, `apps/docs/resources/faq.md`, `packages/claude-plugin/README.md`
- **Description:** (1) `codex-mcp/README.md` documented codex's per-call timeout as `GMCPT_TIMEOUT_MS`=`210000` (Gemini's default, copy-pasted) and omitted `ASK_CODEX_TIMEOUT_MS` — codex's real default is **800s**; (2) `llm-mcp/README.md`'s Tools table listed **per-provider** tools (`ask-gemini`, `ask-gemini-edit`, `fetch-chunk`, `ask-codex`, `ask-ollama`) as the orchestrator's surface, contradicting the single-`ask-llm`-tool design (ADR-029); (3) `CONTRIBUTING.md` listed the pre-push smoke legs as "Gemini, Codex, Ollama" after commit `8ff2b32` swapped the Gemini leg for Antigravity; (4) Antigravity (4th provider, ADR-128) was missing from several provider lists/counts ("all three" in unified/overview/hooks/plugin-README, the `ask-llm` provider param, `/brainstorm-all`'s "three external providers", the plugin CLI-binaries count). Same root cause as the getting-started and 2026-07-02 `llms.txt` drift: hand-written "Gemini, Codex, Ollama" trios and provider counts not backfilled when Antigravity landed.
- **Status:** **FIXED** (`docs/getting-started-antigravity-register`, PR #218): 16 spots across 8 files corrected — timeout row now shows `ASK_CODEX_TIMEOUT_MS`=`800000`; the orchestrator Tools table rewritten to the real `ask-llm`/`multi-llm`/`get-usage-stats`/`diagnose`/`ping` surface; smoke legs corrected; Antigravity backfilled into every count/list; session-continuity claims reworded to name the three session-capable providers explicitly. Verified with `grep 'gemini, codex, ollama'` minus `antigravity` (only legitimate non-provider hits remain).

### ~~`apps/docs/getting-started.md` omitted Antigravity from provider lists + the Claude Code registration block~~ FIXED
- **Severity:** Low (docs-only; the onboarding page under-documented a shipped provider, so a new user following Getting Started never saw how to register `agy`)
- **Discovered:** 2026-07-04, docs pass ("update docs — it should register agy")
- **File:** `apps/docs/getting-started.md`
- **Description:** `installation.md`, `README.md`, and both AI-readable files (`public/llms.txt`, `public/llms-full.txt`) all register Antigravity (`claude mcp add … antigravity -- npx -y ask-antigravity-mcp`), but the older Getting Started onboarding page — written around the original 3-provider (Gemini/Codex/Ollama) story — was never backfilled after Antigravity shipped (ADR-125 / PR #192). The same drift left a hardcoded "install one or all three" count and a "(Gemini, Codex, or Ollama)" start-with example. Root cause matches the 2026-07-02 `llms.txt` drift bug: two pages document the same install story and only the newer one was kept current when the provider set grew.
- **Status:** **FIXED** (`docs/getting-started-antigravity-register`): Antigravity added to the Step-2 per-provider package list and the Option A `claude mcp add` block (reordered Codex → Antigravity → Ollama → Gemini to match the page's own "which provider first?" tip); the two hardcoded provider counts made provider-neutral ("all of them", "(Codex, Antigravity, Ollama, or Gemini)") to resist recurrence. Registration parity verified across all five doc surfaces.

### ~~AI-readable docs (`llms.txt` / `llms-full.txt`) advertised a wrong `fetch-chunk` param name and other schema drift~~ FIXED
- **Severity:** High for the headline (an AI agent following the reference sends an argument the Zod schema rejects); Medium for the rest
- **Discovered:** 2026-07-02, dogfood codex-pair review during the AI-readable docs drift-fix pass (the HIGH was pre-existing in the original files, not introduced by the fix)
- **Files:** `apps/docs/public/llms.txt`, `apps/docs/public/llms-full.txt`
- **Description:** the `fetch-chunk` tool documented its cache-key parameter as `chunkCacheKey`, but the live schema (`packages/gemini-mcp/src/tools/fetch-chunk.tool.ts`) names it `cacheKey` — an agent passing `chunkCacheKey` fails validation and can never retrieve chunked edit output. Same pass corrected: a phantom per-call `model` param documented for `ask-antigravity` (schema is `{ prompt, includeDirs }` — model is env-only via `ASK_ANTIGRAVITY_MODEL`); omitted `sessionId` on `ask-gemini` / `ask-ollama` / `ask-llm` and omitted `sessionId` + `includeDirs` on `ask-codex-edit`. Root cause: these two files are hand-maintained with no drift guard (unlike tool descriptions, which embed `FACTORY_DEFAULT_MODEL` via template literals + contract tests), so they lagged the provider set (Antigravity added later) and the actual tool schemas.
- **Status:** **FIXED** (`docs/llms-txt-antigravity-parity`): every documented tool now matches its `z.object` input schema; every quoted model name matches its `FACTORY_DEFAULT_MODEL`/fallback constant character-for-character (verified). Follow-up candidate: a drift-guard test that parses the tool tables in these `.txt` files against the registered tool schemas, closing the class permanently.

### ~~codex-pair auto-pause is sticky forever — a fixed provider stays paused until manual resume~~ FIXED (ADR-130)
- **Severity:** High (silently disables the entire feature; empirically hit)
- **Discovered:** 2026-07-02 seamless-pairing audit — the dogfood repo auto-paused 2026-06-14 on the pre-ADR-126 `gpt-5.5-mini` 400 and was still paused 18 days later, after the cause had shipped fixed; all 315 log entries in the trailing 14 days were `skipped — auto-paused`
- **Files:** `packages/claude-plugin/scripts/lib/state.mjs`, `codex-pair-watch.mjs`, `codex-pair-session.mjs`
- **Root cause:** ADR-120 shipped auto-pause with notify-once and "no expiry logic"; nothing reminded, retried, or expired
- **Status:** **FIXED** (`feat/codex-pair-seamless-pairing`, ADR-130): TTL expiry (quota 6h / failures 24h, env-overridable), immediate expiry of failures-pauses on plugin-version change, SessionStart reminder/auto-resume via `additionalContext`, per-edit auto-resume with clean re-pause on continued failure

### ~~codex-pair verdicts ride an undocumented channel — `systemMessage` is not the documented model-visible output~~ FIXED (ADR-130)
- **Severity:** High (the pairing partner's visibility of every verdict depends on undocumented harness behavior)
- **Discovered:** 2026-07-02 audit; verified against current Claude Code hooks docs, then empirically observed that the current build does relay `systemMessage` — i.e. working today, but by accident of an undocumented behavior
- **File:** `packages/claude-plugin/scripts/codex-pair-watch.mjs` (`emitSystemMessage`)
- **Status:** **FIXED** (ADR-130): every emission now carries both `systemMessage` (transcript) and PostToolUse `hookSpecificOutput.additionalContext` (the documented model channel)

### ~~`/codex-pair-resume` leaves the failure counter at threshold — next single failure re-pauses instantly~~ FIXED (ADR-130)
- **Severity:** Medium
- **Discovered:** 2026-07-02 audit
- **Files:** `packages/claude-plugin/skills/codex-pair-resume/SKILL.md`, `scripts/lib/state.mjs`
- **Status:** **FIXED** (ADR-130): the skill removes `state/failures.json` alongside the sentinel; programmatic resume paths use `clearAutoPause`, which clears both (and never touches manual pauses)

### ~~Stop-gate blind to in-flight reviews — HIGH findings land after turn-end~~ FIXED (ADR-130)
- **Severity:** Medium (defeats the `blockOn: HIGH` guarantee in the common timing; measured p50 review latency 35.5s vs. sub-minute turns)
- **Discovered:** 2026-07-02 audit; the worker-handoff sub-gap was then caught by the dogfood codex-pair review of this very fix branch
- **Files:** `packages/claude-plugin/scripts/codex-pair-stop-gate.mjs`, `lib/stop-gate.mjs`, `lib/debounce-state.mjs`, `codex-pair-debounce-worker.mjs`
- **Status:** **FIXED** (ADR-130): gate blocks once per turn on unconsumed debounce records, fresh inflight locks, and the new worker `reviewing` marker; queued verdicts drain at Stop without requiring the `blockOn` opt-in. The drain was cwd-anchored like all Stop/prompt hooks — cross-repo edits (cwd in repo A, edit in repo B) were the known residual gap, tracked in #209 → **now FIXED (ADR-131)**: a session-scoped marker registry (`scripts/lib/session-registry.mjs`) lets the Stop drain + gate and the UserPromptSubmit drain act on every repo edited this session, not just cwd

### ~~`ask-ollama` chat call has no timeout — a wedged Ollama server hangs the tool forever~~ FIXED
- **Severity:** High (the only executor with no timeout of any kind; the MCP keep-alive makes the hang indefinite)
- **Discovered:** 2026-07-02, repo-wide weak-spot audit (5-agent sweep; verified by reading the code)
- **File:** `packages/ollama-mcp/src/utils/ollamaExecutor.ts:89-93`
- **Root cause:** `callOllama()` POSTs to `/api/chat` via raw `globalThis.fetch` with no `AbortSignal`, while `isProviderAvailable()`/`listModels()` in the same file correctly use `AbortController` + `AVAILABILITY_TIMEOUT_MS`. Native fetch has no default timeout, so a hung Ollama server (model-load deadlock, GPU wedge) blocks the MCP call forever. Gemini defaults to 210s, Codex to 800s (`ASK_CODEX_TIMEOUT_MS`); Ollama has nothing.
- **Recommended:** `AbortController` + env-configurable timeout (`ASK_OLLAMA_TIMEOUT_MS`, generous default — local models legitimately take minutes) mirroring the Codex precedent, plus timeout tests (the test file covers availability/listModels timeouts but has zero timeout assertions on the chat path).
- **Status:** **FIXED** (`fix/audit-2026-07-02-hardening`): `callOllama()` now takes a timeout resolved via `ASK_OLLAMA_TIMEOUT_MS` > `GMCPT_TIMEOUT_MS` > 600s default; the timer stays armed through the body read (headers-then-stall also aborts); abort throws an actionable error naming the env var. TDD: signal-presence + stalled-request tests.

### ~~Antigravity is not threaded through the llm-mcp/shared type layer (scattered provider enums drifted)~~ FIXED (ADR-128)
- **Severity:** Medium (wrong public schema contract today; latent runtime validation break)
- **Discovered:** 2026-07-02 audit; confirms the 2026-06-07 migration-scope note that shared/multiLlm/doctor keep their own provider enums independent of `askResponseSchema`.
- **Files:** `packages/llm-mcp/src/multiLlm.ts:25,122`, `packages/shared/src/usage.ts:2`, `packages/shared/src/registry.ts:35`, `packages/llm-mcp/src/repl.ts:21`, `packages/claude-plugin/.claude-plugin/plugin.json:4`, `/.claude-plugin/marketplace.json`, `packages/claude-plugin/src/__tests__/manifest.test.ts:131`, `packages/claude-plugin/agents/brainstorm-coordinator.md:22`
- **Description:** `usageStatsSchema.provider` is `z.enum(["gemini","codex","ollama"])` and is wired as the `multi-llm` tool's `outputSchema` (`llm-mcp/src/index.ts:268`) whose own description advertises Antigravity — the declared contract says antigravity usage is invalid. `UsageStats.provider` union omits `"antigravity"`; registry `category` omits it; REPL `/help` omits it; plugin.json + marketplace.json description/keywords still say "Gemini, Codex, and Ollama"; the manifest test asserts "declares all three runner binaries" while four exist (`ask-antigravity-run` never asserted); brainstorm-coordinator.md:22 names (Gemini, Codex, Ollama) though the default dispatch is `antigravity,codex`. Latent only because the antigravity executor never returns token `usage` (`dispatchMultiLlm`, multiLlm.ts:78,85, propagates usage only when present) — the moment antigravity reports usage, `structuredContent` violates the declared outputSchema.
- **Root cause:** no single source of truth for the provider list — every surface hand-maintains its own enum/union/string.
- **Recommended:** canonical `PROVIDERS` const in `@ask-llm/shared` with derived `z.enum`/type unions everywhere + a drift test (the `codex-pair-defaults.json` ↔ `constants.ts` parity guard is the in-repo precedent).
- **Status:** **FIXED** (`fix/audit-2026-07-02-hardening`, ADR-128): shared `providers.ts` `PROVIDERS` tuple + `ProviderName`; all listed surfaces now derive or are pinned by drift-guard tests (llm-mcp `constants.test.ts`, per-package tool-contract tests, plugin manifest assertions).

### ~~antigravity-mcp is the only server without the shared keep-alive progress tracker~~ WITHDRAWN (invalid finding)
- **Status:** **Withdrawn 2026-07-02** during the fix pass — the finding was wrong. Every server, antigravity included, inherits the keep-alive progress tracker from shared `registerTools()` (`packages/shared/src/serverFactory.ts:178`; the ADR-053 centralization). The audit grep looked for a direct `createProgressTracker` import inside the package and missed the factory wiring. The ping's 5s ceiling is likewise deliberate and documented in-code (`simple-tools.ts`: "a hung agy must not block ping for minutes", #153 review) with a graceful agy-not-found fallback. No change needed.

### ~~chunkCache writes world-readable files in shared /tmp~~ FIXED
- **Severity:** Medium (info leak on multi-user machines; single-user dev boxes unaffected in practice)
- **Discovered:** 2026-07-02 audit
- **File:** `packages/shared/src/chunkCache.ts:20,43-44`
- **Description:** `mkdirSync(CACHE_DIR, { recursive: true })` and `writeFileSync(tmpPath, ...)` omit `mode`, so with default umask the cache dir (`/tmp/gemini-mcp-chunks/`) is 0755 and chunk files 0644 — cached changeMode chunks contain user code/edit content readable by any local user. `sessions.ts` in the same package already does this right (`SESSION_DIR_MODE`/`SESSION_FILE_MODE` at :51/:139).
- **Recommended:** mirror the sessions.ts modes; add a permissions test.
- **Status:** **FIXED** (`fix/audit-2026-07-02-hardening`): dir created 0700 (and chmod-tightened when created by older releases), chunk files written 0600; permissions tests skip on win32.

### ~~Gemini executor lacks the empty-string-sessionId cache guard Codex/Ollama have~~ VERIFIED + FIXED
- **Severity:** Low-Medium — **needs verification before filing** (code-compared during the audit, not runtime-reproduced)
- **Discovered:** 2026-07-02 audit
- **Files:** `packages/gemini-mcp/src/utils/geminiExecutor.ts:546` vs `codexExecutor.ts:349-350` / `ollamaExecutor.ts:153-154`
- **Description:** Codex/Ollama disable the response cache whenever `sessionId !== undefined` (empty string included — both behaviors tested); Gemini builds its cache key without an equivalent `wantsSession` guard, so `sessionId: ""` may serve a cached response instead of performing a session turn. No gemini test covers empty-string sessionId.
- **Status:** **FIXED** (`fix/audit-2026-07-02-hardening`): verified real — `isCacheable = !sessionId` (falsy check) at `geminiExecutor.ts:544` meant `sessionId: ""` could return a cached body with `sessionId: undefined`. Now `wantsSession = sessionId !== undefined` gates caching, matching codex/ollama; regression test reproduced the bug first (TDD). Bonus: `includeDirs?.sort()` no longer mutates the caller's array.

### `agy` (Antigravity) read-only guard remains soft — raw-call bypass FIXED
- **Severity:** Medium — the provider's PRIMARY use case is read-only second-opinions/reviews, yet `agy` can silently modify the repo.
- **Discovered:** 2026-06-09, while asking `agy` to *critique* the #142 stop-gate design. It went ahead and **implemented the whole feature** (created/edited 6 files on `main`, ran the test suite) instead of just reviewing. Changes were reverted; no harm, but the behavior is the concern.
- **Root cause:** `agy` is an agentic CLI run with `--dangerously-skip-permissions` (required to avoid headless `-p` approval-prompt hangs). `--sandbox` only restricts the *terminal*, not file writes. `agy` 1.0.6 has **no hard read-only / tool-restriction flag**. The only guard is a **soft** prompt preamble (`READ_ONLY_PREAMBLE`, `packages/antigravity-mcp/src/constants.ts`) — and it is prepended **only on the MCP-tool path**.
- **Remaining gap:** Even with the preamble and `--sandbox`, the constraint is **soft** — agy may ignore it because upstream exposes no hard read-only control for file tools.
- **Recommended:** for a hard guarantee, run review-mode `agy` in an isolated throwaway checkout/container; continue tracking upstream for a real `--read-only` / `--allowed-tools` mode.
- **Status:** **PARTIALLY FIXED** (ADR-136): every managed raw `agy` path now prepends the same read-only preamble as the MCP executor and adds `--sandbox`; contract tests prevent that bypass from returning. The upstream hard-isolation limitation remains open and explicit.

### Codex quota fallback broken for CLI 0.137+ ("You've hit your usage limit") — also blocked unrelated pushes
- **Severity:** ~~Low (local DX)~~ → **Medium** (refined): the real impact is a **user-facing** quota-fallback regression, not just a local pre-push annoyance.
- **Discovered:** 2026-06-08 (as a generic "smoke fails on live codex"); **root-caused 2026-06-09** while pushing a docs-only commit.
- **Refined root cause (2026-06-09):** Codex `0.137.0` reports plan exhaustion as `{"type":"error","message":"You've hit your usage limit. ... try again at <date>"}` on **stdout JSONL** while exiting non-zero, with only a benign `Reading additional input from stdin...` on stderr. Two stale layers hid it: (1) `executeCommand` discarded stdout on non-zero exit (`stderr.trim() || "Unknown error"`), so the quota text never reached `isQuotaError()`; (2) codex `QUOTA_SIGNALS` (tuned for 0.134 per #127) lacked the `usage limit` phrasing. Net: the gpt-5.5 → gpt-5.5-mini fallback **silently never fired** for real users, and the pre-push smoke (ADR-043) hard-failed instead of skip-with-warning (ADR-051).
- **Workaround (historical):** `git push --no-verify` when the diff is provably unrelated to codex (verify with `git show --stat`).
- **Status:** **FIXED** by ADR-117 (`fix/codex-usage-limit-quota-detection`): `commandExecutor` now unions stderr+stdout on non-zero exit; `sanitizeErrorForLLM` + codex `QUOTA_SIGNALS` + smoke `QUOTA_PATTERN` all recognize `usage limit`. Residual (unchanged): if the codex CLI is broken in some *other* way (not quota), the pre-push smoke can still block unrelated pushes — `--no-verify` remains the escape for provably-unrelated diffs.

### codex-pair quota fallback to `gpt-5.5-mini` is rejected on ChatGPT-plan accounts → wrong auto-pause kind, lost reset hint
- **Severity:** Medium — breaks the codex-pair quota *degradation* path for an entire account class (ChatGPT-plan Codex users): a primary-model quota error should pause cleanly with a reset hint, but instead cascaded to the 3-failure backstop with no hint.
- **Discovered:** 2026-06-14, dogfooding — codex-pair auto-paused mid-session with `{"type":"error","status":400,…"The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account."}` (the #176 backstop firing for real).
- **Root cause:** `runCodexWithFallback` (`packages/claude-plugin/scripts/codex-pair-watch.mjs`) only falls back to `gpt-5.5-mini` after a **primary quota** error (`:862`), then only tagged `quotaExhausted` when the FALLBACK error was *itself* a quota error (`:874`). On ChatGPT plans `gpt-5.5-mini` is structurally unavailable (a 400, not a quota — plan quota is account-wide, so a cheaper fallback never applied), so the fallback error went untagged → `recordReviewFailure` → 3-failure backstop (`kind:"failures"`, no reset hint) instead of the clean #176 quota pause. Control flow proves exhaustion: we only reach the fallback catch because the primary was quota-dead, so if the fallback also can't run there is no usable model.
- **Fix:** added `isModelUnavailableError` (signal `"is not supported when using codex with a chatgpt"`); when the fallback fails structurally after a primary quota, treat it as the same "no usable model" exhaustion as the no-ladder case (`:880`) — tag `quotaExhausted` and re-throw the **primary** quota error so its reason + reset hint reach the pause notice. TDD: new `quota-plan-chatgpt` fake-codex scenario + a test asserting a single edit pauses as `kind:"quota"` with the reset hint.
- **Related (since fixed):** the published `ask-codex-mcp` executor (`codexExecutor.ts:419`) shared the same fallback assumption and surfaced only a generic terminal error. The default-fallback half was fixed by ADR-126 (→ `gpt-5.4-mini`); the graceful-message half — porting `isModelUnavailableError` into `codexExecutor.ts` for a pinned-incompatible fallback — was fixed by ADR-127 (#196), see "Fixed (pending publish)" above.
- **Status:** **FIXED** (`fix/codex-pair-chatgpt-fallback`, ADR-123). Plugin is `private` — ships via the next `@ask-llm/plugin` release.

### Side-finding (unfiled) — former `MODELS.FLASH` (`gemini-3.5-flash`) returned `404 ModelNotFoundError`
- **Severity:** Medium (a Gemini quota→Flash fallback or override may be silently broken)
- **Discovered:** 2026-06-05, while dual-reviewing the #140 plan via the live `gemini` CLI.
- **Symptom:** `gemini -m gemini-3.5-flash -p ...` on gemini-cli 0.44.1 returned `404 ModelNotFoundError: Requested entity was not found`, while `gemini -m gemini-3.1-pro-preview` returned `429 MODEL_CAPACITY_EXHAUSTED` (transient) and `gemini -m gemini-3-flash-preview` worked. ADR-138 changed the configured `MODELS.FLASH` default to `gemini-3.6-flash`, so 3.5 is no longer the factory fallback, but it can still be selected through `ASK_GEMINI_FALLBACK_MODEL`.
- **Status:** **Needs verification before filing.** Google's current catalog lists `gemini-3.5-flash`, but acceptance through the supported Gemini CLI path and account tier remains unproven: the recorded 0.44.1 probe returned 404, while the 0.46.0 probe performed for ADR-138 failed pre-model on authentication. Verify any selected fallback through the supported CLI path before relying on it; catalog presence alone does not make 3.5 a verified rollback. Independent of #140.

### #115 — `npx ask-llm-mcp doctor` ERR_MODULE_NOT_FOUND on `zod/index.js` (Node 26, global install)
- **Severity:** High (blocks any Node 26 user of `ask-llm-mcp` via global install)
- **Upstream issue:** [#115](https://github.com/Lykhoyda/ask-llm/issues/115)
- **Reporter:** twardoch (external)
- **Affected versions:** `ask-llm-mcp` all versions to date on Node v26.0.0 (any platform; reproduced on macOS arm64)
- **Status:** **FIXED (published 2026-06-10, v1.6.11 line)** by ADR-119 (`fix/115-inline-bundle-shared`, 2026-06-10): tsdown inlines `@ask-llm/shared` into each MCP's `dist/`; `bundledDependencies` + prepack/postpack deleted repo-wide, so the npm-11 global-install trigger no longer exists. Verified end-to-end on the same Node 26.0.0 + npm 11.12.1 that reproduced the bug: cold-cache (`npm cache clean --force` — a warm cache MASKS the bug, key Task-1 finding) global install of the old 0.3.15 crashes; the fixed tarballs install with a healthy tree (zod REAL, no empty placeholders) and all four provider bins answer MCP initialize. Permanent CI guard: Node 20+26 cold-cache global-install smoke (verdaccio for the orchestrator, `ask-*` packages never proxied). Note: the changesets cascade does NOT cross the new devDep edge (verified) — shared changes now REQUIRE explicit 5-package changesets, enforced by `scripts/check-shared-changeset.mjs`.
- **Actual root cause** (verified 2026-05-27): npm 11's global install + `bundledDependencies` interaction. The bundled workspace packages extract correctly, but their declared transitive deps that aren't bundled get 78 empty placeholder directories. Local install on the same Node 26 binary works correctly — the bug is specifically in npm 11's global install path.
- **Two viable fix paths under evaluation** (Tier-B work):
  - **B1: Inline-bundle via esbuild/tsup** — each MCP's `dist/` becomes a single self-contained file with `@ask-llm/shared` inlined. Drops `bundledDependencies` entirely. Keeps shared `private: true`. New build pipeline to vet.
  - **B2: Public `@ask-llm/shared` after proper scope setup** — manually create the `@ask-llm` org on npm, verify with a `0.0.0-test` sandbox publish from a feature branch, then flip shared to public. Codex's brainstorm ruled out the "publish AND inline-bundle" hybrid (if shared is in `dependencies`, npm installs it; if not, publishing is irrelevant — pick one mechanism, not both).

### #96 — codex-pair "next-turn surface" never fires for HIGH/MED findings
- **Severity:** High (silently neutralizes ADR-077's 5x recall promise)
- **Upstream issue:** [#96](https://github.com/Lykhoyda/ask-llm/issues/96)
- **Reporter:** Lykhoyda (dogfooding against a non-trivial repo)
- **Affected versions:** ask-llm plugin 0.6.2 (likely still present in 0.7.x — needs verification)
- **Symptom:** After enabling codex-pair with a marker file and producing 3 reviews that contained HIGH/MED concerns (verified via `.codex-pair-log.jsonl`), no `[codex-pair] <file>` system reminder appeared on the subsequent turn. The reviewer is working — findings land in the log — but the documented surfacing path to Claude is silent.
- **Repro:** (1) enable codex-pair with a marker; (2) write a file containing a clear HIGH (e.g. `new RegExp(\`${userInput}\`)`); (3) wait for verdict `concerns` in the log; (4) make any other tool call; (5) observe no `[codex-pair]` system reminder visible to the model.
- **Suspected root cause:** The systemMessage emission might be buffered/swallowed at the PostToolUse-hook boundary, or the surface might be attached to the wrong event sequence. ADR-095 already documented "consumption discipline" as load-bearing — without the surface firing, that discipline can't run.
- **Status:** ✅ Resolved. **Bug 1 (next-turn surface)** was fixed by the v0.7.0 broker rework — verdicts surface synchronously on review-completion (`codex-pair-watch.mjs:1151`) or cache-hit on a later edit (`:1031`), covered by the "surfaces HIGH+MED via systemMessage" test; the 0.6.2 report hit a stale/coalesced path. **Idea 2 (verdict-header `→ see <log>` pointer) shipped.** **Bug 2 / Idea 1 (edit-debounce)** is fixed on branch `feat/codex-pair-edit-debounce` → PR #144 (ADR-112): a detached delayed-worker collapses a burst of same-file edits into one review of the settled state and surfaces the verdict on the next PostToolUse drain or a new `UserPromptSubmit` drain. Confirmed by a live real-codex smoke (3 edits → 1 review; trailing verdict surfaced). Closes #96.

## Fixed — Upstream-Issue Consolidation (2026-05-30, ADR-109)

### ~~brainstorm-coordinator dispatched the removed `codex exec --full-auto` flag~~ FIXED (Block 3)
- **Severity:** High — the `/brainstorm` Codex participant was **fully broken**, not merely degraded.
- **Upstream issues:** #37 / #38 / #52
- **Root cause:** codex rust-v0.128+ removed `--full-auto` (it had been sugar for `--sandbox workspace-write`). On the installed codex 0.135, `codex exec --full-auto` errors with "unexpected argument", so `packages/claude-plugin/agents/brainstorm-coordinator.md:97` produced a non-zero codex exit on every brainstorm — Codex silently dropped out of multi-LLM brainstorms while the run still reported "success" from the other providers. The MCP executor had already migrated (ADR-075); only the plugin agent was left behind, which the executor-only verification of #38/#52 missed.
- **Fix:** `codex exec --full-auto -` → `codex exec --sandbox workspace-write -` (matches the executor; `-` reads the prompt from stdin). Stale `apps/docs/providers/codex.md` claim corrected. Regression guard in `skills-and-agents.test.ts` asserts no agent file ships `--full-auto`.
- **Verified:** live `echo "…" | codex exec --sandbox workspace-write -` exits 0 with correct output; both `/multi-review` providers confirmed the invocation against codex-cli 0.135.0 (Codex checked its own `--help`).

## Fixed — Internal Bug Hunt (2026-05-29, branch `fix/bug-hunt-2026-05-29`)

A repo-wide bug sweep (8 parallel review agents; every finding re-verified by reading the code before fixing) landed nine fixes, all TDD'd (failing test first) and green across the full suite + lint + types. Not yet published.

- **🔴 Critical — changeMode legacy parser infinite loop** (`packages/shared/src/changeMode/changeModeParser.ts`): the legacy-format branch did `continue` on a filename mismatch without advancing the regex iterator, so `match`/`lastIndex` never moved → hard hang (CPU pinned) of any `ask-gemini-edit` request hitting the legacy format with a renamed file. Fixed by inverting to push-on-match and always advancing at the loop bottom. Regression tests added.
- **🟠 High — REPL hangs forever on Ctrl-D / piped EOF** (`packages/llm-mcp/src/repl.ts`): `node:readline/promises` `question()` never settles on stream close, and the loop relied on it rejecting. Extracted `runReplLoop`/`questionOrEof` (races the question against the `close` event → resolves `null` on EOF). Also fixes `echo … | ask-llm-mcp repl` hanging at end-of-input.
- **🟠 High — chunkCache cross-process corruption** (`packages/shared/src/chunkCache.ts`): non-atomic `writeFileSync` + a reader that `unlinkSync`'d any file it couldn't `JSON.parse`, so a concurrent partial read destroyed the writer's in-flight file. Fixed with atomic temp+rename writes and by no longer deleting on parse error (TTL/cap reclaim stale files).
- **🟠 High — codex-pair broker orphaned-socket lockout** (`packages/claude-plugin/scripts/lib/broker-lifecycle.mjs`): the deterministic unix socket was never unlinked before bind, so a broker killed after binding but before writing its descriptor left an orphan → permanent `EADDRINUSE` (silent per-edit fallback forever). Fixed by unlinking the stale socket before bind, path-gated by `extractSafeSocketPath`.
- **🟠 High — codex-pair broker post-handshake hang → hard error instead of fallback** (`packages/claude-plugin/scripts/lib/broker.mjs`): a `thread/start`/`turn/start` request timeout rejected without `brokerFailure`, so `runCodexWithFallback` rethrew instead of falling back to per-edit spawn (violating ADR-077). Fixed via a `brokerRequest` wrapper that tags transport/timeout failures (`err.code === undefined`) while leaving genuine JSON-RPC error responses untouched.
- **🟡 Medium — commandExecutor SIGKILL timer leak** (`packages/shared/src/commandExecutor.ts`): the 5s post-SIGTERM SIGKILL `setTimeout` was never stored, `unref`'d, or cleared, so every timeout pinned the event loop ~5s and delayed child-process GC. Fixed by tracking + `unref`-ing it and clearing it on `close`/`error`.
- **🟡 Medium — `file:`→`@` prompt corruption** (`packages/gemini-mcp/src/utils/geminiExecutor.ts`): the unanchored `/file:(\S+)/g` mangled substrings (`profile:` → `pro@`, `Makefile:`, `file://` URLs) in changeMode prompts. Extracted `convertFileSyntaxToAt` with an anchored `/(^|\s)file:(?!\/\/)(\S+)/g`.
- **🟡 Medium — `enforceLimit` TOCTOU** (`packages/shared/src/sessions.ts`, `chunkCache.ts`): a `statSync` inside `.map()` with no per-file guard threw (silently aborting cap enforcement) if a sibling file vanished mid-iteration → unbounded `/tmp` growth under concurrency. Fixed by guarding each `statSync` and filtering failures.
- **🟡 Medium — `saveSession` silent write failure** (`packages/shared/src/sessions.ts`): a failed write was swallowed while `appendAndSaveSession` still reported success → silent loss of multi-turn continuity. `saveSession` now returns `boolean`; `appendAndSaveSession` surfaces `persisted`. (Executors have the signal; wiring each to act on it is a small follow-up.)

**Corrected — NOT a bug (do not re-raise):** the headline "Critical — published packages still ship `workspace:*`" finding was a **false positive**. `npm view` does show `workspace:*` in the published `dependencies`, but the packument also carries `bundleDependencies`, so npm uses the bundled copies and never resolves those specs. Empirically verified: `npm install ask-llm-mcp@0.3.10` succeeds identically on **npm 9.8.1, 10.9.2, and 11.14.1**. The `workspace:*` strings are cosmetic. See ADR-108.

**Intentionally not changed:** ollama `isModelNotFoundError` matching bare `"not found"` — existing tests encode this as the intended fallback trigger; tightening it would contradict the project's own contract for a marginal edge case.

## Fixed (pending publish)

### #196 — published `codex-mcp` executor surfaced a raw 400 (with a misleading `codex doctor` hint) when a pinned `ASK_CODEX_FALLBACK_MODEL` is account-incompatible
- **Severity:** Low — only affects a user who deliberately pins an account-incompatible fallback (e.g. `ASK_CODEX_FALLBACK_MODEL=gpt-5.5-mini` on a ChatGPT-plan account) **and** uses the MCP tool path (the codex-pair hook was already guarded by ADR-123). The default fallback (`gpt-5.4-mini`, ADR-126) works on all account types, so the common case is unaffected.
- **Issue:** [#196](https://github.com/Lykhoyda/ask-llm/issues/196) (follow-up filed from the PR #195 / ADR-126 review; flagged non-blocking by the Claude PR-review bot)
- **Symptom:** Primary `gpt-5.5` hits quota → executor retries the pinned fallback → fallback returns `400 "…is not supported when using Codex with a ChatGPT account"` → user sees the generic `gpt-5.5 quota exceeded, <model> fallback also failed: <400>. Run \`codex doctor\` …` (`codexExecutor.ts:419-423`). `codex doctor` cannot diagnose an account-type model restriction, so the hint actively misleads.
- **Root cause:** Sibling-path drift. ADR-123 added `isModelUnavailableError` to the codex-pair hook (`codex-pair-watch.mjs`) but not to the published `codexExecutor.ts`, which kept only the generic both-failed message — recorded at the time as the "Related (NOT fixed here)" note below and as ADR-126's deliberately-deferred alternative (a).
- **Fix (ADR-127):** Ported `MODEL_UNAVAILABLE_SIGNALS` + an exported `isModelUnavailableError` predicate into the executor; the quota-fallback `catch` now special-cases a structural-unavailability 400 with an actionable message that names the model, states it's unavailable for this account type, and points at `ASK_CODEX_FALLBACK_MODEL` (`gpt-5.4-mini` default called out as universal). Detection runs only on the FALLBACK leg (a primary 400 isn't quota, so it never enters the branch). All other error paths keep their exact prior message.
- **Verification:** TDD (RED→GREEN). `ask-codex-mcp` 98 tests + lint clean (6 new: predicate classification + actionable-message + preserved-generic-message + remediation-wording ×2 from the PR #198 review); full monorepo suite green; `executeCodexCLI` signature unchanged so the orchestrator is unaffected.
- **Status:** Fixed — pending publish (changeset `codex-mcp-pinned-fallback-message`, patch `ask-codex-mcp`; `ask-llm-mcp` auto-bumps).

### #194 — Codex quota fallback `gpt-5.5-mini` is rejected (400) on ChatGPT-plan accounts → fallback never produced a cheaper answer
- **Severity:** High — the quota-fallback path (a reliability safety net) was broken for the common case. More load-bearing since the live Gemini consumer cutoff redirects those users to `ask-codex`.
- **Issue:** [#194](https://github.com/Lykhoyda/ask-llm/issues/194) (filed by the 2026-06-19 scheduled drift-audit)
- **Symptom:** On a Codex quota error, the fallback retry shelled out `codex exec -m gpt-5.5-mini …`. The issue framed `gpt-5.5-mini` as a non-existent model; the live probe (CLI 0.141.0, ChatGPT-plan account) showed it is actually rejected with `400 "The 'gpt-5.5-mini' model is not supported when using Codex with a ChatGPT account."` — an account-type restriction, not a 404. `gpt-5.4-mini` answers `pong` (exit 0). Either way the fallback failed → `…fallback also failed` (`codexExecutor.ts:419-423`) instead of a cheaper answer.
- **Root cause:** ADR-067 set the fallback to `gpt-5.5-mini`. Plan quota on ChatGPT accounts is account-wide, so a cheaper-model fallback never applied there — and ChatGPT-plan is the common case for the `codex` CLI. ADR-123 had found the same 400 but deliberately kept `gpt-5.5-mini` (deeming the failure account-type-specific) and only made codex-pair *pause* cleanly; the published `ask-codex-mcp` executor still surfaced a terminal error and never got a working fallback. Existing quota-fallback tests mocked the fallback response, so the slug was never validated against a live Codex — a latent gap, not a new 0.141 regression.
- **Fix (ADR-126):** Default `MODELS.FALLBACK` → `gpt-5.4-mini` (works on ChatGPT-plan **and** API-key accounts), mirrored in `codex-pair-defaults.json` + `codex-pair-watch.mjs` (drift guard enforces parity). ADR-123's structural-unavailability guard retained for pinned-unavailable models. Primary `gpt-5.5` unchanged; `ASK_CODEX_FALLBACK_MODEL` still overrides. Current/user-facing docs swept to the new slug.
- **Verification:** Live two-model probe; `ask-codex-mcp` 90 tests + `@ask-llm/plugin` 415 tests green (drift guard + structural-unavailability test).
- **Status:** Fixed on `fix/codex-fallback-gpt-5.4-mini` — pending publish (changeset `codex-fallback-gpt-5.4-mini`).

### ~~#115 — superseded entry (PR #126 / ADR-106) — reverted by ADR-107~~ HISTORICAL
The entry below documents the (failed) first attempt at fixing #115 via PR #126. PR #126's verification step tested `yarn pack`, but the actual publish path uses `npm publish` (via changesets/action), which doesn't perform the same `workspace:*` rewrite. The result was four broken npm tarballs on 2026-05-27. ADR-107 restored the bundling architecture; the canonical #115 entry is now under `## Open` above.

### ~~#115 first-attempt — `npx ask-llm-mcp doctor` ERR_MODULE_NOT_FOUND on `zod/index.js` (Node 26, global install)~~ ROLLED BACK in ADR-107
- **Severity:** Critical (blocked any Node 26 user of `ask-llm-mcp` via global install)
- **Upstream issue:** [#115](https://github.com/Lykhoyda/ask-llm/issues/115)
- **Reporter:** twardoch (external)
- **Affected versions:** `ask-llm-mcp@0.3.8` and earlier on Node v26.0.0 (any platform; reproduced on macOS arm64)
- **Symptom:**
  ```
  Error: Cannot find package '/.../node_modules/zod/index.js'
    imported from /.../node_modules/@ask-llm/shared/dist/askResponse.js
  Did you mean to import "zod/index.cjs"?
      at legacyMainResolve (node:internal/modules/esm/resolve:201:26)
      ...
    code: 'ERR_MODULE_NOT_FOUND'
  Node.js v26.0.0
  ```
- **Actual root cause** (after reproducing exactly on Node 26.0.0 + npm 11.12.1): npm 11's **global install** + `bundledDependencies` interaction. The bundled workspace packages (`@ask-llm/shared`, `ask-gemini-mcp`, `ask-codex-mcp`, `ask-ollama-mcp`) are extracted correctly from the tarball, but their declared transitive deps that *aren't* bundled get empty placeholder directories instead of real installs. In the reproduced install, **78 packages were empty stubs** including `zod`, `@modelcontextprotocol/sdk`, `express`, `hono`, `jose`, `cors`, `ajv`, `cookie`, `cross-spawn`, `which`, `ms`, etc. Node's ESM resolver finds the empty `zod/` directory, can't find an `exports` field (no `package.json` at all), falls into `legacyMainResolve`, tries `index.js`, fails. The initial guess that this was a zod packaging bug or a Node 26 resolver-strictness change was wrong — the same exact tarball installs perfectly via `npm install ask-llm-mcp` to a project directory on the same Node 26 binary. The bug is **specifically in npm 11's global install path** when `bundledDependencies` is present.
- **Fix (ADR-106):** Publish `@ask-llm/shared` as a public npm package and remove the entire `bundledDependencies` mechanism from all four MCP packages. Since shared was the only `private: true` workspace package and the sole reason `bundledDependencies` existed (ADR-052), making it public eliminates the bundling code path entirely. Concrete changes: (1) `@ask-llm/shared` gets `"publishConfig": { "access": "public" }` + publishable metadata; (2) all four MCP packages drop `bundledDependencies` + the `prepack`/`postpack` scripts; (3) `scripts/prepack-bundle.mjs` + `scripts/postpack-restore.mjs` deleted — yarn 4 handles `workspace:* → fixed-version` rewriting automatically (more precisely than our custom script, which used `*`). Tarballs shrink dramatically (orchestrator 202 → 31 files). Once published, `npm install -g ask-llm-mcp@<next>` and `npx -y ask-llm-mcp` both fetch shared from npm as a normal dep — no bundling, no npm 11 bug exposure.
- **Pre-merge verification:** (1) Reproduced exactly on Node 26.0.0 + npm 11.12.1. (2) Inspected broken layout, counted empty dirs. (3) Confirmed local install works on same Node 26 (isolating the bug to global install). (4) Manually populated missing deps in broken install, verified doctor works. (5) Tested architectural fix via `yarn pack`, confirmed correct tarball shape (no `node_modules/`, workspace deps rewritten to exact versions). (6) Full test suite green post-fix. (7) Confirmed `@ask-llm/shared` returns 404 from npm — no prior publish, so `0.3.2` will be the first ever public release.
- **Status (final):** Rolled back in ADR-107 (`fix/republish-workspace-protocol-regression`) after the publish to npm produced 4 broken tarballs (`ask-gemini-mcp@1.6.6`, `ask-codex-mcp@0.3.8`, `ask-ollama-mcp@0.3.3`, `ask-llm-mcp@0.3.9` — all with literal `workspace:*` in their published manifests; `@ask-llm/shared@0.3.2` never published because the `@ask-llm` npm scope didn't exist on the maintainer's account). #115 remains open as Tier-B work — see the canonical entry under `## Open` above. Incident issue: #128.

## Known Bugs (inherited from upstream)

### ~~Gemini CLI v0.39.1 workspace-trust gate breaks fresh installs~~ FIXED
- **Severity:** Critical (issue #26)
- **Affected versions:** Gemini CLI v0.39.1+
- **Description:** gemini-cli v0.39.1 ([upstream PR #25814](https://github.com/google-gemini/gemini-cli/pull/25814)) added a `FatalUntrustedWorkspaceError` gate that fires before any model call when `gemini -p` is invoked against a directory that was never marked trusted in interactive mode. Fresh installs of `ask-gemini-mcp` against a never-opened directory failed with a raw stderr dump bubbled through `createGeminiStderrHandler` (which only special-cased `RESOURCE_EXHAUSTED`). The catch block at `geminiExecutor.ts:491` would also have triggered a Flash retry against the *same* untrusted directory — guaranteed to fail identically.
- **Fix:** `geminiExecutor.executeGeminiCLI()` now sets `process.env.GEMINI_TRUST_WORKSPACE = "true"` by default before spawn (forward-compatible env var; older Geminis silently ignore it). Opt-out via `ASK_GEMINI_REQUIRE_WORKSPACE_TRUST=1`. Catch block detects `FatalUntrustedWorkspaceError` / `not running in a trusted directory` patterns and short-circuits with a friendly remediation message (no Flash retry). See ADR-069.

### ~~Deprecated `-p` flag causes error~~ FIXED
- **Severity:** Critical
- **Upstream:** Issue #48, PRs #56, #43
- **Description:** Gemini CLI v0.23+ deprecated the `-p`/`--prompt` flag. Using it now produces "Cannot use both positional prompt and --prompt flag" error.
- **Fix:** Replaced `-p` flag with `--` separator + positional argument in `geminiExecutor.ts`

### ~~Windows ENOENT spawn errors~~ FIXED
- **Severity:** High
- **Upstream:** Issues #28, #30, #40; PRs #23, #27, #41, #43
- **Description:** `child_process.spawn()` fails on Windows because `gemini` resolves to `gemini.cmd`. Needs `shell: true` option and proper argument escaping.
- **Fix:** Added `shell: process.platform === "win32"` in `commandExecutor.ts`

### ~~Exit code 42: "No input provided via stdin"~~ FIXED
- **Severity:** Critical
- **Affected versions:** Gemini CLI v0.29.5+
- **Description:** After ADR-006 switched from `-p` flag to `--` separator for prompt passing, Gemini CLI v0.29.5 changed behavior so that positional arguments (via `--`) launch interactive mode expecting stdin. Since the MCP server spawns Gemini with `stdio: ["ignore", ...]`, stdin is closed and Gemini exits with code 42.
- **Fix:** Reverted to `-p` flag (`CLI.FLAGS.PROMPT = "-p"`) which triggers non-interactive headless mode. The v0.23 deprecation of `-p` was reversed in v0.29. See ADR-015.

### ~~Codex stdin pipe error in brainstorm-coordinator~~ FIXED
- **Severity:** High
- **Issue:** #19
- **Description:** Codex CLI fails with "stdin pipe error" when called from the brainstorm-coordinator agent. Works fine when called directly. Root cause: `commandExecutor.ts` used `stdio: ["ignore", ...]` which sets stdin to `/dev/null`. Codex CLI probes stdin during initialization — when spawned in agent sub-process context, `/dev/null` causes a broken pipe error.
- **Fix:** Changed stdin from `"ignore"` to `"pipe"` with immediate `.end()` in `commandExecutor.ts`. This gives the child process a proper EOF-terminated pipe instead of `/dev/null`. Added no-op error handler to prevent unhandled EPIPE if the child exits before stdin close completes.

### ~~Excessive token responses~~ WON'T FIX
- **Severity:** Medium
- **Upstream:** Issues #6, #26
- **Description:** MCP tool responses can exceed 45k tokens even for small prompts, consuming excessive context window.
- **Root cause:** Model-specific bug in `gemini-2.5-pro` — always returned ~45,735 tokens regardless of prompt size. Does not affect `gemini-3.1-pro-preview` (current default) or Flash models.
- **Mitigation:** Default model changed to `gemini-3.1-pro-preview`. Gemini CLI has no `--max-output-tokens` flag, so server-side truncation would be the only option — deemed unnecessary since the affected model is no longer the default.

### Missing changelog for v1.1.4
- **Severity:** Low
- **Upstream:** Issue #39
- **Description:** Published version has no release notes or changelog entry.

## Bugs Found via Code Review Experiment (ADR-024)

### ~~extractJson greedy first-match~~ FIXED
- **Severity:** Medium
- **Description:** `extractJson` returned the first valid JSON object found in Gemini CLI output, even if it was debug output (e.g., `{"retry":true}`) rather than the actual Gemini response. This could cause silent data loss when CLI debug lines contain JSON objects before the real response.
- **Fix:** After `JSON.parse` succeeds, check if parsed object has `response` or `error` field (Gemini-shaped). If not, save as fallback and continue searching. Return fallback only if no Gemini-shaped JSON found.

### ~~extractJson escape outside strings~~ FIXED
- **Severity:** Low
- **Description:** The `extractJson` parser tracked escape sequences (`\`) globally, not just inside JSON strings. A backslash in prefix text (e.g., Windows paths like `C:\new\file`) would set `escapeNext = true`, causing the next character to be skipped and corrupting brace/quote tracking.
- **Fix:** Changed escape detection from `if (char === "\\")` to `if (inString && char === "\\")`.

### ~~Thinking tokens not displayed in stats footer~~ FIXED
- **Severity:** Low
- **Description:** The `GeminiModelTokens` interface included a `thoughts` field and the Gemini CLI returns thinking token counts, but `formatStats` never displayed them. Users had no visibility into how many thinking tokens Gemini used.
- **Fix:** Added `if (tokens.thoughts != null && tokens.thoughts > 0) parts.push(...)` to `formatStats`, displayed between output tokens and cached count.

### ~~Gemini quota fallback fails with newer CLI versions~~ FIXED
- **Severity:** High
- **Issue:** #21
- **Description:** Gemini CLI changed its quota error format. Newer versions return `TerminalQuotaError: You have exhausted your capacity on this model` instead of `RESOURCE_EXHAUSTED`. The executor's fallback detection only matched the old format, so Pro → Flash fallback silently broke.
- **Fix:** Added `QUOTA_PATTERNS` array with three patterns (`RESOURCE_EXHAUSTED`, `TerminalQuotaError`, `exhausted your capacity`). Executor uses case-insensitive multi-pattern matching. See ADR-044.

### ~~Claude Desktop 4-minute timeout for Codex provider~~ FIXED
- **Severity:** High
- **Issue:** #20
- **Description:** Claude Desktop has a hard 4-minute client-side timeout. The server's default timeout was 5 minutes, so the client gave up before the server could return a meaningful error. Additionally, Codex CLI hung waiting for interactive approval prompts that can never arrive in MCP subprocess contexts.
- **Fix:** (1) Lowered default timeout to 210s (3.5 min, below Claude Desktop's 4-min limit). Timeout handler now immediately rejects with actionable error message. See ADR-045. (2) Added `--full-auto` flag to Codex CLI args so it never waits for approval. See ADR-046.

### ~~Node.js v18 incompatibility with gemini-cli~~ MITIGATED
- **Severity:** Medium
- **Issue:** Part of ANT-242
- **Description:** Claude Desktop may resolve a different Node.js binary (e.g., v18) than the user's shell. gemini-cli 0.36.0 uses ES2024 regex `v` flag which crashes on Node <20 with a cryptic `SyntaxError`.
- **Fix:** Added `Logger.checkNodeVersion()` at startup in all 4 servers. Logs error-level warning if Node <20 detected. See ADR-046.

## Shared Layer — Known Technical Debt

### ~~commandExecutor.ts contains Gemini-specific quota detection~~ FIXED
- **Severity:** Low
- **File:** `packages/shared/src/commandExecutor.ts`
- **Description:** The shared `executeCommand` function had Gemini-specific `RESOURCE_EXHAUSTED` detection hardcoded in the stderr handler.
- **Fix:** Added optional `onStderr` callback parameter to `executeCommand`. Moved Gemini quota detection into `geminiExecutor.ts` as the callback. The shared layer is now provider-agnostic.

## Bugs Found via Multi-Provider Review (/multi-review — Gemini + Codex)

### ~~ProgressHandle.stop() race condition~~ FIXED
- **Severity:** Critical (Gemini: 95, Codex: 90 — consensus)
- **Files:** `packages/{gemini,codex,ollama}-mcp/src/index.ts`, `packages/llm-mcp/src/index.ts`
- **Description:** `stop()` called `sendProgressNotification()` without awaiting the returned Promise. The MCP tool result was dispatched before the "100% completed" progress notification was sent, causing clients to show stale progress state.
- **Fix:** Made `stop()` async, updated `ProgressHandle` interface to `Promise<void>`, added `await handle.stop()` in all tool handlers. Then extracted into `@ask-llm/shared/progressTracker.ts`.

### ~~Hook temp file leak on signal interruption~~ FIXED
- **Severity:** Critical (Gemini: 90, Codex: 90 — consensus)
- **File:** `packages/claude-plugin/hooks/hooks.json`
- **Description:** Both hooks (Stop, PreToolUse) created temp files with `mktemp` but relied on a trailing `rm -f` for cleanup. If the `gemini` CLI was killed, interrupted, or the hook runner terminated early, the `rm` was never reached and temp files with diff content leaked in `/tmp/`.
- **Fix:** Added `trap 'rm -f "$tmp"' EXIT HUP INT TERM` immediately after `mktemp`.

### ~~Concurrent tool calls corrupt shared progress state~~ FIXED
- **Severity:** Critical
- **Files:** `packages/{gemini,codex,ollama}-mcp/src/index.ts`
- **Description:** Module-level mutable state (`isProcessing`, `currentOperationName`, `latestOutput`) was shared across all tool invocations. Two simultaneous MCP tool calls would interleave writes, corrupting progress messages.
- **Fix:** Replaced with `ProgressHandle` closure pattern — each tool invocation gets its own closure-scoped state. Then extracted to `@ask-llm/shared`.

## Claude Code Plugin — Known Limitations (from Gemini & Codex review)

### ~~npx -y ask-llm-mcp fails under npm 9 with EUNSUPPORTEDPROTOCOL workspace:*~~ RESOLVED (ADR-052)
- **Severity:** Critical
- **Files:** `packages/{gemini,codex,ollama,llm}-mcp/package.json`
- **Description:** Claude Desktop ships with Node 18 / npm 9.7.1. `npx -y ask-llm-mcp` (the recommended install command in `claude_desktop_config.json`) fails immediately with `npm ERR! code EUNSUPPORTEDPROTOCOL — Unsupported URL Type "workspace:": workspace:*` and the server never boots. Root cause: the published MCP packages had `"@ask-llm/shared": "workspace:*"` literally in their `dependencies` field. The `npm exec`/`npx` path fetches the registry manifest and parses its deps BEFORE downloading the tarball, so `bundledDependencies` doesn't help. Empirically reproduced on Node 18.15.0 / npm 9.7.1. Works fine on npm 10/11 (hence "works for me" pattern).
- **Resolution:** Added `scripts/prepack-bundle.mjs` + `scripts/postpack-restore.mjs` that rewrite `workspace:*` → `*` in the published tarball's package.json (both top-level and bundled nested ones) at pack time. Initially shipped in 1.5.6 / 0.2.6 with a `postpack` restore hook — this produced broken manifests because npm reads package.json for the registry manifest AFTER postpack restores (verified empirically: the 1.5.6 tarballs have `"*"` but the 1.5.6 registry manifests have `"workspace:*"`). Fixed by moving the restore from `postpack` to `postpublish` (runs after manifest upload). Published 1.5.7 / 0.2.7 with the correct lifecycle. **Users on 1.5.6 / 0.2.6 are still broken — they must update to 1.5.7 / 0.2.7 or later.** See ADR-052 for the full "postpack vs postpublish" analysis.

### ~~Untracked files not included in Stop hook review~~ RESOLVED (removed)
- **Severity:** Medium
- **File:** `packages/claude-plugin/hooks/hooks.json`
- **Description:** `git diff HEAD` excluded untracked files, so sessions that only created new files received no review.
- **Resolution:** Stop hook removed entirely in ADR-048 — the bug was structural (wrong trigger semantic), not a simple fix. `/gemini-review` slash command remains available for on-demand review.

### ~~Stop hook blocks until Gemini returns~~ RESOLVED (removed)
- **Severity:** Medium
- **File:** `packages/claude-plugin/hooks/hooks.json`
- **Description:** The Stop hook ran synchronously, delaying completion on every Claude turn (not just session end — `Stop` fires per-turn) until Gemini responded, adding up to 60s of latency.
- **Resolution:** Stop hook removed entirely in ADR-048. See the ADR for full rationale.

### Subagent inherits all tools (over-privileged)
- **Severity:** Low
- **File:** `packages/claude-plugin/agents/gemini-reviewer.md`
- **Description:** The gemini-reviewer subagent doesn't restrict its tool access. For a review-only agent, it has unnecessary write/edit capabilities. Low risk since the subagent runs in Claude's sandbox, but could be tightened by adding a `tools` allowlist if Claude Code supports it.

### Hook command is POSIX-only
- **Severity:** Low
- **File:** `packages/claude-plugin/hooks/hooks.json`
- **Description:** The shell command uses POSIX syntax (`if ! ...; then`, `2>/dev/null`, `${...}`). Won't work on Windows cmd.exe. Mirrors the broader platform gap — Claude Code hooks on Windows is an upstream concern.

### Subagent doesn't handle large diffs gracefully
- **Severity:** Low
- **File:** `packages/claude-plugin/agents/gemini-reviewer.md`
- **Description:** The review prompt template instructs the subagent to paste raw diffs into the Gemini prompt. For very large diffs, this could exceed Gemini's context window. Could be improved by instructing the subagent to use `fetch-chunk` or truncate.

## ~~Code Quality Issues (from utils/ audit)~~ ALL FIXED

All 10 code quality issues identified in the utils/ audit have been resolved:

- ~~No child process timeout~~ → Added 5min default timeout with SIGTERM→SIGKILL, configurable via `GMCPT_TIMEOUT_MS`
- ~~O(n^2) string concatenation~~ → Replaced with `Buffer[]` + `Buffer.concat()`
- ~~Broken @ symbol quoting~~ → Removed unnecessary quoting logic (`shell: false` means no shell expansion)
- ~~Raw Gemini output in error response~~ → Truncated to 2000 chars via `EXECUTION.ERROR_TRUNCATE_LENGTH`
- ~~Logger inconsistencies~~ → Removed `log()`, added level filtering, fixed `formatMessage`, `toolInvocation`, `toolParsedArgs`
- ~~Console.warn in changeModeParser~~ → Replaced with `Logger.warn`
- ~~Dead exported functions~~ → Deleted `summarizeChunking`, `getCacheStats`, `clearCache`
- ~~sendStatusMessage no-op~~ → Deleted, replaced call sites with `Logger.debug()`
- ~~processChangeModeOutput unnecessarily async~~ → Removed `async` keyword
