# ask-llm-mcp

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
