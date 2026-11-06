# Dependency refresh audit

This document records the compatibility decisions from the repository-wide dependency refresh. It is intentionally limited to current state and blockers; historical upgrade decisions remain in `docs/DECISIONS.md`.

## Applied updates

All workspace manifests were audited and the lockfile was re-resolved recursively, not only for direct dependencies. `yarn dedupe --check` reports no remaining deduplication opportunity.

| Surface | Selected stable version |
| --- | --- |
| Yarn/Corepack package-manager pin | Yarn 4.18.1 |
| TypeScript / tsdown | TypeScript 7.0.2 / tsdown 0.22.14 (unchanged; current stable) |
| Oxfmt / Oxlint (replaced Biome 2.5.10) | 0.76.0 / 1.91.0 |
| Vitest / tsx | 4.1.12 / 4.23.12 |
| Changesets CLI / GitHub changelog | 3.0.1 / 1.0.0 |
| MCP TypeScript SDK | 1.32.0 |
| Zod / AJV | 4.6.7 / 8.20.0 |
| Pi compile-time SDK / exact CI hosts | 0.84.2 / 0.83.0 and 0.84.2 |
| Mermaid / VitePress | 11.17.0 / 1.6.4 |
| MCP Registry publisher | 1.8.1, with the Linux amd64 archive SHA-256 pinned in `release.yml` |

Vulnerable transitives resolve to fixed releases within their parents' declared ranges, including Hono 4.13.13, `@hono/node-server` 2.1.6, `body-parser` 2.4.0, `fast-uri` 3.1.9, `ip-address` 10.7.6, `lodash-es` 4.18.1, `nanoid` 3.3.20, `qs` 6.17.1, `tar` 7.5.22, Vue / `@vue/server-renderer` 3.5.45, Vitest's dev-server Vite 8.3.6, and `undici` 8.12.4 (the last via the root `resolutions` entry described below). The Oxc/Rolldown build chain resolves to `@oxc-project/types` 0.156.0 and Rolldown 1.2.16. Biome was later replaced by Oxfmt `^0.76.0` and Oxlint `^1.91.0` as the lint/format contract (with `tsc --noEmit` kept in every lint script); Oxfmt 0.77.0 and Oxlint 1.92.0 were still inside Yarn 4.18.1's default 24-hour `npmMinimalAgeGate` quarantine at migration time.

