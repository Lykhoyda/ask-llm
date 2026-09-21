# Keeping versions updated

## Published packages

Changesets, then the bot's Version Packages PR, then Release. How to add a changeset, when shared must bump every MCP, and what merging `chore: version packages` publishes: [CONTRIBUTING](CONTRIBUTING.md) ("Versioning your change" and "Releases"). Recovery dispatch, package tags, and Yarn publish auth: [AGENTS.md](../AGENTS.md) and [DECISIONS.md](DECISIONS.md) (ADR-076, ADR-151/152, ADR-156–158).

## Default and fallback models

Pins live in each provider's `packages/<name>-mcp/src/constants.ts`. `packages/llm-mcp/src/constants.ts` threads those defaults into executors. Docs must quote the same strings in `apps/docs/.vitepress/theme/providers.ts`; `yarn lint` runs `scripts/check-docs-drift.mjs` and fails if they drift. Change both together. Agent-facing summary: [AGENTS.md](../AGENTS.md).

## Model-version watch

[`.github/routines/model-version-watch.md`](../.github/routines/model-version-watch.md) is the complete spec (that path is CI-enforced). Read-only: comments on the rolling tracker, or one issue per finding. A human opens the PR. Overview: [ROUTINES.md](ROUTINES.md). The Friday CLI-drift tracker in the same file owns flag/output/auth drift, not model ids.

## Provider CLI and host floors

- **agy:** `MINIMUM_AGY_VERSION` and the 1.1.9 / 1.1.28 gates live in `packages/antigravity-mcp/src/constants.ts`. Ground truth: ADR-137, ADR-141, ADR-162 in [DECISIONS.md](DECISIONS.md). Bump only with agy-native evidence; do not move Gemini and Antigravity pins together.
- **Pi:** published host floor must equal the oldest exact `pi-package-smoke` matrix pin. [AGENTS.md](../AGENTS.md), [PI-COMPATIBILITY.md](PI-COMPATIBILITY.md).
- **Grok Build:** large prompts require `--prompt-file` advertised in `grok --help` (1.0.5+).
- **Codex Astra:** `gpt-6-astra` requires Codex CLI >= 0.153.0 (`ASTRA_MIN_CODEX_VERSION` in `packages/codex-mcp/src/constants.ts`). The executor probes `codex --version` only for that slug; Sol/Terra stay ungated. Ground truth: ADR-163.
- Other CLIs have no additional hard `MINIMUM_*` here; the Friday routine in [ROUTINES.md](ROUTINES.md) watches their releases.

Harness-facing pin changes still use `yarn prepr:harness` — [HARNESS-SMOKE.md](HARNESS-SMOKE.md). That gate does not bump versions.

## npm and GitHub Actions

There is no Dependabot (or Renovate) config. Workspace deps move in maintainer PRs. The last repo-wide audit snapshot is [DEPENDENCY-REFRESH.md](DEPENDENCY-REFRESH.md). Compiler/Yarn floors are enforced by `scripts/typescript-contract.test.ts`. GitHub Actions and `mcp-publisher` are SHA/checksum pinned in `.github/workflows/` (`scripts/check-workflow-security.mjs`).
