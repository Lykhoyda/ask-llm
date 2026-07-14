# Docs Site Overhaul: Terminal Noir Redesign

**Date:** 2026-07-13
**Status:** Approved (brainstormed with visual companion; direction A "Terminal Noir" selected)
**Scope:** `apps/docs/` VitePress site only. No changes to package code, tools, or plugin behavior.

## Context

The docs site has accumulated structural duplication and an unfocused provider story:

- `getting-started.md`, `installation.md`, and `first-steps.md` repeat the same prerequisites, install commands, and verify steps three times.
- Install snippets are copy-pasted in at least 9 places (homepage, both guide pages, all 6 provider pages), so every model or command change drifts.
- All 6 providers get equal visual weight, while the project now positions Claude and Codex as the hero pair (this branch adds `ask-claude-mcp`).
- Concepts are explained with static Mermaid diagrams; the user wants motion to carry the concepts.
- The current visual system mixes 3 card styles and hand-rolled SVG icons.

## Goals

1. Zero duplicated install/verify content: every command and model name has exactly one source.
2. Claude + Codex read as the heroes; Antigravity, Ollama, Gemini, Unified as supporting cast.
3. Core concepts (request flow, fan-out, fallback, sessions, review loop) are explained by animated SVG diagrams.
4. A coherent Terminal Noir visual language across every page, WCAG AA, reduced-motion safe.
5. No new runtime dependencies for the docs site.

## Non-Goals

- No light theme (force-dark stays).
- No changes to provider packages, tool schemas, or the plugin.
- No rewrite of troubleshooting/FAQ content beyond dedup and terminology sync.
- No motion library (no GSAP, no @vueuse/motion); CSS/SVG only.

## Design Language: Terminal Noir

Dials (design-taste-frontend): `DESIGN_VARIANCE 6 / MOTION_INTENSITY 6 / VISUAL_DENSITY 4`.

### Palette

