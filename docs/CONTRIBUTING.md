# Contributing to Ask LLM

Thanks for your interest. This is a Yarn workspace monorepo with provider, host, and shared packages plus a docs site.

## Getting started

```bash
git clone https://github.com/Lykhoyda/ask-llm.git
cd ask-llm
yarn install
yarn build
yarn test
```

Use Node.js 24 (the current LTS) or newer and Yarn 4.18+ (managed via the `packageManager` field); every package requires Node 24+ (ADR-171). Every workspace compiles with TypeScript 7 (ADR-143); `scripts/typescript-contract.test.ts` fails the build if a package drifts off that floor. Supported platforms are Linux and macOS. CI runs the five-batch test suite on Ubuntu (Node 24.x) plus a dedicated `pi-lifecycle-macos` job; native Windows is not supported.

## Project layout

| Path | Purpose |
|------|---------|
| `packages/shared/` | Shared MCP plumbing (`@ask-llm/shared`) — logger, executor, registry, progress tracker, server factory |
| `packages/gemini-mcp/` | Gemini provider (`@ask-llm/gemini-mcp`) |
| `packages/codex-mcp/` | Codex provider (`@ask-llm/codex-mcp`) |
| `packages/claude-mcp/` | Claude provider (`@ask-llm/claude-mcp`) |
| `packages/grok-mcp/` | Grok/xAI API provider (`@ask-llm/grok-mcp`) |
| `packages/ollama-mcp/` | Ollama provider (`@ask-llm/ollama-mcp`) |
| `packages/antigravity-mcp/` | Antigravity provider (`@ask-llm/antigravity-mcp`) |
| `packages/llm-mcp/` | Orchestrator that auto-detects installed providers (`@ask-llm/mcp`) |
| `packages/claude-plugin/` | Dependent compatibility bridge for existing runner and Pi installations |
| `apps/docs/` | VitePress docs site |
| `docs/` | Internal project docs — `ROADMAP.md`, `DECISIONS.md`, `BUGS.md`, `plans/` |

See [`CLAUDE.md`](../CLAUDE.md) for the full architecture.

## Workflow

1. **Open an issue first.** Describe the bug or feature so we can agree on scope before code is written. Saves rework.
2. **Branch from `main`.** Forks aren't required.
3. **Run the checks.** Before pushing:
   ```bash
   yarn build   # Build dependency-ordered workspace output used by tests
   yarn lint    # Biome + tsc --noEmit across all packages
   yarn test    # Run all Vitest projects
   ```
   CI splits `yarn test` into five deterministic file batches. To reproduce one locally,
   run `yarn test:batch 1/5` (replace `1` with the failing batch number).
   Claude does not review every PR in CI. Mention `@claude` on an issue or PR when you
   want a review.
