# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Build/test: `yarn install --immutable`, then `yarn build` (topological — run it BEFORE `yarn test`; workspace tests resolve sibling packages from `dist/`, so unbuilt `@ask-llm/shared` fails every suite). Lint via `yarn lint` (biome format is enforced; `biome check --write` fixes).
- Architecture decisions live in `docs/DECISIONS.md` (numbered ADRs, newest prepended at the top); provider behavior differences are deliberate and cataloged in `docs/PROVIDER-PARITY.md` — read both before "aligning" providers.
- Docs-model drift is CI-enforced: `scripts/check-docs-drift.mjs` requires `apps/docs/.vitepress/theme/providers.ts` `defaultModel` (and gemini/antigravity `fallbackModel`) values to match each package's `constants.ts` literally, matched inside each provider's own object block. Change both together.
- Gemini quota fallback is `gemini-3.6-flash` (ADR-138); the antigravity fallback stays `gemini-3.5-flash` deliberately — agy slugs are evidence-pinned to its live catalog (ADR-137), so never bump both in sympathy.
- Provider default-model constants leak further than the provider package: `packages/llm-mcp/src/constants.ts` (`PROVIDERS.*.defaultModel`) is threaded into executors as `options.model` by `machine.ts`, so executors cannot use "was a model passed?" to detect user pins (see ADR-137).
- agy (Antigravity) CLI ground truth for this repo's executor is recorded in ADR-137: minimum supported version 1.1.5, base slug + separate `--effort`, hard conflict between `--effort` and effort-carrying model names, per-slug effort tiers, and the live-captured `invalid model selection` error grammar.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
