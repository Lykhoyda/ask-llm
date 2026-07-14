# @ask-llm/gemini-mcp

## 1.6.15

### Patch Changes

- [#230](https://github.com/Lykhoyda/ask-llm/pull/230) [`394c305`](https://github.com/Lykhoyda/ask-llm/commit/394c305806607ca5db4803c666a0ebdc3304c2db) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Move every public MCP package into the canonical `@ask-llm` npm organization,
  while preserving the existing executable names for compatibility.

## 1.6.14

### Patch Changes

- [#222](https://github.com/Lykhoyda/ask-llm/pull/222) [`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a first-class Claude Code CLI provider so Codex and other MCP clients can
  ask Claude for a read-only second opinion. The new `@anton-lykhoyda/ask-claude-mcp` package
  supports native sessions, Opus-to-Sonnet fallback, usage reporting, relative
  context directories, and a hard Read/Glob/Grep-only tool boundary. The unified
  orchestrator now auto-detects Claude and can include it in `ask-llm`,
  `multi-llm`, diagnostics, and the REPL.

## 1.6.13

### Patch Changes

- [#199](https://github.com/Lykhoyda/ask-llm/pull/199) [`553b93b`](https://github.com/Lykhoyda/ask-llm/commit/553b93b9587df53b3b0b583b323955663b27ed64) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - 2026-07-02 audit hardening batch (ADR-128):

  - **shared**: new canonical `PROVIDERS` tuple + `ProviderName` type (single source of truth for the provider list); new `relativeDirSchema` for includeDirs-style params; `ASK_OLLAMA_TIMEOUT_MS` / `DEFAULT_OLLAMA_TIMEOUT_MS` in `EXECUTION`; chunkCache now creates its dir 0700 and chunk files 0600 (and tightens dirs from older releases); `registerTools()` fails fast on duplicate tool names; stderr accumulation switched to `Buffer[]` (parity with stdout).
  - **ollama**: the `/api/chat` call finally has a timeout — `AbortController` bounded by `ASK_OLLAMA_TIMEOUT_MS` > `GMCPT_TIMEOUT_MS` > 600s default, with an actionable timeout error; previously a wedged Ollama server hung `ask-ollama` forever.
  - **codex**: JSONL output that parses into events but contains no agent message now throws an actionable error (naming the thread id, with truncated raw output) instead of returning the raw JSONL dump as the "response"; plain-text output still passes through. `includeDirs` on `ask-codex`/`ask-codex-edit` now validates paths (relative only, no `..`/`~`) — parity with `ask-gemini-edit`.
  - **gemini**: empty-string `sessionId` now bypasses the response cache (parity with codex/ollama, ADR-063 semantics) — previously a cached body with `sessionId: undefined` was returned instead of performing the session turn; includeDirs cache-key construction no longer mutates the caller's array.
  - **llm-mcp**: `multi-llm` outputSchema and the no-providers-detected fallback enum now include `antigravity` (previously the declared contract rejected antigravity usage stats); REPL `/provider` help derives from the provider registry.
  - **plugin**: plugin.json + marketplace.json description/keywords now name Antigravity; manifest tests assert all four runner binaries.

## 1.6.12

### Patch Changes

- [#185](https://github.com/Lykhoyda/ask-llm/pull/185) [`206943d`](https://github.com/Lykhoyda/ask-llm/commit/206943deb83975e7b06f461771087210617d7287) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - `ask-llm doctor` now folds a compact `codex doctor` health summary into the Codex provider section ([#183](https://github.com/Lykhoyda/ask-llm/issues/183)). When codex is available, the doctor capability-probes `codex doctor --json` and, on success, shows codex's overall status plus any non-ok checks with remediation (the full mapped check list rides along in `--json`). It degrades silently when codex is absent, too old to support `--json`, or emits no usable report — but a non-zero exit that still carries a valid JSON report on stdout is salvaged and surfaced (codex emits the report even when exiting non-zero on error-level health). Default output is unchanged, and codex health never affects the doctor exit code. Implemented via a generic `enrich` hook on the provider spec so `@ask-llm/shared` stays provider-agnostic; codex-specific parsing lives in `ask-codex-mcp`. (gemini/ollama/antigravity bump = rebuild only: they embed the updated shared `doctor.ts`, ADR-119.)

## 1.6.11

### Patch Changes

- [#177](https://github.com/Lykhoyda/ask-llm/pull/177) [`fc40dcb`](https://github.com/Lykhoyda/ask-llm/commit/fc40dcbca3256d1558c2910bb30df64f373876ab) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Fix [#115](https://github.com/Lykhoyda/ask-llm/issues/115): `npm install -g` / `npx -y` on Node 26 crashed with `ERR_MODULE_NOT_FOUND` (npm 11 leaves empty placeholder dirs for bundled packages' transitive deps). `@ask-llm/shared` is now inlined into each package's `dist/` at build time (tsdown); `bundledDependencies` and the prepack/postpack manifest rewriting are gone entirely, so published manifests contain plain semver only.

## 1.6.10

### Patch Changes

- Updated dependencies [[`2f12b43`](https://github.com/Lykhoyda/ask-llm/commit/2f12b43c5b8111e3f726ee52fc237ca31df0b4b0)]:
  - @ask-llm/shared@0.3.4

## 1.6.9

### Patch Changes

- [#165](https://github.com/Lykhoyda/ask-llm/pull/165) [`fe3ee41`](https://github.com/Lykhoyda/ask-llm/commit/fe3ee41b65908125a88f711b0a2fd560cb286e30) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - [#140](https://github.com/Lykhoyda/ask-llm/issues/140) follow-up: the post-cutoff Gemini tier-discontinuation error now points users to the published `ask-antigravity-mcp` package (subscription-backed via Google AI Pro/Ultra) instead of only "run `agy` directly". The static docs (README + provider page) also move to boundary-robust effective-date phrasing that reads correctly on both sides of the 2026-06-18 cutoff.

## 1.6.8

### Patch Changes

- [#147](https://github.com/Lykhoyda/ask-llm/pull/147) [`d88606f`](https://github.com/Lykhoyda/ask-llm/commit/d88606f9ec7c1dcc48308d4cadfd8731c9ade8d8) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Surface actionable, date-gated guidance when Gemini CLI's backend stops serving free/Pro/Ultra accounts (2026-06-18 cutoff, [#140](https://github.com/Lykhoyda/ask-llm/issues/140)). On or after the cutoff, an auth/quota-class failure is classified and a hedged tier-discontinuation notice is prepended to the error (cutoff date, switch to ask-codex/ask-ollama, Antigravity `agy` is a separate path not yet supported). The Flash-fallback control flow is unchanged; the cutoff is overridable via `ASK_GEMINI_TIER_CUTOFF`.

## 1.6.6

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

## 1.6.5

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