Non-major release evidence was also reviewed before updating: [MCP SDK 1.30.0](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.30.0), [Biome 2.5.10](https://github.com/biomejs/biome/releases/tag/%40biomejs%2Fbiome%402.5.10), [Mermaid 11.17.0](https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4011.17.0), [Zod 4.4](https://github.com/colinhacks/zod/releases/tag/v4.4.0), and [Pi 0.84.2](https://github.com/earendil-works/pi/releases/tag/v0.84.2). Biome's formatter/rule changes were applied to source instead of disabling new checks; MCP/Zod export and validation compatibility is covered by the complete build and test suite.

## Major-upgrade migrations reviewed

- Changesets CLI 3 removes Yarn Classic support, raises its own Node requirement to `^22.11 || ^24 || >=26`, and renames `changeset tag` to `changeset git-tag`. This repository uses Yarn 4, does not call `changeset tag`, and requires Node 24+ everywhere (ADR-171). Publish shells out to `yarn npm publish`; `release.yml` now uses Yarn OIDC with provenance (ADR-189), replacing the token mapping introduced by ADR-156 / issue #307. Sources: [CLI 3.0.0 release](https://github.com/changesets/changesets/releases/tag/%40changesets%2Fcli%403.0.0) and [GitHub changelog 1.0.0 release](https://github.com/changesets/changesets/releases/tag/%40changesets%2Fchangelog-github%401.0.0).
- `changesets/action` 2 renames its inputs, requires the token through `github-token`, uses the GitHub API for pushes by default, and creates package tags even when GitHub Releases are disabled unless `push-git-tags` is explicitly false. `release.yml` adopts the renamed inputs and sets `push-git-tags: false`, preserving ADR-151's single owner for immutable remote package tags. Source: [`changesets/action` 2.0.0 release](https://github.com/changesets/action/releases/tag/v2.0.0).
- GitHub's JavaScript actions moved to Node 24/ESM in their new majors. The workflows use only supported inputs; the `github-script` body uses the injected `github` and `context` values and does not `require("@actions/github")`, the v9-incompatible pattern. Sources: [checkout 7.0.0](https://github.com/actions/checkout/releases/tag/v7.0.0), [setup-node 7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0), [upload-artifact 7.0.0](https://github.com/actions/upload-artifact/releases/tag/v7.0.0), [download-artifact 8.0.0](https://github.com/actions/download-artifact/releases/tag/v8.0.0), [github-script v9 breaking changes](https://github.com/actions/github-script/releases/tag/v9.0.0), [upload-pages-artifact 5.0.0](https://github.com/actions/upload-pages-artifact/releases/tag/v5.0.0), and [deploy-pages 5.0.0](https://github.com/actions/deploy-pages/releases/tag/v5.0.0).

## Intentional pins and deferred upgrades

- **Every package requires Node `>=24.0.0`, the current LTS (ADR-171).** The packed-package matrix boots the provider and orchestrator CLIs on Node 24 and Node 26.
- **`@types/node` tracks the Node 24 line (24.13.6), not 26.2.0.** Compiling against Node 26 declarations would permit accidental use of APIs absent from the supported Node 24 runtime. The additional 26.2.0 lock entry is demanded transitively by protobufjs's broad `>=13.7.0` development type range and cannot be deduplicated with the repository compiler type line.
- **Pi 0.83.0 remains the published host floor while development uses Pi 0.84.2.** The `pi-package-smoke` matrix installs and asserts exact Pi 0.83.0 and 0.84.2 hosts in isolated per-cell HOME/config trees. The documented support floor must equal the oldest exact CI-exercised Pi pin; raising or removing that matrix leg requires an explicit support-range decision and matching documentation change.
- **The plugin compiles against TypeBox 1.3.7.** Pi 0.84.2 pins TypeBox 1.3.7 exactly in `pi-ai`, `pi-agent-core`, `pi-coding-agent`, and `pi-protocol`; matching the host-provided version prevents the plugin from compiling against APIs unavailable at runtime. TypeBox 1.3.18 was also inside Yarn 4's default 24-hour npm quarantine during this refresh. The host pin, not the quarantine alone, is the continuing blocker.
- **Pi 0.84.2's exact `undici` 8.9.0 pin is overridden to `^8.12.2`.** The root `package.json` resolution is scoped to `@earendil-works/pi-coding-agent@npm:0.84.2` only, stays within undici's major, and matches the undici 8.12.x line later Pi releases ship. Drop it when the Pi development dependency moves past 0.84.2.
- **Pi 0.84.2 also pins `glob` 13.0.6 and `minimatch` 10.2.5 exactly; `minimatch` 10.2.6 resolves from that glob's `^10.2.2` range.** Their advisories are fixed only in glob 14 / minimatch 11, so they stay open: overriding a host's exact pins across a major would compile and test against a dependency graph no Pi host runs. They reach Ask LLM only through the Pi development/peer host dependency.
- **KaTeX stays at 0.16.47.** Mermaid 11.17.0 (docs site only) requires `^0.16.47`, and the KaTeX advisory fix is outside that range; the alert stays open until Mermaid accepts a patched KaTeX line.
- **Verdaccio 6.10.0 and `wait-on` 9.1.0 are pinned in both registry jobs** (the Node 24/26 runtime smoke and the Pi package smoke).
- **VitePress 1.6.4 is the latest stable release.** It still requires Vite `^5.4.14`, leaving eight Vite advisories and the Vite 5 esbuild advisory in the development-only docs chain. VitePress 2 remains prerelease-only and is excluded by the no-prerelease requirement; forcing Vite 6/8 through VitePress 1's incompatible declared range would weaken peer and build guarantees. Track a VitePress 2 stable release before migrating. Sources: [VitePress releases](https://github.com/vuejs/vitepress/releases), [VitePress 1.6.4 package](https://github.com/vuejs/vitepress/blob/v1.6.4/package.json), and [VitePress issue 5073](https://github.com/vuejs/vitepress/issues/5073).
- **`get-tsconfig` 5.0.0-beta.5 remains as an upstream-forced development transitive.** tsdown 0.22.14 depends on `rolldown-plugin-dts` 0.27.14, which pins `get-tsconfig` exactly to `5.0.0-beta.5`; no workspace package declares it directly and no stable `get-tsconfig` 5 release exists. It is used only on the build host for declaration bundling and is not imported or shipped by an Ask LLM runtime package. Replacing it would require a stable `get-tsconfig` 5 release adopted by `rolldown-plugin-dts`.
- **`node-domexception` remains as a deprecated development transitive.** Current Pi 0.84.2 pins Google GenAI 1.52.0, whose current Google auth transport reaches `node-fetch` 3 and `node-domexception`. It is not imported or shipped by an Ask LLM runtime package, and no compatible direct upgrade exists above the current Pi release.
- **Six peer warnings remain in VitePress's fixed DocSearch chain.** `@docsearch/react` 3.8.2 and Algolia Autocomplete 1.17.7 omit intermediate peer declarations for Algolia clients/search insights even though the chain supplies its concrete clients. They are upstream manifest warnings, not missing Ask LLM peers; adding package extensions would only suppress the diagnostic. The docs build is the compatibility check.

`yarn npm audit --all --recursive` is expected to report only the documented Vite 5/esbuild, KaTeX, glob, and minimatch advisories plus deprecation-only notices for `node-domexception`, `@smithy/core`, and the `yuku-codegen`/`yuku-parser` platform bindings until those upstream blockers clear.
