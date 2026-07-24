# @ask-llm/antigravity-mcp

## 0.6.0

### Minor Changes

- [#246](https://github.com/Lykhoyda/ask-llm/pull/246) [`a1f62ad`](https://github.com/Lykhoyda/ask-llm/commit/a1f62ad1625c4248876c40842801fe0c4403c561) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Require agy 1.1.5 or newer with actionable support diagnostics, adopt its model contract by defaulting to the stable base slug `gemini-3.1-pro` (fallback `gemini-3.5-flash`) with the reasoning tier passed separately via `--effort` (new `ASK_ANTIGRAVITY_EFFORT` env var, default `high`), and recover gracefully when agy rejects a model: a rejected model whose value equals the shipped default or fallback slug retries once model-less while any other rejected model fails with an actionable error naming `agy models` ([#243](https://github.com/Lykhoyda/ask-llm/issues/243)).

## 0.5.1

### Patch Changes

- [#237](https://github.com/Lykhoyda/ask-llm/pull/237) [`ba569cc`](https://github.com/Lykhoyda/ask-llm/commit/ba569cc1f8346ef2db76e6733fa9d9f222f61242) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Keep managed review paths read-only, isolate concurrent compare runs, fix
  special-character Stop-gate paths, and include the MIT license in every
  published package tarball.

## 0.5.0

### Minor Changes

- [#227](https://github.com/Lykhoyda/ask-llm/pull/227) [`a3c3ba3`](https://github.com/Lykhoyda/ask-llm/commit/a3c3ba38fc1643059f4d5a75208b99e580ae9d4b) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a safe typed machine protocol for subscription-backed factory planning, review, and verification.

## 0.4.2

### Patch Changes

- [#230](https://github.com/Lykhoyda/ask-llm/pull/230) [`394c305`](https://github.com/Lykhoyda/ask-llm/commit/394c305806607ca5db4803c666a0ebdc3304c2db) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Move every public MCP package into the canonical `@ask-llm` npm organization,
  while preserving the existing executable names for compatibility.

## 0.4.1

### Patch Changes

- [#222](https://github.com/Lykhoyda/ask-llm/pull/222) [`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a first-class Claude Code CLI provider so Codex and other MCP clients can
  ask Claude for a read-only second opinion. The new `@anton-lykhoyda/ask-claude-mcp` package
  supports native sessions, Opus-to-Sonnet fallback, usage reporting, relative
  context directories, and a hard Read/Glob/Grep-only tool boundary. The unified
  orchestrator now auto-detects Claude and can include it in `ask-llm`,
  `multi-llm`, diagnostics, and the REPL.

## 0.4.0

### Minor Changes

- [#202](https://github.com/Lykhoyda/ask-llm/pull/202) [`5d53a1e`](https://github.com/Lykhoyda/ask-llm/commit/5d53a1e637adcb2e72667e8bc32f5f2c6aa2150c) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - `ask-antigravity`'s `includeDirs` now validates paths via the shared `relativeDirSchema` (relative only — no `..`, absolute, or `~` paths), matching `ask-codex`/`ask-codex-edit`/`ask-gemini-edit`. Previously arbitrary paths were forwarded to `agy --add-dir` unvalidated, which is especially risky because agy runs with `--dangerously-skip-permissions`. Found by a Codex review of the new provider-parity matrix.

### Patch Changes

- [#199](https://github.com/Lykhoyda/ask-llm/pull/199) [`553b93b`](https://github.com/Lykhoyda/ask-llm/commit/553b93b9587df53b3b0b583b323955663b27ed64) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - 2026-07-02 audit hardening batch (ADR-128):

  - **shared**: new canonical `PROVIDERS` tuple + `ProviderName` type (single source of truth for the provider list); new `relativeDirSchema` for includeDirs-style params; `ASK_OLLAMA_TIMEOUT_MS` / `DEFAULT_OLLAMA_TIMEOUT_MS` in `EXECUTION`; chunkCache now creates its dir 0700 and chunk files 0600 (and tightens dirs from older releases); `registerTools()` fails fast on duplicate tool names; stderr accumulation switched to `Buffer[]` (parity with stdout).
  - **ollama**: the `/api/chat` call finally has a timeout — `AbortController` bounded by `ASK_OLLAMA_TIMEOUT_MS` > `GMCPT_TIMEOUT_MS` > 600s default, with an actionable timeout error; previously a wedged Ollama server hung `ask-ollama` forever.
  - **codex**: JSONL output that parses into events but contains no agent message now throws an actionable error (naming the thread id, with truncated raw output) instead of returning the raw JSONL dump as the "response"; plain-text output still passes through. `includeDirs` on `ask-codex`/`ask-codex-edit` now validates paths (relative only, no `..`/`~`) — parity with `ask-gemini-edit`.
  - **gemini**: empty-string `sessionId` now bypasses the response cache (parity with codex/ollama, ADR-063 semantics) — previously a cached body with `sessionId: undefined` was returned instead of performing the session turn; includeDirs cache-key construction no longer mutates the caller's array.
  - **llm-mcp**: `multi-llm` outputSchema and the no-providers-detected fallback enum now include `antigravity` (previously the declared contract rejected antigravity usage stats); REPL `/provider` help derives from the provider registry.
  - **plugin**: plugin.json + marketplace.json description/keywords now name Antigravity; manifest tests assert all four runner binaries.

## 0.3.0

### Minor Changes

- [#192](https://github.com/Lykhoyda/ask-llm/pull/192) [`8ff1d02`](https://github.com/Lykhoyda/ask-llm/commit/8ff1d02b08a8f9f47752d27f1feb64dff9b35d05) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Default `ask-antigravity` to **Gemini 3.1 Pro (High)** — the strongest reasoning tier — and add a **Gemini 3.5 Flash (High)** rate-limit fallback.

  Previously `ask-antigravity` defaulted to Gemini 3.5 Flash (High) with no fallback. It now leads with the Pro reasoning tier for the code-review / second-opinion workload and retries once on Flash when Pro hits a subscription rate limit (`RESOURCE_EXHAUSTED` / `429` / quota), mirroring the cross-tier quota fallback that `ask-gemini` and `ask-codex` already use. If the resolved model is already the fallback (or the caller pinned it via `ASK_ANTIGRAVITY_MODEL`), there is nothing to fall back to and the actionable rate-limit message is returned. Non-rate-limit failures (auth, not-installed, timeout) are surfaced as-is and never trigger a fallback. Override the default with the `ASK_ANTIGRAVITY_MODEL` env var (run `agy models` for options).

## 0.2.3

### Patch Changes

- [#185](https://github.com/Lykhoyda/ask-llm/pull/185) [`206943d`](https://github.com/Lykhoyda/ask-llm/commit/206943deb83975e7b06f461771087210617d7287) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - `ask-llm doctor` now folds a compact `codex doctor` health summary into the Codex provider section ([#183](https://github.com/Lykhoyda/ask-llm/issues/183)). When codex is available, the doctor capability-probes `codex doctor --json` and, on success, shows codex's overall status plus any non-ok checks with remediation (the full mapped check list rides along in `--json`). It degrades silently when codex is absent, too old to support `--json`, or emits no usable report — but a non-zero exit that still carries a valid JSON report on stdout is salvaged and surfaced (codex emits the report even when exiting non-zero on error-level health). Default output is unchanged, and codex health never affects the doctor exit code. Implemented via a generic `enrich` hook on the provider spec so `@ask-llm/shared` stays provider-agnostic; codex-specific parsing lives in `ask-codex-mcp`. (gemini/ollama/antigravity bump = rebuild only: they embed the updated shared `doctor.ts`, ADR-119.)

## 0.2.2

### Patch Changes

- [#177](https://github.com/Lykhoyda/ask-llm/pull/177) [`fc40dcb`](https://github.com/Lykhoyda/ask-llm/commit/fc40dcbca3256d1558c2910bb30df64f373876ab) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Fix [#115](https://github.com/Lykhoyda/ask-llm/issues/115): `npm install -g` / `npx -y` on Node 26 crashed with `ERR_MODULE_NOT_FOUND` (npm 11 leaves empty placeholder dirs for bundled packages' transitive deps). `@ask-llm/shared` is now inlined into each package's `dist/` at build time (tsdown); `bundledDependencies` and the prepack/postpack manifest rewriting are gone entirely, so published manifests contain plain semver only.

## 0.2.1

### Patch Changes

- Updated dependencies [[`2f12b43`](https://github.com/Lykhoyda/ask-llm/commit/2f12b43c5b8111e3f726ee52fc237ca31df0b4b0)]:
  - @ask-llm/shared@0.3.4

## 0.2.0

### Minor Changes

- [#167](https://github.com/Lykhoyda/ask-llm/pull/167) [`0e14e19`](https://github.com/Lykhoyda/ask-llm/commit/0e14e19fd55dad04c4cc31b55336a970de01ef0b) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add model selection to `ask-antigravity`, defaulting to **Gemini 3.5 Flash (High)**. Antigravity's `agy` supports model choice via the long `--model` flag (the short `-m` flag hangs under `-p`, which is why v1 shipped without it). Override with the `ASK_ANTIGRAVITY_MODEL` env var (run `agy models` for the list) or per-call via the executor's `model` option. The structured `AskResponse.model` now reports the actual model used instead of the `"antigravity"` placeholder.

## 0.1.0

### Minor Changes

- [#157](https://github.com/Lykhoyda/ask-llm/pull/157) [`51305da`](https://github.com/Lykhoyda/ask-llm/commit/51305da38d3d5a8e606d8cd9bc94c9634a23fdd2) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Publish the experimental `ask-antigravity-mcp` provider for Google's Antigravity CLI (`agy`). Validated end-to-end against a real `agy` 1.0.6 (which prints to stdout — gemini-cli [#27466](https://github.com/Lykhoyda/ask-llm/issues/27466) is fixed there; transcript-file reading is the fallback). `ask-llm-mcp` now bundles `ask-antigravity-mcp` so the unified orchestrator can load it when `agy` is installed.
