# @ask-llm/codex-mcp

## 0.7.7

### Patch Changes

- [#305](https://github.com/Lykhoyda/ask-llm/pull/305) [`bfb24b2`](https://github.com/Lykhoyda/ask-llm/commit/bfb24b2327d910fc9e940de58b399ec7c54fda20) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Allow unified MCP clients to receive the full nested provider diagnostic enrichment without output-schema validation masking it as `-32602`. The diagnostic report schema now lives beside its canonical types and remains strict for genuinely invalid enrichment.

## 0.7.6

### Patch Changes

- [#300](https://github.com/Lykhoyda/ask-llm/pull/300) [`a24889e`](https://github.com/Lykhoyda/ask-llm/commit/a24889e958af2962a0fc0e31cdd7d5ab042a5973) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Refresh the MCP SDK, validation libraries, Pi host SDK, and transitive runtime dependencies, including security-fixed Hono, URI, archive, HTTP, and parser releases.

## 0.7.5

### Patch Changes

- [#273](https://github.com/Lykhoyda/ask-llm/pull/273) [`e685565`](https://github.com/Lykhoyda/ask-llm/commit/e68556513c59c8a2c56a64c0443c9b36eff0ec64) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Fix archived-session detection on codex 0.147.0+ by matching the real `thread <id> is archived` error wording, restoring the actionable `codex unarchive` guidance on resume failures.

- [#279](https://github.com/Lykhoyda/ask-llm/pull/279) [`9d27169`](https://github.com/Lykhoyda/ask-llm/commit/9d27169fbe22c2ffbfae0be9d6cba841b98e42f1) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add first-class Grok consultations through explicit xAI API or official Grok CLI harnesses, with exact model selection, strict no-fallback diagnostics, redacted credentials, cancellation, telemetry, and opt-in live tests. Add a separate model-neutral Cursor Agent harness that requires provider and exact Cursor model attribution, runs read-only, and never changes trust or spend settings. The Cursor provider enum is `claude`, `codex`, `gemini`, `grok` in the unified server and Pi, and the requested model must belong to that family (Auto and noncanonical IDs are refused); `AskResponse` gains an optional `reportedModel` carrying Cursor's display label while `model` echoes the exact requested catalog ID. Prompts above 16 KB reach Grok CLI through a private `--prompt-file` (only when `grok --help` advertises it; otherwise they fail before spawn) and Cursor Agent over stdin. xAI effort coercion (`xhigh` applied as `high` on older models) and served-model alias resolution are disclosed, and an effort-rejecting 4xx is classified with the supported list.

## 0.7.4

### Patch Changes

- [#264](https://github.com/Lykhoyda/ask-llm/pull/264) [`2433d79`](https://github.com/Lykhoyda/ask-llm/commit/2433d79453363ece39fb08da6d585039da224274) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add first-class Pi host support to the canonical dual-host plugin package, including portable skills, native provider tools, deterministic multi-provider dispatch, consent-gated lifecycle pairing, package/install CI, and abortable provider execution.

## 0.7.3

### Patch Changes

- [#255](https://github.com/Lykhoyda/ask-llm/pull/255) [`1d0984b`](https://github.com/Lykhoyda/ask-llm/commit/1d0984bd6996ac1864db9cdb5a46d84e17b750fc) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Restore persisted Codex session continuity while keeping omitted sessions ephemeral, starting persisted threads for empty `sessionId`, using supported sandbox config grammar for resume calls, and surfacing missing rollouts with actionable guidance.

## 0.7.2

### Patch Changes

- [#246](https://github.com/Lykhoyda/ask-llm/pull/246) [`a1f62ad`](https://github.com/Lykhoyda/ask-llm/commit/a1f62ad1625c4248876c40842801fe0c4403c561) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Improve shared CLI diagnostics with cross-platform command lookup and provider version assessment, update the antigravity provider default model to agy 1.1.5's stable base slug `gemini-3.1-pro`, and exclude detected unsupported installations from dispatch with actionable diagnostics ([#243](https://github.com/Lykhoyda/ask-llm/issues/243)).

## 0.7.1

### Patch Changes

- [#237](https://github.com/Lykhoyda/ask-llm/pull/237) [`ba569cc`](https://github.com/Lykhoyda/ask-llm/commit/ba569cc1f8346ef2db76e6733fa9d9f222f61242) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Expose an explicit `sandbox` opt-in on the `ask-codex` tool. Every Codex run now
  defaults to `--sandbox read-only` (ADR-136), which silently broke `/codex-image`
  because Codex could no longer write the generated PNG to disk. `ask-codex` now
  accepts an optional `sandbox` enum (`read-only` | `workspace-write`, default
  `read-only`) that passes through to the executor as a deliberate opt-out of the
  read-only review contract for flows that must have Codex write files. The
  `/codex-image` skill now sets `sandbox: "workspace-write"`; review, second-opinion,
  and analysis flows continue to run read-only.

- [#237](https://github.com/Lykhoyda/ask-llm/pull/237) [`ba569cc`](https://github.com/Lykhoyda/ask-llm/commit/ba569cc1f8346ef2db76e6733fa9d9f222f61242) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Keep managed review paths read-only, isolate concurrent compare runs, fix
  special-character Stop-gate paths, and include the MIT license in every
  published package tarball.

## 0.7.0

### Minor Changes

- [#227](https://github.com/Lykhoyda/ask-llm/pull/227) [`a3c3ba3`](https://github.com/Lykhoyda/ask-llm/commit/a3c3ba38fc1643059f4d5a75208b99e580ae9d4b) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a safe typed machine protocol for subscription-backed factory planning, review, and verification.

## 0.6.2

### Patch Changes

- [#230](https://github.com/Lykhoyda/ask-llm/pull/230) [`394c305`](https://github.com/Lykhoyda/ask-llm/commit/394c305806607ca5db4803c666a0ebdc3304c2db) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Move every public MCP package into the canonical `@ask-llm` npm organization,
  while preserving the existing executable names for compatibility.

## 0.6.1

### Patch Changes

- [#222](https://github.com/Lykhoyda/ask-llm/pull/222) [`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a first-class Claude Code CLI provider so Codex and other MCP clients can
  ask Claude for a read-only second opinion. The new `@anton-lykhoyda/ask-claude-mcp` package
  supports native sessions, Opus-to-Sonnet fallback, usage reporting, relative
  context directories, and a hard Read/Glob/Grep-only tool boundary. The unified
  orchestrator now auto-detects Claude and can include it in `ask-llm`,
  `multi-llm`, diagnostics, and the REPL.

- [#222](https://github.com/Lykhoyda/ask-llm/pull/222) [`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Update Codex defaults to the GPT-5.6 family: GPT-5.6 Sol is now the
  quality-first model for MCP calls, reviews, brainstorming, image orchestration,
  and codex-pair, with GPT-5.6 Terra as the balanced quota fallback. The legacy
  preferred-model escape hatch remains available, but no longer adds a redundant
  attempt when it resolves to the Sol default. `ask-codex` now accepts an optional
  `reasoningEffort`; general calls preserve `medium`, while `/codex-review` and
  `/brainstorm` use `high`.

## 0.6.0

### Minor Changes

- [#220](https://github.com/Lykhoyda/ask-llm/pull/220) [`1089a21`](https://github.com/Lykhoyda/ask-llm/commit/1089a215657594a1c569dcd6c180d94750b1dab6) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Codex `/codex-review` and `/brainstorm` now prefer `gpt-5.5-pro` when the Codex
  account is entitled, falling back transparently to `gpt-5.5` (then `gpt-5.4-mini`
  on quota). Those two commands opt in automatically; the raw `ask-codex` tool can
  opt in with the new `preferred` arg. `ASK_CODEX_PREFERRED_MODEL` customizes which
  model the preferred tier uses (default `gpt-5.5-pro`) — it does not by itself
  enable preferred mode. `/multi-review`'s Codex leg inherits the preferred tier
  via the shared `codex-reviewer` agent (its binary-fallback path stays on
  `gpt-5.5`); `codex-pair` and `/codex-verify` are unchanged. (ADR-132)

## 0.5.0

### Minor Changes

- [#199](https://github.com/Lykhoyda/ask-llm/pull/199) [`553b93b`](https://github.com/Lykhoyda/ask-llm/commit/553b93b9587df53b3b0b583b323955663b27ed64) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - 2026-07-02 audit hardening batch (ADR-128):

  - **shared**: new canonical `PROVIDERS` tuple + `ProviderName` type (single source of truth for the provider list); new `relativeDirSchema` for includeDirs-style params; `ASK_OLLAMA_TIMEOUT_MS` / `DEFAULT_OLLAMA_TIMEOUT_MS` in `EXECUTION`; chunkCache now creates its dir 0700 and chunk files 0600 (and tightens dirs from older releases); `registerTools()` fails fast on duplicate tool names; stderr accumulation switched to `Buffer[]` (parity with stdout).
  - **ollama**: the `/api/chat` call finally has a timeout — `AbortController` bounded by `ASK_OLLAMA_TIMEOUT_MS` > `GMCPT_TIMEOUT_MS` > 600s default, with an actionable timeout error; previously a wedged Ollama server hung `ask-ollama` forever.
  - **codex**: JSONL output that parses into events but contains no agent message now throws an actionable error (naming the thread id, with truncated raw output) instead of returning the raw JSONL dump as the "response"; plain-text output still passes through. `includeDirs` on `ask-codex`/`ask-codex-edit` now validates paths (relative only, no `..`/`~`) — parity with `ask-gemini-edit`.
  - **gemini**: empty-string `sessionId` now bypasses the response cache (parity with codex/ollama, ADR-063 semantics) — previously a cached body with `sessionId: undefined` was returned instead of performing the session turn; includeDirs cache-key construction no longer mutates the caller's array.
  - **llm-mcp**: `multi-llm` outputSchema and the no-providers-detected fallback enum now include `antigravity` (previously the declared contract rejected antigravity usage stats); REPL `/provider` help derives from the provider registry.
  - **plugin**: plugin.json + marketplace.json description/keywords now name Antigravity; manifest tests assert all four runner binaries.

## 0.4.1

### Patch Changes

- [#195](https://github.com/Lykhoyda/ask-llm/pull/195) [`f65e72f`](https://github.com/Lykhoyda/ask-llm/commit/f65e72f03b975a93d480091687729350b78788d6) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Fix the Codex quota-fallback model: default to `gpt-5.4-mini` instead of `gpt-5.5-mini`.

  `gpt-5.5-mini` is rejected with a `400 "not supported when using Codex with a ChatGPT account"` on ChatGPT-plan accounts — the common case for the `codex` CLI, where plan quota is account-wide — so when `gpt-5.5` hit a usage limit the fallback retry failed (`…fallback also failed`) instead of producing a cheaper answer. `gpt-5.4-mini` is confirmed to work on both ChatGPT-plan and API-key accounts and is now the default `ASK_CODEX_FALLBACK_MODEL`. The `gpt-5.5` primary default is unchanged, and API-key users who prefer `gpt-5.5-mini` can still pin it via `ASK_CODEX_FALLBACK_MODEL`. The codex-pair plugin default is updated to match. See ADR-126 (closes [#194](https://github.com/Lykhoyda/ask-llm/issues/194)).

- [#198](https://github.com/Lykhoyda/ask-llm/pull/198) [`4938dba`](https://github.com/Lykhoyda/ask-llm/commit/4938dbaeb422e3c5dcfd5ed2780ad030b819a832) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Surface an actionable error when a pinned `ASK_CODEX_FALLBACK_MODEL` is structurally unavailable for your Codex account type.

  Previously, if the primary model hit a quota error and a pinned fallback (e.g. `ASK_CODEX_FALLBACK_MODEL=gpt-5.5-mini` on a ChatGPT-plan account) was rejected with `400 "not supported when using Codex with a ChatGPT account"`, the MCP executor surfaced a generic `…fallback also failed: <400>. Run \`codex doctor\``message — and`codex doctor`cannot diagnose an account-type model restriction. The executor now detects this case (porting`isModelUnavailableError`from the codex-pair hook, ADR-123) and throws a message that names the model, explains it isn't available for your account type, and points at`ASK_CODEX_FALLBACK_MODEL`(the default`gpt-5.4-mini` works on both ChatGPT-plan and API-key accounts). The default fallback already works everywhere (ADR-126), so this only affects users who deliberately pin an incompatible model. See ADR-127 (closes [#196](https://github.com/Lykhoyda/ask-llm/issues/196)).

## 0.4.0

### Minor Changes

- [#185](https://github.com/Lykhoyda/ask-llm/pull/185) [`206943d`](https://github.com/Lykhoyda/ask-llm/commit/206943deb83975e7b06f461771087210617d7287) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - `ask-llm doctor` now folds a compact `codex doctor` health summary into the Codex provider section ([#183](https://github.com/Lykhoyda/ask-llm/issues/183)). When codex is available, the doctor capability-probes `codex doctor --json` and, on success, shows codex's overall status plus any non-ok checks with remediation (the full mapped check list rides along in `--json`). It degrades silently when codex is absent, too old to support `--json`, or emits no usable report — but a non-zero exit that still carries a valid JSON report on stdout is salvaged and surfaced (codex emits the report even when exiting non-zero on error-level health). Default output is unchanged, and codex health never affects the doctor exit code. Implemented via a generic `enrich` hook on the provider spec so `@ask-llm/shared` stays provider-agnostic; codex-specific parsing lives in `ask-codex-mcp`. (gemini/ollama/antigravity bump = rebuild only: they embed the updated shared `doctor.ts`, ADR-119.)

## 0.3.11

### Patch Changes

- [#177](https://github.com/Lykhoyda/ask-llm/pull/177) [`fc40dcb`](https://github.com/Lykhoyda/ask-llm/commit/fc40dcbca3256d1558c2910bb30df64f373876ab) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Fix [#115](https://github.com/Lykhoyda/ask-llm/issues/115): `npm install -g` / `npx -y` on Node 26 crashed with `ERR_MODULE_NOT_FOUND` (npm 11 leaves empty placeholder dirs for bundled packages' transitive deps). `@ask-llm/shared` is now inlined into each package's `dist/` at build time (tsdown); `bundledDependencies` and the prepack/postpack manifest rewriting are gone entirely, so published manifests contain plain semver only.

## 0.3.10

### Patch Changes

- [#173](https://github.com/Lykhoyda/ask-llm/pull/173) [`2f12b43`](https://github.com/Lykhoyda/ask-llm/commit/2f12b43c5b8111e3f726ee52fc237ca31df0b4b0) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Fix Codex quota fallback for CLI 0.137+ ("You've hit your usage limit").

  Codex 0.137 reports plan exhaustion as `{"type":"error","message":"You've hit your usage limit"}` on **stdout JSONL** while exiting non-zero, with only a benign `Reading additional input from stdin...` notice on stderr. Two gaps meant the gpt-5.5 → gpt-5.5-mini fallback silently never fired:

  - `executeCommand` discarded stdout on a non-zero exit, so the quota text never reached `isQuotaError()`. It now unions stderr+stdout into the rejected error (stdout-borne errors from any provider are now visible), and `sanitizeErrorForLLM` passes the `usage limit` phrasing through untruncated.
  - The Codex executor's `QUOTA_SIGNALS` now includes `usage limit`, so the error is classified as quota and the fallback model is used.

- Updated dependencies [[`2f12b43`](https://github.com/Lykhoyda/ask-llm/commit/2f12b43c5b8111e3f726ee52fc237ca31df0b4b0)]:
  - @ask-llm/shared@0.3.4

## 0.3.8

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

## 0.3.7

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
