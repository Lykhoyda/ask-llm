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

Requires Node.js 22.18+ to build (the tsdown toolchain's floor since ADR-119 — published packages still run on Node 20+) and Yarn 4.18+ (managed via the `packageManager` field). Every workspace compiles with TypeScript 7 (ADR-143); `scripts/typescript-contract.test.ts` fails the build if a package drifts off that floor.

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
| `packages/claude-plugin/` | Canonical Claude Code + Cursor Agent + Pi host package — skills, host adapters, hooks, and CLI binaries |
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
5. Add a corresponding `<provider>-reviewer.md` agent and `<provider>-review` skill in `packages/claude-plugin/`.
6. Update the marketplace manifest and root `README.md` provider table.

## Versioning your change

We use [Changesets](https://changesets.dev/) (ADR-076). Before opening a PR that affects any published package, run:

```bash
yarn changeset
```

Interactive prompt asks (a) which packages your change affects, (b) the bump type (patch / minor / major), and (c) a summary line that goes into the changelog. It writes a markdown file under `.changeset/<random-id>.md` — commit that file with your PR.

**You don't need to manually bump `package.json` versions.** The bot does that.

You can pick "patch" for any package even if your change doesn't directly touch it. IMPORTANT (ADR-119): `@ask-llm/shared` is private and INLINED into each MCP's `dist/` at build time by tsdown — and because shared is only a devDependency of the MCPs, the changesets internal-dependents cascade does NOT fire for it (verified empirically 2026-06-10). Any change to `packages/shared/src/**` MUST ship with a changeset that explicitly lists all seven publishable MCP packages (`@ask-llm/gemini-mcp`, `@ask-llm/codex-mcp`, `@ask-llm/claude-mcp`, `@ask-llm/grok-mcp`, `@ask-llm/ollama-mcp`, `@ask-llm/antigravity-mcp`, `@ask-llm/mcp`) — otherwise the fix never reaches npm. CI enforces this via `scripts/check-shared-changeset.mjs`.

`@ask-llm/plugin` is the single publishable Claude Code + Cursor Agent + Pi package. Changesets publishes it to npm for Pi while the same package version and canonical skill corpus continue through the Claude Code marketplace and the Cursor Plugin adapter. `packages/claude-plugin/package.json` is authoritative; `yarn changeset:version` mirrors its version to `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, and the marketplace manifest, and lint (`scripts/sync-plugin-manifests.mjs --check`) verifies all four stay synchronized. See [ADR-142](DECISIONS.md) and ADR-147 for the host and release contract.

If your PR is infrastructure-only (no published behavior change), skip the changeset.

## Releases

Driven by [changesets/action](https://github.com/changesets/action) (ADR-076). The release flow has **two phases**, both kicked off automatically by pushes to `main`:

**Phase 1 — Version Packages PR**: when your PR with a changeset merges to `main`, the `release.yml` workflow runs, sees pending changesets, and opens (or updates) a `chore: version packages` PR. That PR bumps `package.json` versions, generates `CHANGELOG.md` entries, and deletes the consumed `.changeset/*.md` files. **You don't open this PR — the bot does.** Multiple changesets accumulate into one Version Packages PR until you're ready to ship.

**Phase 2 — Publish**: when the maintainer merges the Version Packages PR, `release.yml` runs again, this time detecting that the merge consumed changesets. It runs `yarn changeset:publish` which publishes every workspace package whose version is ahead of the npm registry via `npm publish` (changesets/action). Since ADR-119 the manifests publish exactly as they exist in source — no `workspace:` protocol remains (llm-mcp's sibling deps are real semver ranges maintained by changesets; `@ask-llm/shared` is a devDependency, inlined into `dist/` by tsdown), so no rewrite step exists to get wrong. After npm, the workflow publishes to the MCP Registry, creates a unified GitHub Release tagged `v<gemini-version>` (legacy convention from when this was a fork of gemini-mcp-tool), and then creates or verifies one remote `<package-name>@<version>` Git tag for every public package. `changesets/action` is explicitly configured not to create releases or tags; the dedicated ADR-151 helper is the sole package-tag authority, verifies remote refs plus npm `gitHead`, and pushes only missing explicit refspecs. `@ask-llm/shared` is private and receives no tag.

**Maintainer responsibilities** are minimal: review the Version Packages PR (does the CHANGELOG read sensibly? are the bump types right?), merge it when ready to ship. No manual `git tag` or `package.json` editing. Release recovery uses the same create-or-verify package-tag contract and never retags an existing remote ref. If the release job reports `npm gitHead cross-check failed` for a package (its published tarball came from a commit other than the one that introduced the version, for example after a partial publish completed on a later commit), the other packages are still tagged; recover the affected package by shipping a new version — never by retagging.

## Questions

Open a [GitHub discussion](https://github.com/Lykhoyda/ask-llm/discussions) or comment on an existing issue.
