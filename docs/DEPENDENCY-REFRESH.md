# Dependency refresh audit

This document records the compatibility decisions from the repository-wide dependency refresh. It is intentionally limited to current state and blockers; historical upgrade decisions remain in `docs/DECISIONS.md`.

## Applied updates

All workspace manifests were audited and the lockfile was re-resolved recursively, not only for direct dependencies. `yarn dedupe --check` reports no remaining deduplication opportunity.

| Surface | Selected stable version |
| --- | --- |
| Yarn/Corepack package-manager pin | Yarn 4.18.0 (unchanged; current stable) |
| TypeScript / tsdown | TypeScript 7.0.2 / tsdown 0.22.14 (unchanged; current stable) |
| Biome | 2.5.10 |
| Vitest / tsx | 4.1.11 / 4.23.12 |
| Changesets CLI / GitHub changelog | 3.0.1 / 1.0.0 |
| MCP TypeScript SDK | 1.30.0 |
| Zod / AJV | 4.4.3 / 8.20.0 |
| Pi SDK and test host | 0.84.2; documented minimum Pi host raised from 0.83.0 to 0.84.2 to match the compile-time SDK and the CI Pi package smoke |
| Mermaid / VitePress | 11.17.0 / 1.6.4 |
| MCP Registry publisher | 1.8.1, with the Linux amd64 archive SHA-256 pinned in `release.yml` |

The recursive lock refresh also moves vulnerable runtime transitives to fixed releases, including Hono 4.13.3, `@hono/node-server` 2.1.1, `body-parser` 2.3.0, `fast-uri` 3.1.6, `ip-address` 10.5.0, `lodash-es` 4.18.1, `nanoid` 3.3.18, `qs` 6.15.3, `tar` 7.5.22, and `undici` 8.9.0/8.10.0. The Oxc/Rolldown build chain resolves to `@oxc-project/types` 0.146.0 and Rolldown 1.2.5. Oxlint and Oxfmt are not repository tools: Biome remains the established lint/format contract, so adding parallel linters or formatters would be a migration rather than a dependency refresh.

Non-major release evidence was also reviewed before updating: [MCP SDK 1.30.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.30.0), [Biome 2.5.10](https://github.com/biomejs/biome/releases/tag/%40biomejs%2Fbiome%402.5.10), [Mermaid 11.17.0](https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4011.17.0), [Zod 4.4](https://github.com/colinhacks/zod/releases/tag/v4.4.0), and [Pi 0.84.2](https://github.com/earendil-works/pi/releases/tag/v0.84.2). Biome's formatter/rule changes were applied to source instead of disabling new checks; MCP/Zod export and validation compatibility is covered by the complete build and test suite.

## Major-upgrade migrations reviewed

- Changesets CLI 3 removes Yarn Classic support, raises its own Node requirement to `^22.11 || ^24 || >=26`, and renames `changeset tag` to `changeset git-tag`. This repository uses Yarn 4, does not call `changeset tag`, and already requires Node 22.18+ for its build toolchain while retaining Node 20 for published runtime artifacts. Sources: [CLI 3.0.0 release](https://github.com/changesets/changesets/releases/tag/%40changesets%2Fcli%403.0.0) and [GitHub changelog 1.0.0 release](https://github.com/changesets/changesets/releases/tag/%40changesets%2Fchangelog-github%401.0.0).
- `changesets/action` 2 renames its inputs, requires the token through `github-token`, uses the GitHub API for pushes by default, and creates package tags even when GitHub Releases are disabled unless `push-git-tags` is explicitly false. `release.yml` adopts the renamed inputs and sets `push-git-tags: false`, preserving ADR-151's single owner for immutable remote package tags. Source: [`changesets/action` 2.0.0 release](https://github.com/changesets/action/releases/tag/v2.0.0).
- GitHub's JavaScript actions moved to Node 24/ESM in their new majors. The workflows use only supported inputs; the `github-script` body uses the injected `github` and `context` values and does not `require("@actions/github")`, the v9-incompatible pattern. Sources: [checkout 7.0.0](https://github.com/actions/checkout/releases/tag/v7.0.0), [setup-node 7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0), [upload-artifact 7.0.0](https://github.com/actions/upload-artifact/releases/tag/v7.0.0), [download-artifact 8.0.0](https://github.com/actions/download-artifact/releases/tag/v8.0.0), [github-script v9 breaking changes](https://github.com/actions/github-script/releases/tag/v9.0.0), [upload-pages-artifact 5.0.0](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0), and [deploy-pages 5.0.0](https://github.com/actions/deploy-pages/releases/tag/v5.0.0).

## Intentional pins and deferred upgrades

- **Published Node support remains `>=20.0.0`.** Build, test, docs, and release jobs run on Node 22/24 because tsdown and Changesets 3 require newer build hosts. The packed-package matrix still boots every public CLI on Node 20 and Node 26. This separates development-tool engines from the published runtime contract rather than raising the runtime floor.
- **`@types/node` stays on the latest Node 22 line (22.20.1), not 26.2.0.** Compiling against Node 26 declarations would permit accidental use of APIs absent from supported Node 20 runtimes. The additional 26.2.0 lock entry is demanded transitively by protobufjs's broad `>=13.7.0` development type range and cannot be deduplicated with the repository compiler type line.
- **The plugin compiles against TypeBox 1.3.7.** Pi 0.84.2 pins TypeBox 1.3.7 exactly in `pi-ai`, `pi-agent-core`, `pi-coding-agent`, and `pi-protocol`; matching the host-provided version prevents the plugin from compiling against APIs unavailable at runtime. TypeBox 1.3.18 was also inside Yarn 4's default 24-hour npm quarantine during this refresh. The host pin, not the quarantine alone, is the continuing blocker.
- **Verdaccio is split by job.** The Node 20/26 runtime smoke matrix pins 6.8.0, the newest Verdaccio release supporting Node 20; Verdaccio 6.9+ requires Node 22. The Node 24 Pi package smoke uses current 6.10.0. `wait-on` is pinned to current 9.1.0 in both jobs.
- **VitePress 1.6.4 is the latest stable release.** It still requires Vite `^5.4.14`, leaving three Vite advisories and the Vite 5 esbuild advisory in the development-only docs chain. VitePress 2 remains prerelease-only and is excluded by the no-prerelease requirement; forcing Vite 6/8 through VitePress 1's incompatible declared range would weaken peer and build guarantees. Track a VitePress 2 stable release before migrating. Sources: [VitePress releases](https://github.com/vuejs/vitepress/releases), [VitePress 1.6.4 package](https://github.com/vuejs/vitepress/blob/v1.6.4/package.json), and [VitePress issue 5073](https://github.com/vuejs/vitepress/issues/5073).
- **`node-domexception` remains as a deprecated development transitive.** Current Pi 0.84.2 pins Google GenAI 1.52.0, whose current Google auth transport reaches `node-fetch` 3 and `node-domexception`. It is not imported or shipped by an Ask LLM runtime package, and no compatible direct upgrade exists above the current Pi release.
- **Six peer warnings remain in VitePress's fixed DocSearch chain.** `@docsearch/react` 3.8.2 and Algolia Autocomplete 1.17.7 omit intermediate peer declarations for Algolia clients/search insights even though the chain supplies its concrete clients. They are upstream manifest warnings, not missing Ask LLM peers; adding package extensions would only suppress the diagnostic. The docs build is the compatibility check.

`yarn npm audit --all --recursive` is expected to report only the four documented Vite/Vite-esbuild advisories plus the `node-domexception` deprecation until those upstream blockers clear.