4. **Add tests for new behavior.** New executor logic, parsers, or shared utilities should have unit tests next to the code (`__tests__/`). Integration tests that hit a real CLI go in `src/__tests__/integration.test.ts` and are gated behind `SMOKE_TEST=1`.
5. **Add an ADR for architectural changes.** Append a new entry to [`docs/DECISIONS.md`](DECISIONS.md) for changes that affect public API, the executor pattern, cross-package contracts, or distribution. Use the existing format: `## ADR-NNN: Title`, `Date`, `Status`, `Context`, `Decision`, `Consequences`. The historical ADRs are good models.
6. **Conventional commits.** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:` — see `git log` for in-house style. The release pipeline reads commit history.
7. **Update `docs/ROADMAP.md` and `docs/BUGS.md`** if your change resolves a tracked item.
8. **Add a changeset** if your change affects published packages. See "Versioning your change" below.

## Local harness smoke tests

Harness-facing changes use one explicit, local-only pre-PR gate:

```bash
yarn prepr:harness
```

It runs the immutable install, build, lint, full test suite, and deterministic real-adapter/fake-transport multi-harness matrix. The Husky `pre-push` hook runs only the fast deterministic matrix; it never spends quota. Optional live calls require explicit per-surface and exact-model authorization and are never required by CI. Results distinguish `PASS`, `FAIL`, `SKIP_UNAVAILABLE`, and `SKIP_NOT_AUTHORIZED`; missing optional tools never look green. See [Local harness smoke gate](HARNESS-SMOKE.md) for prerequisites, cost boundaries, cleanup, troubleshooting, and the PR evidence format.

## Adding a new tool

`scripts/release-contract.test.ts` pins the unified and split MCP tool names and input/output schemas (including schema descriptions), AskResponse attribution, doctor JSON shape, published bin names, and Pi tool names and schemas. After an intended contract change, run `yarn build && ASK_LLM_UPDATE_CONTRACT=1 yarn vitest run scripts/release-contract.test.ts && yarn biome format --write scripts/fixtures/contract`, then review the fixture diff.

1. Define a Zod schema for inputs in `packages/<provider>-mcp/src/tools/`.
2. Create a `UnifiedTool` object with `name`, `description`, `zodSchema`, `execute`.
3. Register it in the provider's `tools/index.ts`.
4. Add tests next to the executor (`__tests__/`).

## Adding a new provider

The architecture is designed for new providers — see ADR-026, 028, 029, 032 for the existing four. High-level steps:

1. New package `packages/<provider>-mcp/` mirroring `ollama-mcp/`'s structure.
2. Implement `src/utils/<provider>Executor.ts` (HTTP) or shell out to a CLI (Gemini/Codex pattern).
3. Add `isProviderAvailable()` (HTTP) or rely on `isCommandAvailable()` (CLI) so `llm-mcp` can auto-detect it.
4. Wire the provider into `packages/llm-mcp/src/constants.ts`.
5. Add a corresponding `<provider>-reviewer.md` agent and `ask-llm-<provider>-review` skill in `packages/llm-mcp/`.
6. Update the marketplace manifest and root `README.md` provider table.

## Versioning your change

A map of every version-update path (packages, models, CLI floors, deps) is in [Keeping versions updated](VERSIONS.md).

We use [Changesets](https://changesets.dev/) (ADR-076). Before opening a PR that affects any published package, run:

```bash
yarn changeset
```

Interactive prompt asks (a) which packages your change affects, (b) the bump type (patch / minor / major), and (c) a summary line that goes into the changelog. It writes a markdown file under `.changeset/<random-id>.md` — commit that file with your PR.

**You don't need to manually bump `package.json` versions.** The bot does that.

You can pick "patch" for any package even if your change doesn't directly touch it. `@ask-llm/shared` and the six provider workspaces are private build inputs bundled into `@ask-llm/mcp`; shared and provider source changes require an explicit canonical package changeset because the devDependency cascade does not publish it automatically. CI enforces this via `scripts/check-shared-changeset.ts`.

`@ask-llm/mcp` owns the Claude Code, Cursor Agent and Pi assets; `@ask-llm/plugin` forwards to it for existing installations. `packages/llm-mcp/package.json` is authoritative for the host manifests; `yarn changeset:version` mirrors its version to `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json` and the marketplace manifest, and lint verifies synchronization.

If your PR is infrastructure-only (no published behavior change), skip the changeset.

## Releases

Driven by [changesets/action](https://github.com/changesets/action) (ADR-076). The release flow has **two phases**, both kicked off automatically by pushes to `main`:

**Phase 1 — Version Packages PR**: when your PR with a changeset merges to `main`, the `release.yml` workflow runs, sees pending changesets, and opens (or updates) a `chore: version packages` PR. That PR bumps `package.json` versions, generates `CHANGELOG.md` entries, and deletes the consumed `.changeset/*.md` files. **You don't open this PR — the bot does.** Multiple changesets accumulate into one Version Packages PR until you're ready to ship.

**Phase 2 — Publish**: when the maintainer merges the Version Packages PR, `release.yml` runs again, this time detecting that the merge consumed changesets. It runs `yarn changeset:publish` which publishes every publishable workspace package whose version is ahead of the npm registry via `yarn npm publish` (Changesets 3 / ADR-156). `NODE_AUTH_TOKEN` authenticates npm CLI steps (`npm whoami`, `npm access`); `YARN_NPM_AUTH_TOKEN` must be set to the same secret or Yarn reports `YN0033` and publishes nothing. The post-publish public-access step reads current status first and does not fail the job when packages are already public or the token cannot change access (ADR-157). Since ADR-119 the manifests publish exactly as they exist in source — no `workspace:` protocol remains (the providers and `@ask-llm/shared` are devDependencies, inlined into canonical `dist/` by tsdown), so no rewrite step exists to get wrong. After npm, the workflow publishes to the MCP Registry, creates a unified GitHub Release on the `@ask-llm/mcp@<version>` package tag (ADR-181; the helper below creates or verifies that tag first), and then creates or verifies one remote `<package-name>@<version>` Git tag for every public package. `changesets/action` is explicitly configured not to create releases or tags; the dedicated ADR-151 helper is the sole package-tag authority, verifies remote refs plus npm `gitHead`, and pushes only missing explicit refspecs. `@ask-llm/shared` is private and receives no tag.

**Maintainer responsibilities** are minimal: review the Version Packages PR (does the CHANGELOG read sensibly? are the bump types right?), merge it when ready to ship. No manual `git tag` or `package.json` editing. If npm published but Registry, the unified GitHub Release, or package tags did not, Run workflow on `main` — there are no dispatch options. That path repairs those three artifacts and never re-enters npm publication (ADR-139/158). Release recovery uses the same create-or-verify package-tag contract and never retags an existing remote ref. If the release job reports `npm gitHead cross-check failed` for a package (its published tarball came from a commit other than the one that introduced the version, for example after a partial publish completed on a later commit), the other packages are still tagged; recover the affected package by shipping a new version — never by retagging. A main-branch Run workflow cannot repair that mismatch because it never republishes npm.

### Deprecating the split packages and the plugin bridge

This runs once, by hand, and never from `release.yml` (ADR-179, ADR-185). Nothing is unpublished, and `@ask-llm/mcp` is never deprecated or shimmed.

1. Confirm the migration page is live: `https://lykhoyda.github.io/ask-llm/reference/migration.html` must load.
2. Confirm the `@ask-llm/mcp` release whose `ask-llm setup` migrates earlier installations is on npm (`npm view @ask-llm/mcp version`).
3. Run the seven commands, adding `--otp=<code>` when npm asks for two-factor authentication:

```bash
npm deprecate @ask-llm/antigravity-mcp "Replaced by @ask-llm/mcp, which includes every provider. Install it with npm install -g @ask-llm/mcp, then run ask-llm setup. Migration guide: https://lykhoyda.github.io/ask-llm/reference/migration.html"
npm deprecate @ask-llm/claude-mcp "Replaced by @ask-llm/mcp, which includes every provider. Install it with npm install -g @ask-llm/mcp, then run ask-llm setup. Migration guide: https://lykhoyda.github.io/ask-llm/reference/migration.html"
npm deprecate @ask-llm/codex-mcp "Replaced by @ask-llm/mcp, which includes every provider. Install it with npm install -g @ask-llm/mcp, then run ask-llm setup. Migration guide: https://lykhoyda.github.io/ask-llm/reference/migration.html"
npm deprecate @ask-llm/gemini-mcp "Replaced by @ask-llm/mcp, which includes every provider. Install it with npm install -g @ask-llm/mcp, then run ask-llm setup. Migration guide: https://lykhoyda.github.io/ask-llm/reference/migration.html"
npm deprecate @ask-llm/grok-mcp "Replaced by @ask-llm/mcp, which includes every provider. Install it with npm install -g @ask-llm/mcp, then run ask-llm setup. Migration guide: https://lykhoyda.github.io/ask-llm/reference/migration.html"
npm deprecate @ask-llm/ollama-mcp "Replaced by @ask-llm/mcp, which includes every provider. Install it with npm install -g @ask-llm/mcp, then run ask-llm setup. Migration guide: https://lykhoyda.github.io/ask-llm/reference/migration.html"
npm deprecate @ask-llm/plugin "Now part of @ask-llm/mcp. Install it with npm install -g @ask-llm/mcp, then run ask-llm setup. Existing Pi npm installations remain unchanged with manual migration guidance. Migration guide: https://lykhoyda.github.io/ask-llm/reference/migration.html"
```

4. Verify: `npm view <package> deprecated` prints the message for each of the seven, and `npm view @ask-llm/mcp deprecated` prints nothing.
5. Retiring the split packages' MCP Registry records is separate, approved publication work.

## Questions

Open a [GitHub discussion](https://github.com/Lykhoyda/ask-llm/discussions) or comment on an existing issue.
