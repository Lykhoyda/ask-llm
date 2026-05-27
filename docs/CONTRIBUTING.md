# Contributing to Ask LLM

Thanks for your interest. This is a Yarn workspace monorepo with 6 packages and a docs site.

## Getting started

```bash
git clone https://github.com/Lykhoyda/ask-llm.git
cd ask-llm
yarn install
yarn build
yarn test
```

Requires Node.js 20+ and Yarn 4 (managed via the `packageManager` field).

## Project layout

| Path | Purpose |
|------|---------|
| `packages/shared/` | Shared MCP plumbing (`@ask-llm/shared`) — logger, executor, registry, progress tracker, server factory |
| `packages/gemini-mcp/` | Gemini provider (`ask-gemini-mcp`) |
| `packages/codex-mcp/` | Codex provider (`ask-codex-mcp`) |
| `packages/ollama-mcp/` | Ollama provider (`ask-ollama-mcp`) |
| `packages/llm-mcp/` | Orchestrator that auto-detects installed providers (`ask-llm-mcp`) |
| `packages/claude-plugin/` | Claude Code plugin — skills, agents, hooks, CLI binaries |
| `apps/docs/` | VitePress docs site |
| `docs/` | Internal project docs — `ROADMAP.md`, `DECISIONS.md`, `BUGS.md`, `plans/` |

See [`CLAUDE.md`](../CLAUDE.md) for the full architecture.

## Workflow

1. **Open an issue first.** Describe the bug or feature so we can agree on scope before code is written. Saves rework.
2. **Branch from `main`.** Forks aren't required.
3. **Run the checks.** Before pushing:
   ```bash
   yarn lint    # Biome + tsc --noEmit across all packages
   yarn test    # All workspaces (~199 unit tests)
   yarn build   # Sanity check the dependency-ordered build
   ```
4. **Add tests for new behavior.** New executor logic, parsers, or shared utilities should have unit tests next to the code (`__tests__/`). Integration tests that hit a real CLI go in `src/__tests__/integration.test.ts` and are gated behind `SMOKE_TEST=1`.
5. **Add an ADR for architectural changes.** Append a new entry to [`docs/DECISIONS.md`](DECISIONS.md) for changes that affect public API, the executor pattern, cross-package contracts, or distribution. Use the existing format: `## ADR-NNN: Title`, `Date`, `Status`, `Context`, `Decision`, `Consequences`. The historical ADRs are good models.
6. **Conventional commits.** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:` — see `git log` for in-house style. The release pipeline reads commit history.
7. **Update `docs/ROADMAP.md` and `docs/BUGS.md`** if your change resolves a tracked item.
8. **Add a changeset** if your change affects published packages. See "Versioning your change" below.

## Pre-push smoke tests

A Husky `pre-push` hook runs real smoke tests against your locally installed CLIs (Gemini, Codex, Ollama). Quota and rate-limit errors are treated as skip-with-warning so consecutive pushes don't sabotage each other (see [ADR-051](DECISIONS.md)). Force a hard fail with `FORCE_SMOKE=1 git push`. Skip entirely with `git push --no-verify` if needed.

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

You can pick "patch" for any package even if your change doesn't directly touch it, but in practice the internal-dependents cascade handles that automatically: bumping `@ask-llm/shared` cascades a patch bump to `ask-gemini-mcp`, `ask-codex-mcp`, `ask-ollama-mcp`, and `ask-llm-mcp` because they all depend on it. This is configured via `updateInternalDependents: "always"` in `.changeset/config.json` — without it, the `workspace:*` protocol would always satisfy the range and the cascade would silently skip. (`@ask-llm/shared` is published as a public npm package since ADR-106 — bundling was removed.)

`@ask-llm/plugin` is excluded from changesets (it's distributed via the Claude Code plugin marketplace, not npm; tracked in `.claude-plugin/marketplace.json`).

If your PR is infrastructure-only (no published behavior change), skip the changeset.

## Releases

Driven by [changesets/action](https://github.com/changesets/action) (ADR-076). The release flow has **two phases**, both kicked off automatically by pushes to `main`:

**Phase 1 — Version Packages PR**: when your PR with a changeset merges to `main`, the `release.yml` workflow runs, sees pending changesets, and opens (or updates) a `chore: version packages` PR. That PR bumps `package.json` versions, generates `CHANGELOG.md` entries, and deletes the consumed `.changeset/*.md` files. **You don't open this PR — the bot does.** Multiple changesets accumulate into one Version Packages PR until you're ready to ship.

**Phase 2 — Publish**: when the maintainer merges the Version Packages PR, `release.yml` runs again, this time detecting that the merge consumed changesets. It runs `yarn changeset:publish` which publishes every workspace package whose version is ahead of the npm registry via `yarn npm publish`. Yarn 4 automatically rewrites `workspace:*` references to the actual workspace version at publish time, so all 5 packages (`@ask-llm/shared`, `ask-gemini-mcp`, `ask-codex-mcp`, `ask-ollama-mcp`, `ask-llm-mcp`) land on npm with valid semver in their manifests. After npm, the workflow publishes to the MCP Registry and creates a unified GitHub Release tagged `v<gemini-version>` (legacy convention from when this was a fork of gemini-mcp-tool — preserved alongside the per-package tags changesets creates).

**Maintainer responsibilities** are minimal: review the Version Packages PR (does the CHANGELOG read sensibly? are the bump types right?), merge it when ready to ship. No manual `git tag` or `package.json` editing.

## Questions

Open a [GitHub discussion](https://github.com/Lykhoyda/ask-llm/discussions) or comment on an existing issue.
