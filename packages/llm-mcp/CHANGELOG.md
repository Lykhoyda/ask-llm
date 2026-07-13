# ask-llm-mcp

## 0.5.0

### Minor Changes

- [#222](https://github.com/Lykhoyda/ask-llm/pull/222) [`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a first-class Claude Code CLI provider so Codex and other MCP clients can
  ask Claude for a read-only second opinion. The new `@anton-lykhoyda/ask-claude-mcp` package
  supports native sessions, Opus-to-Sonnet fallback, usage reporting, relative
  context directories, and a hard Read/Glob/Grep-only tool boundary. The unified
  orchestrator now auto-detects Claude and can include it in `ask-llm`,
  `multi-llm`, diagnostics, and the REPL.

### Patch Changes

- [#222](https://github.com/Lykhoyda/ask-llm/pull/222) [`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Update Codex defaults to the GPT-5.6 family: GPT-5.6 Sol is now the
  quality-first model for MCP calls, reviews, brainstorming, image orchestration,
  and codex-pair, with GPT-5.6 Terra as the balanced quota fallback. The legacy
  preferred-model escape hatch remains available, but no longer adds a redundant
  attempt when it resolves to the Sol default. `ask-codex` now accepts an optional
  `reasoningEffort`; general calls preserve `medium`, while `/codex-review` and
  `/brainstorm` use `high`.
- Updated dependencies [[`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54), [`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54)]:
  - @anton-lykhoyda/ask-claude-mcp@0.1.0
  - ask-gemini-mcp@1.6.14
  - ask-codex-mcp@0.6.1
  - ask-ollama-mcp@0.5.1
  - ask-antigravity-mcp@0.4.1

## 0.4.5

### Patch Changes

- Updated dependencies [[`1089a21`](https://github.com/Lykhoyda/ask-llm/commit/1089a215657594a1c569dcd6c180d94750b1dab6)]:
  - ask-codex-mcp@0.6.0

## 0.4.4

### Patch Changes

- [#199](https://github.com/Lykhoyda/ask-llm/pull/199) [`553b93b`](https://github.com/Lykhoyda/ask-llm/commit/553b93b9587df53b3b0b583b323955663b27ed64) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - 2026-07-02 audit hardening batch (ADR-128):

  - **shared**: new canonical `PROVIDERS` tuple + `ProviderName` type (single source of truth for the provider list); new `relativeDirSchema` for includeDirs-style params; `ASK_OLLAMA_TIMEOUT_MS` / `DEFAULT_OLLAMA_TIMEOUT_MS` in `EXECUTION`; chunkCache now creates its dir 0700 and chunk files 0600 (and tightens dirs from older releases); `registerTools()` fails fast on duplicate tool names; stderr accumulation switched to `Buffer[]` (parity with stdout).
  - **ollama**: the `/api/chat` call finally has a timeout — `AbortController` bounded by `ASK_OLLAMA_TIMEOUT_MS` > `GMCPT_TIMEOUT_MS` > 600s default, with an actionable timeout error; previously a wedged Ollama server hung `ask-ollama` forever.
  - **codex**: JSONL output that parses into events but contains no agent message now throws an actionable error (naming the thread id, with truncated raw output) instead of returning the raw JSONL dump as the "response"; plain-text output still passes through. `includeDirs` on `ask-codex`/`ask-codex-edit` now validates paths (relative only, no `..`/`~`) — parity with `ask-gemini-edit`.
  - **gemini**: empty-string `sessionId` now bypasses the response cache (parity with codex/ollama, ADR-063 semantics) — previously a cached body with `sessionId: undefined` was returned instead of performing the session turn; includeDirs cache-key construction no longer mutates the caller's array.
  - **llm-mcp**: `multi-llm` outputSchema and the no-providers-detected fallback enum now include `antigravity` (previously the declared contract rejected antigravity usage stats); REPL `/provider` help derives from the provider registry.
  - **plugin**: plugin.json + marketplace.json description/keywords now name Antigravity; manifest tests assert all four runner binaries.

- Updated dependencies [[`5d53a1e`](https://github.com/Lykhoyda/ask-llm/commit/5d53a1e637adcb2e72667e8bc32f5f2c6aa2150c), [`553b93b`](https://github.com/Lykhoyda/ask-llm/commit/553b93b9587df53b3b0b583b323955663b27ed64)]:
  - ask-antigravity-mcp@0.4.0
  - ask-ollama-mcp@0.5.0
  - ask-codex-mcp@0.5.0
  - ask-gemini-mcp@1.6.13

## 0.4.3

### Patch Changes

- Updated dependencies [[`f65e72f`](https://github.com/Lykhoyda/ask-llm/commit/f65e72f03b975a93d480091687729350b78788d6), [`4938dba`](https://github.com/Lykhoyda/ask-llm/commit/4938dbaeb422e3c5dcfd5ed2780ad030b819a832)]:
  - ask-codex-mcp@0.4.1

## 0.4.2

### Patch Changes

- [#192](https://github.com/Lykhoyda/ask-llm/pull/192) [`8ff1d02`](https://github.com/Lykhoyda/ask-llm/commit/8ff1d02b08a8f9f47752d27f1feb64dff9b35d05) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Default `ask-antigravity` to **Gemini 3.1 Pro (High)** — the strongest reasoning tier — and add a **Gemini 3.5 Flash (High)** rate-limit fallback.

  Previously `ask-antigravity` defaulted to Gemini 3.5 Flash (High) with no fallback. It now leads with the Pro reasoning tier for the code-review / second-opinion workload and retries once on Flash when Pro hits a subscription rate limit (`RESOURCE_EXHAUSTED` / `429` / quota), mirroring the cross-tier quota fallback that `ask-gemini` and `ask-codex` already use. If the resolved model is already the fallback (or the caller pinned it via `ASK_ANTIGRAVITY_MODEL`), there is nothing to fall back to and the actionable rate-limit message is returned. Non-rate-limit failures (auth, not-installed, timeout) are surfaced as-is and never trigger a fallback. Override the default with the `ASK_ANTIGRAVITY_MODEL` env var (run `agy models` for options).

- Updated dependencies [[`8ff1d02`](https://github.com/Lykhoyda/ask-llm/commit/8ff1d02b08a8f9f47752d27f1feb64dff9b35d05)]:
  - ask-antigravity-mcp@0.3.0

## 0.4.1

### Patch Changes

- [#189](https://github.com/Lykhoyda/ask-llm/pull/189) [`2436972`](https://github.com/Lykhoyda/ask-llm/commit/2436972aeba14bb9cb352e0ff4a6056c552498d3) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Include Antigravity in the `ask-llm` and `multi-llm` tool descriptions. The unified orchestrator has supported Antigravity as a fourth provider for a while (it's in the `PROVIDERS` registry and the `provider` enum), but the two top-level tool-description strings still enumerated only "Gemini, Codex, Ollama" — so MCP clients listing the tools saw a stale, incomplete provider list. Both descriptions now read "Codex, Antigravity, Ollama, Gemini" (the canonical order). The runtime `provider` enum was already dynamic and unaffected.

- [#191](https://github.com/Lykhoyda/ask-llm/pull/191) [`1feaaa2`](https://github.com/Lykhoyda/ask-llm/commit/1feaaa2ca51e79fb334af780aaf0ecaa83b5bd8f) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Bump the default Ollama model to `qwen3.6:27b` (was `qwen2.5-coder:7b`) and remove the automatic model fallback.

  Ollama runs locally, where you explicitly pull the model you want — so silently substituting a _different_ model on "model not found" was a footgun. The executor now surfaces a clear, actionable error (`Ollama model "<model>" is not available locally. Pull it first: ollama pull <model>`) instead of falling back to another model. The `ASK_OLLAMA_FALLBACK_MODEL` env var and the `FALLBACK` constant are removed; `ASK_OLLAMA_MODEL` still overrides the default, and `usage.fellBack` is now always `false` for Ollama.

  Note: qwen3.6's smallest Ollama variant is ~17 GB and needs a capable GPU / plenty of RAM — set `ASK_OLLAMA_MODEL` to a lighter tag (e.g. a `qwen2.5-coder` size) if your machine can't run it.

- Updated dependencies [[`1feaaa2`](https://github.com/Lykhoyda/ask-llm/commit/1feaaa2ca51e79fb334af780aaf0ecaa83b5bd8f)]:
  - ask-ollama-mcp@0.4.0

## 0.4.0

### Minor Changes

- [#185](https://github.com/Lykhoyda/ask-llm/pull/185) [`206943d`](https://github.com/Lykhoyda/ask-llm/commit/206943deb83975e7b06f461771087210617d7287) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - `ask-llm doctor` now folds a compact `codex doctor` health summary into the Codex provider section ([#183](https://github.com/Lykhoyda/ask-llm/issues/183)). When codex is available, the doctor capability-probes `codex doctor --json` and, on success, shows codex's overall status plus any non-ok checks with remediation (the full mapped check list rides along in `--json`). It degrades silently when codex is absent, too old to support `--json`, or emits no usable report — but a non-zero exit that still carries a valid JSON report on stdout is salvaged and surfaced (codex emits the report even when exiting non-zero on error-level health). Default output is unchanged, and codex health never affects the doctor exit code. Implemented via a generic `enrich` hook on the provider spec so `@ask-llm/shared` stays provider-agnostic; codex-specific parsing lives in `ask-codex-mcp`. (gemini/ollama/antigravity bump = rebuild only: they embed the updated shared `doctor.ts`, ADR-119.)

### Patch Changes

- Updated dependencies [[`206943d`](https://github.com/Lykhoyda/ask-llm/commit/206943deb83975e7b06f461771087210617d7287)]:
  - ask-codex-mcp@0.4.0
  - ask-gemini-mcp@1.6.12
  - ask-ollama-mcp@0.3.7
  - ask-antigravity-mcp@0.2.3

## 0.3.16

### Patch Changes

- [#177](https://github.com/Lykhoyda/ask-llm/pull/177) [`fc40dcb`](https://github.com/Lykhoyda/ask-llm/commit/fc40dcbca3256d1558c2910bb30df64f373876ab) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Fix [#115](https://github.com/Lykhoyda/ask-llm/issues/115): `npm install -g` / `npx -y` on Node 26 crashed with `ERR_MODULE_NOT_FOUND` (npm 11 leaves empty placeholder dirs for bundled packages' transitive deps). `@ask-llm/shared` is now inlined into each package's `dist/` at build time (tsdown); `bundledDependencies` and the prepack/postpack manifest rewriting are gone entirely, so published manifests contain plain semver only.

- Updated dependencies [[`fc40dcb`](https://github.com/Lykhoyda/ask-llm/commit/fc40dcbca3256d1558c2910bb30df64f373876ab)]:
  - ask-gemini-mcp@1.6.11
  - ask-codex-mcp@0.3.11
  - ask-ollama-mcp@0.3.6
  - ask-antigravity-mcp@0.2.2

## 0.3.15

### Patch Changes

- Updated dependencies [[`2f12b43`](https://github.com/Lykhoyda/ask-llm/commit/2f12b43c5b8111e3f726ee52fc237ca31df0b4b0)]:
  - @ask-llm/shared@0.3.4
  - ask-codex-mcp@0.3.10
  - ask-antigravity-mcp@0.2.1
  - ask-gemini-mcp@1.6.10
  - ask-ollama-mcp@0.3.5

## 0.3.14

### Patch Changes

- Updated dependencies [[`0e14e19`](https://github.com/Lykhoyda/ask-llm/commit/0e14e19fd55dad04c4cc31b55336a970de01ef0b)]:
  - ask-antigravity-mcp@0.2.0

## 0.3.13

### Patch Changes

- Updated dependencies [[`fe3ee41`](https://github.com/Lykhoyda/ask-llm/commit/fe3ee41b65908125a88f711b0a2fd560cb286e30)]:
  - ask-gemini-mcp@1.6.9

## 0.3.12

### Patch Changes

- [#157](https://github.com/Lykhoyda/ask-llm/pull/157) [`51305da`](https://github.com/Lykhoyda/ask-llm/commit/51305da38d3d5a8e606d8cd9bc94c9634a23fdd2) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Publish the experimental `ask-antigravity-mcp` provider for Google's Antigravity CLI (`agy`). Validated end-to-end against a real `agy` 1.0.6 (which prints to stdout — gemini-cli [#27466](https://github.com/Lykhoyda/ask-llm/issues/27466) is fixed there; transcript-file reading is the fallback). `ask-llm-mcp` now bundles `ask-antigravity-mcp` so the unified orchestrator can load it when `agy` is installed.

- Updated dependencies [[`51305da`](https://github.com/Lykhoyda/ask-llm/commit/51305da38d3d5a8e606d8cd9bc94c9634a23fdd2)]:
  - ask-antigravity-mcp@0.1.0

## 0.3.11

### Patch Changes

- Updated dependencies [[`d88606f`](https://github.com/Lykhoyda/ask-llm/commit/d88606f9ec7c1dcc48308d4cadfd8731c9ade8d8)]:
  - ask-gemini-mcp@1.6.8

## 0.3.9

### Patch Changes

- [#126](https://github.com/Lykhoyda/ask-llm/pull/126) [`53c0708`](https://github.com/Lykhoyda/ask-llm/commit/53c07080f7e62355d18a4d423bf76a65ab473dc7) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # Fix [#115](https://github.com/Lykhoyda/ask-llm/issues/115) — `npx ask-llm-mcp` ERR_MODULE_NOT_FOUND on Node 26 global install

  Publish `@ask-llm/shared` as a public npm package and remove the
  `bundledDependencies` mechanism from all four MCP packages
  (`ask-gemini-mcp`, `ask-codex-mcp`, `ask-ollama-mcp`, `ask-llm-mcp`).

  ## The bug

  External user (twardoch) on Node 26.0.0 reported that `npx ask-llm-mcp
doctor` and `npm install -g ask-llm-mcp` crash with:

  ```
  Error: Cannot find package '/.../node_modules/zod/index.js'
    imported from /.../node_modules/@ask-llm/shared/dist/askResponse.js
  Did you mean to import "zod/index.cjs"?
      at legacyMainResolve (node:internal/modules/esm/resolve:201:26)
  ```

  Reproduced exactly on Node 26.0.0 + npm 11.12.1. Root cause: npm 11
  global install has a bug where `bundledDependencies` packages are
  extracted correctly, but their declared transitive dependencies that
  _aren't_ bundled get empty placeholder directories (78 packages affected
  in our case — `zod`, `@modelcontextprotocol/sdk`, `express`, `hono`,
  `jose`, `cors`, `ajv`, etc.). Node's ESM resolver finds the empty
  directory, falls into `legacyMainResolve`, and fails. The same exact
  tarball works perfectly when installed locally (`npm install
ask-llm-mcp` to a project directory) — the bug is specifically in
  global install.

  ## The fix (ADR-106)

  Remove the bundling mechanism that triggered the npm bug. Since
  `@ask-llm/shared` was the only `private: true` workspace package and
  the sole reason `bundledDependencies` existed (ADR-052), making it a
  public npm package eliminates the entire bundling code path.

  Changes:

  - `@ask-llm/shared` — removed `"private": true`, added
    `"publishConfig": { "access": "public" }`, added publishable metadata
    (description, repo, homepage, license, files). First public version
    ships in this release.
  - All four MCP packages — removed `bundledDependencies` array and the
    `prepack`/`postpack` scripts that called the custom bundling logic.
  - `scripts/prepack-bundle.mjs` + `scripts/postpack-restore.mjs` —
    deleted. Yarn 4 automatically rewrites `workspace:*` to the actual
    workspace version at publish time (more precisely than our custom
    `workspace:* → *` rewrite did).

  ## Trade-offs

  - Tarballs shrink dramatically: `ask-llm-mcp` drops from 202 files
    (~80KB) to ~31 files (~17KB) because shared/gemini/codex/ollama
    bundles are no longer inlined.
  - One more public npm package to maintain (`@ask-llm/shared`). Already
    versioned by changesets via `privatePackages: { version: true }`, so
    the only mechanical change is that it now publishes too.
  - Install flow becomes byte-identical between local and global —
    removing the bug class that bit us here.

  ## What does NOT change

  - Public APIs of any package
  - The set of MCP tools exposed
  - The Claude Code plugin (`@ask-llm/plugin` is unaffected — it's
    distributed via marketplace, not npm)
  - Any user-facing behavior other than "global install actually works"

- Updated dependencies [[`53c0708`](https://github.com/Lykhoyda/ask-llm/commit/53c07080f7e62355d18a4d423bf76a65ab473dc7)]:
  - @ask-llm/shared@0.3.2
  - ask-gemini-mcp@1.6.6
  - ask-codex-mcp@0.3.8
  - ask-ollama-mcp@0.3.3

## 0.3.8

### Patch Changes

- [#111](https://github.com/Lykhoyda/ask-llm/pull/111) [`ab40290`](https://github.com/Lykhoyda/ask-llm/commit/ab40290fecdbabec75436579d06152f6218251d6) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - # v0.7.0 family sync — synchronized MCP-package patch bump

  The MCP server packages (`ask-gemini-mcp`, `ask-codex-mcp`, `ask-ollama-mcp`,
  `ask-llm-mcp`) are unchanged in code since the prior release (v1.6.4 / v0.3.x —
  `git diff v1.6.4..main -- packages/shared packages/gemini-mcp packages/codex-mcp
packages/ollama-mcp packages/llm-mcp` returns empty). They are patch-bumped here
  to keep the gemini-codex-ollama-llm family aligned on the same SHA-stamped release
  moment that ships the v0.7.0 plugin work (Tier 3 broker + ADR-092/094/095/096/097
  codex-pair improvements — all inside the private `@ask-llm/plugin` package).

  This preserves the unified-tag convention from the original gemini-mcp-tool fork
  (legacy v1.5.x..v1.6.x URLs still resolve at `v<gemini_version>`) and gives npm
  consumers a single discoverable release moment instead of a v0.7.0 plugin-only
  event with no npm-visible artifact.

  No functional changes in these packages. Tests, type contracts, executor
  behavior, MCP tool surface — all byte-identical to the prior release.

- Updated dependencies [[`ab40290`](https://github.com/Lykhoyda/ask-llm/commit/ab40290fecdbabec75436579d06152f6218251d6)]:
  - ask-gemini-mcp@1.6.5
  - ask-codex-mcp@0.3.7
  - ask-ollama-mcp@0.3.2