| Token | Value | Role |
|---|---|---|
| `--noir-bg` | `#0a0b0c` | page background (never pure black) |
| `--noir-raised` | `#0e1012` | raised surfaces, code blocks, tab panels |
| `--noir-border` | `#1c2126` | hairline borders (replaces shadows) |
| `--noir-border-strong` | `#2a3138` | interactive borders, secondary buttons |
| `--noir-text` | `#e8eaed` | primary text |
| `--noir-text-2` | `#9aa3ab` | secondary text (passes AA on bg) |
| `--noir-text-3` | `#7d8590` | muted labels, command prompts (bumped from #565f68 during Task 2: ~3:1 failed the AA constraint; #7d8590 is ~5.2:1) |
| `--accent` | `#7ee787` | phosphor green: site accent AND Codex color |
| `--claude` | `#d97757` | Claude coral: used only in Claude contexts |

Color rules:

- One accent (phosphor green). It is deliberately shared with Codex: the palette itself encodes "green = Codex = default workhorse."
- Claude coral is the only second hue, used exclusively for Claude UI (cards, diagram nodes, labels).
- Supporting providers are monochrome gray chips/cards. No per-provider rainbow.
- No gradients, no glows, no pure `#000`/`#fff`.

### Typography

- **Geist Mono**: display headlines, section titles, labels, commands, diagram text.
- **Geist (sans)**: body prose, descriptions, docs content.
- Both already load via Google Fonts in `config.ts`; extend weights only if needed.

### Geometry and texture

- One radius: 4px everywhere (cards, buttons, tabs, code blocks).
- 1px hairline borders instead of shadows for elevation.
- Typographic glyphs (`▮`, `→`, `$`, `⇀`) replace all hand-rolled SVG icons. Existing inline SVG icon markup on the homepage is removed.
- No em-dashes anywhere in visible site copy.

## Information Architecture

### Page changes

| Before | After |
|---|---|
| `/getting-started` + `/installation` + `/first-steps` | One `/getting-started` (Quick Start): install provider CLI(s) → register MCP server → verify with ping/doctor |
| `/installation`, `/first-steps` | Redirect stubs (meta-refresh + canonical to new anchors; GitHub Pages has no server redirects) |
| All other URLs | Unchanged |

### Sidebar order

1. **Getting Started**: Overview, Quick Start
2. **Providers**: Codex, Claude, Antigravity, Ollama, Gemini, Unified (Codex/Claude first everywhere: nav, sidebar, cards, examples)
3. **Claude Plugin**: Overview, Skills, Hooks, Agents
4. **Core Concepts**: How It Works, Model Selection, Sandbox Mode
5. **User Guide**: How to Ask, Multi-Turn Sessions, Strategies & Examples
6. **Resources**: Troubleshooting, FAQ

### Single source of truth: `providers.ts`

New module in `.vitepress/theme/` exporting per-provider records (NOT named `providers.data.ts`: the `.data.ts` suffix is VitePress-reserved for build-time data loaders and breaks page imports; discovered in Task 5):

```ts
interface ProviderDoc {
  id: "codex" | "claude" | "antigravity" | "ollama" | "gemini" | "unified";
  name: string;            // display name
  pkg: string;             // npm package (e.g. "ask-codex-mcp")
  cliInstall: string;      // provider CLI install command
  mcpAdd: string;          // claude mcp add ... command
  jsonConfig: object;      // mcpServers JSON snippet
  defaultModel: string;    // e.g. "gpt-5.6-sol"
  fallbackModel?: string;  // e.g. "gpt-5.4-mini"
  status?: "enterprise" | "experimental" | "local";
  tier: "hero" | "supporting" | "unified";
  tools: string[];
}
```

Every card, chip, table, tab, and snippet on the site renders from this module. Verified current facts to seed it (from package constants on this branch):

- codex: default `gpt-5.6-sol`, package `ask-codex-mcp`
- claude: default `opus`, fallback `sonnet`, package `ask-claude-mcp`, read-only tool surface, positioned as the reverse path for Codex/non-Claude hosts
- Model names must be re-checked against `packages/*/src/constants.ts` at implementation time, and `scripts/check-docs-drift.mjs` extended to diff `providers.ts` against package constants in CI.

### Provider page template

Every provider page follows one structure (implemented as shared components + markdown):

1. Status strip: name, package, tier badge, default/fallback models
2. `<InstallSnippet provider="x" />` (client-tabbed install)
3. Tools table (from `providers.ts`)
4. Model & fallback section (with `<FallbackChain>` diagram where a fallback exists)
5. Provider-specific notes (free-form markdown)

## Homepage Composition

Section order (each a distinct layout family, per taste-skill section-repetition rules):

1. **Hero**: typed command `$ claude mcp add ask-llm -- npx -y ask-llm-mcp` with blinking cursor above the headline "Every diff deserves a second opinion." Subtext under 20 words. Two CTAs: Quick Start (primary, green) and Install Plugin (secondary, outline). Max 4 text elements.
2. **The review loop**: Claude and Codex hero cards flanking animated exchange arrows (`<PairLoop>`). Copy: "Claude and Codex review each other's work. The other model reads, your agent edits."
3. **Supporting providers**: single chip row "Also speaks: antigravity (agy) / ollama (local) / gemini (enterprise) / unified: all of them →".
4. **How a request flows**: `<RequestFlow>` animated diagram in a raised panel.
5. **Quick start tabs**: reworked `<SetupTabs>` (Claude Code / Codex CLI / Cursor / JSON config) driven by `providers.ts`.
6. **Explore grid**: compact links to concepts/guide pages (text links, not icon cards).

Removed from homepage: the 4-icon features grid (folds into Quick Start copy), duplicate install snippets, hand-rolled SVG icons.

## Motion System

Five scroll-triggered SVG diagram components. Shared mechanics:

- Inline SVG + CSS keyframes; line-draw via `stroke-dashoffset`; travel pulses via `offset-path` or transform keyframes.
- One shared `useInView` composable (IntersectionObserver, threshold ~0.4, fire once) adds an `.in-view` class that starts the animation.
- `@media (prefers-reduced-motion: reduce)`: animation is skipped entirely and the final frame (fully drawn diagram) renders statically.
- Diagram text uses Geist Mono at readable sizes; nodes use the palette tokens; `<title>`/`aria-label` on every SVG plus a text description below each diagram (the diagram is illustrative, never the sole carrier of information).

| Component | Animates | Placement |
|---|---|---|
| `PairLoop.vue` | Claude ⇄ Codex pulses exchanging along two arcs | Homepage section 2 |
| `RequestFlow.vue` | pulse travels agent → MCP server → provider CLI → returns; nodes light in sequence | Homepage section 4, `concepts/how-it-works` |
| `FanOut.vue` | one prompt splits into parallel beams to providers; responses return staggered; one beam can fail without the others | `providers/unified`, multi-llm docs |
| `FallbackChain.vue` | request hits primary model, quota error flashes, fallback node lights up and answers | `concepts/models`, codex/antigravity/claude provider pages |
| `SessionThread.vue` | successive calls attach to one session line; a cache-bypass branch when sessionId present | `usage/multi-turn-sessions` |

Mermaid stays available for low-traffic diagrams (troubleshooting flows); the five concept diagrams above replace their Mermaid equivalents.

Micro-motion (all CSS-only, reduced-motion gated): typed hero command, staggered `.in-view` card reveals (60ms cascade), `:active` press states (`translateY(1px)`), tab underline slide.

## Components

| Component | Fate |
|---|---|
| `SetupTabs.vue` | Rework: data from `providers.ts`, new visual system, per-client tabs |
| `InAction.vue` | Rework into the typed-command hero (or fold into `index.md` hero slot) |
| `DiagramModal.vue` | Keep for Mermaid zoom on remaining Mermaid diagrams; restyle tokens |
| `TroubleshootingModal.vue` | Keep, restyle tokens |
| New: `InstallSnippet.vue` | Per-provider install block used by Quick Start + all provider pages |
| New: `ProviderCard.vue` | Hero/supporting variants for homepage + overview |
| New: 5 diagram components | As above |
| New: `useInView.ts` | Shared IntersectionObserver composable |

CSS: rebuild `design-tokens.css` around the noir tokens; rewrite `custom.css` section by section (target: shrink from 871 lines by removing the 3 divergent card systems); override VitePress default theme variables (`--vp-c-*`) so docs content pages inherit the language without per-page CSS.

## Content Rules (applies to every rewritten page)

- Model names, packages, and commands come from `providers.ts` or are quoted from package constants; never hand-typed twice.
- Claude/Codex are the examples in all usage copy; other providers appear in provider-specific pages and one comparative mention each.
- Section headline + max 25-word sub-paragraph by default; no data-dump tables on landing surfaces.
- No em-dashes, no fake-precise numbers, no scroll cues, no decorative status dots, max 1 eyebrow per 3 sections.
- `llms.txt` / `llms-full.txt` regenerated to match the merged IA and new URLs.

## Accessibility

- WCAG AA contrast for all text tokens on their backgrounds (text-2 `#9aa3ab` on `#0a0b0c` ≈ 7.5:1; verify accent-on-dark for large text only).
- Full keyboard navigation: visible focus rings (green 1px outline + 2px offset), all interactive cards are real links/buttons.
- Reduced-motion: every animation gated; diagrams render final frame.
- SVG diagrams: `role="img"`, `aria-label`, adjacent prose explanation.

## Implementation Notes

- Build on the current `agent/add-claude-provider` branch state (it contains the Claude provider docs and GPT-5.6 defaults the content depends on). Docs overhaul commits stay separate from the existing uncommitted provider work.
- Extend `scripts/check-docs-drift.mjs` to validate `providers.ts` against `packages/*/src/constants.ts`.
- Redirect stubs: minimal `.md` pages with frontmatter layout rendering `<meta http-equiv="refresh">` + canonical link + visible fallback link.

## Verification

1. `yarn docs:build` clean; no dead links (VitePress build fails on broken internal links).
2. Browser pass on every page in both motion states (default + `prefers-reduced-motion: reduce` emulation).
3. Keyboard-only walk of homepage and Quick Start.
4. Contrast spot-check of all token pairs.
5. Drift check: extended `check-docs-drift.mjs` passes.
6. `llms.txt` matches the shipped sitemap.

## Risks

- **Old URLs in the wild**: `/installation` and `/first-steps` are linked from npm READMEs and search results. Mitigated by redirect stubs + canonical tags; verify stubs render correctly on GitHub Pages base path `/ask-llm/`.
- **Model-name churn**: defaults change often (gpt-5.5 → gpt-5.6-sol this branch). Mitigated by the drift-check extension; docs quote constants, not memory.
- **Search index**: local search re-indexes at build; merged pages change anchor targets. Verify top queries (install, codex, claude) still land sensibly.
