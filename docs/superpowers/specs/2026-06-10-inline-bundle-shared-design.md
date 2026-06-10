# Inline-bundle `@ask-llm/shared` — fix #115 (Node 26 global install), retire the bundling lifecycle

- **Date:** 2026-06-10
- **Status:** Approved design (brainstormed; supersedes the deferred "Tier-B B1 vs B2" question from ADR-107)
- **Issue:** [#115](https://github.com/Lykhoyda/ask-llm/issues/115) — `npx ask-llm-mcp doctor` / `npm install -g` crashes with `ERR_MODULE_NOT_FOUND` on Node 26
- **ADR:** ADR-119

## 1. Problem

`@ask-llm/shared` is `private: true`, so the five publishable MCP packages ship it via `bundledDependencies` + a `prepack`/`postpack` lifecycle (`scripts/prepack-bundle.mjs`, `scripts/postpack-restore.mjs`) that copies `shared/dist` into `node_modules/` and rewrites `workspace:* → *` in the published manifest (ADR-052).

That mechanism triggers a real npm 11 bug: on **global install**, the bundled packages extract correctly but their non-bundled transitive deps (`zod`, `@modelcontextprotocol/sdk`, … — 78 packages in the reproduced case) become **empty placeholder directories**. Node's ESM resolver hits the empty `zod/`, falls into `legacyMainResolve`, and crashes (`ERR_MODULE_NOT_FOUND` on `zod/index.js`). Local (non-global) installs of the same tarball work. See ADR-106's reproduction.

History constraint: the first fix attempt (ADR-106, "publish shared as public") shipped four broken tarballs on 2026-05-27 because it verified via `yarn pack` while the real publish path is `npm publish` (changesets/action), which does **not** rewrite `workspace:*`. ADR-107 reverted it and deferred #115 as "B1 (inline-bundle) vs B2 (public shared)".

## 2. Decision — B1: inline-bundle `@ask-llm/shared` into each MCP package's `dist/`

A bundler (tsup over the already-present esbuild) inlines shared's code into each publishable package at build time. `@ask-llm/shared` then disappears from `dependencies` entirely, and `bundledDependencies` + the prepack/postpack lifecycle are deleted.

**Why B1 over B2** (the decisive asymmetry):

| | B1 inline-bundle | B2 public shared |
|---|---|---|
| Removes `bundledDependencies` (the #115 trigger) | yes | yes |
| Needs `workspace:*` rewrite at publish | **no** — shared is no longer a runtime dep | yes — `npm publish` never rewrites (the ADR-106 failure) |
| Needs `@ask-llm` npm org creation | no | yes (the other ADR-106 failure) |
| Publish ordering / partial-publish risk | none | shared-before-dependents |
| Keeps shared `private: true` | yes | no — becomes a public API surface |
| Build-tooling change | adds tsup | none |
| Also eliminates ADR-052's npm-9 `EUNSUPPORTEDPROTOCOL` class | yes (no `workspace:` left in provider manifests) | only after a correct rewrite |

B1 kills **both** historical bug classes (npm 11 `bundledDependencies` global-install, npm 9 `workspace:` manifest parsing) by removing their preconditions, instead of guarding them.

## 3. Design

### 3.1 Packages in scope

The five publishable packages: `ask-gemini-mcp`, `ask-codex-mcp`, `ask-ollama-mcp`, `ask-antigravity-mcp`, `ask-llm-mcp`.

- `@ask-llm/shared` stays `private: true` and keeps building with `tsc` (it is the inlining *source*).
- `@ask-llm/plugin` (claude-plugin) is unchanged: private, marketplace-distributed, keeps `workspace:*` deps. Its static imports of `ask-*-mcp/executor` keep working because the subpath exports are preserved (3.2).

### 3.2 Build: tsup per publishable package

- `build: tsup` replaces `tsc -b` as the build step. Type-checking stays in `lint` (`tsc --noEmit`, unchanged). Tests stay on vitest against `src` (unchanged).
- Config per package (`tsup.config.ts`): `format: ['esm']`, `dts: true`, `clean: true` (wipe stale `tsc` artifacts so they can't leak into tarballs), `splitting: true`, and `noExternal: ['@ask-llm/shared']` with everything else external.
- **Entries mirror the existing `exports` map.** Provider packages: `index` (`src/index.ts`), `cli` (`src/cli.ts`), `executor` (`src/utils/<provider>Executor.ts`), `register` (`src/tools/index.ts`). `llm-mcp`: `index` + `cli` only. The `exports`/`bin` fields are updated to the new output paths.
- **`splitting: true` is load-bearing, not cosmetic:** with multiple entries and no splitting, esbuild duplicates shared modules into each entry bundle. Module-level state inside one package (e.g. the tool registry consumed by both `.` and `./register`) would then exist twice in one process. Splitting emits common chunks so each module stays a process-wide singleton *within* a package.
- **`dts` must be self-contained:** the rolled-up `.d.ts` files must not contain `import ... from "@ask-llm/shared"` (shared won't be installed for consumers). Acceptance check greps the emitted `.d.ts` for the package name.
- Build order is preserved by the existing `yarn workspaces foreach -At` (shared before MCPs). Verify the topological sort still orders shared first once it moves to `devDependencies` (plan task).

### 3.3 Dependency changes

Per provider package (`gemini`/`codex`/`ollama`/`antigravity`):

- `dependencies`: **remove** `"@ask-llm/shared": "workspace:*"`. Keep `zod` + `@modelcontextprotocol/sdk` as normal registry deps (they were never the problem — only *bundled* deps trigger the npm 11 bug).
- `devDependencies`: **add** `"@ask-llm/shared": "workspace:*"` — needed for local resolution (build/type-check/tests) and for the changesets cascade (3.5). `workspace:*` in devDependencies is publish-safe: npm ignores devDeps of installed packages, and the preflight gate has always excluded the field.
- **Delete** `bundledDependencies`, `prepack`, `postpack`.

`ask-llm-mcp` additionally:

- Its four sibling deps (`ask-gemini-mcp` etc.) **must remain runtime `dependencies`** — `index.ts` loads providers via dynamic `import(provider.executorModule)` with string variables, which a bundler cannot (and must not) inline; they resolve from `node_modules` at runtime.
- These switch from `workspace:*` to **real semver ranges** (`"ask-gemini-mcp": "^1.6.10"`, …). Yarn 4 still links the local workspace when the range matches; changesets maintains the ranges on every internal release (`updateInternalDependencies: "patch"` is already configured). Result: no `workspace:` protocol anywhere in any published manifest, with zero publish-time rewriting.

`scripts/prepack-bundle.mjs` and `scripts/postpack-restore.mjs` are **deleted** (no surviving consumers).

### 3.4 Publish pipeline

`release.yml` / changesets flow is otherwise unchanged. `scripts/preflight-no-workspace-protocol.mjs` is **kept and simplified+strengthened**:

- Since no lifecycle mutates manifests anymore, the gate becomes a static scan of each publishable `package.json` (no prepack/postpack invocation needed).
- It keeps asserting no `workspace:` literal in `dependencies`/`peerDependencies`/`optionalDependencies`, and **additionally fails if a `bundledDependencies`/`bundleDependencies` field exists** on a publishable package — so neither historical regression class can be silently reintroduced.

### 3.5 Changesets cascade — must-verify

Today a shared fix cascades patch-bumps to all five MCPs because they list shared in `dependencies`; that cascade is how shared fixes reach npm (via re-bundling). After 3.3 the relationship moves to `devDependencies` — but the published artifacts still *embed* shared, so the cascade must keep firing or shared fixes silently stop shipping.

- **Task 1 of the implementation plan:** empirically verify that `changeset version` (with the repo's `updateInternalDependents: "always"` flag) bumps the five MCPs when a changeset touches only `@ask-llm/shared` as a devDependency relationship.
- **Fallback if it doesn't:** a CI guard — when a PR changes `packages/shared/src/**`, require the changeset to include the five publishable packages. Deterministic, no reliance on changesets internals.

### 3.6 Verification (closes the ADR-106 gap)

1. **Reproduce first:** `nvm install 26`, `npm install -g ask-llm-mcp@latest` (current bundled version), run `ask-llm-mcp doctor` → confirm the #115 crash on this machine.
2. **Verify the fix on the same binary:** build, `npm pack` each package (NOT `yarn pack`), `npm install -g` the tarballs on Node 26, run `ask-llm-mcp doctor` + boot each provider bin and assert it reaches its server-startup log without `ERR_MODULE_NOT_FOUND` (the #115 crash happens at import time, before startup; exact smoke mechanics — e.g. stdin-EOF or an MCP `initialize` round-trip — are defined in the implementation plan).
3. **Permanent CI smoke (new job):** on Node 26 — build, `npm pack` all five, then:
   - the four provider packages: `npm install -g <tarball>` + boot smoke (their deps are all public registry packages);
   - `ask-llm-mcp`: publish all five tarballs to a throwaway local registry (verdaccio) and `npm install -g ask-llm-mcp` from it + `doctor` — because at PR time its freshly-bumped sibling ranges may not exist on the real registry yet.
4. Existing 174+ tests across the suites stay green untouched (no runtime behavior change) — that is the regression net.
5. Tarball inspection: manifests contain no `workspace:`, no `bundledDependencies`, no `node_modules/` payload; `.d.ts` contain no `@ask-llm/shared` imports.

## 4. Failure modes designed against

| Risk | Mitigation |
|---|---|
| Bundler inlines/breaks the dynamic provider imports in `llm-mcp` | They are string-variable `import()`s — esbuild leaves them verbatim; siblings also listed as `external`. Covered by the verdaccio CI smoke. |
| Module-state duplication across entries within a package | `splitting: true` (3.2). |
| `.d.ts` referencing the now-absent shared package | dts rollup + grep acceptance check (3.2, 3.6.5). |
| Shared fixes silently stop shipping (cascade loss) | Must-verify Task 1 + CI-guard fallback (3.5). |
| Stale `tsc` output leaking into tarballs | tsup `clean: true`. |
| `createRequire(import.meta.url)` + `require("../package.json")` | ESM output at the same `dist/` depth — path semantics unchanged. |
| Build order regression after dep-field move | Plan task verifies `yarn workspaces foreach -At` still builds shared first. |
| Wrong-publisher verification (the ADR-106 killer) | All verification uses `npm pack`/`npm install -g`; never `yarn pack`. |

## 5. Out of scope

- B2 (publishing `@ask-llm/shared`) — rejected, see §2.
- Any change to `claude-plugin` packaging or the marketplace flow.
- Filing the npm 11 `bundledDependencies` global-install bug upstream (worth doing, independent).
- CJS output, minification, or bundling `zod`/`@modelcontextprotocol/sdk` (stay as registry deps).

## 6. Acceptance criteria

1. `npm install -g` of all five packages succeeds and their binaries boot on **Node 26** (the #115 repro passes).
2. No published manifest contains `workspace:` or `bundledDependencies` (preflight gate enforces both, forever).
3. `prepack-bundle.mjs` / `postpack-restore.mjs` no longer exist; no package has `prepack`/`postpack` hooks.
4. Full suite + lint + `yarn build` green; claude-plugin builds and its `*-run` binaries work unchanged.
5. The shared→MCP release cascade demonstrably still fires (or the CI-guard fallback is in place).
6. Node 26 global-install CI smoke runs on every PR/release.
