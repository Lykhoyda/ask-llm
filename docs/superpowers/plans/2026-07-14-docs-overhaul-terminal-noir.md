# Terminal Noir Docs Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `apps/docs/` VitePress site in the approved Terminal Noir design language with zero duplicated install content, Claude+Codex hero positioning, and five animated SVG concept diagrams.

**Architecture:** A `providers.data.ts` module becomes the single source of truth for every provider fact; new scoped-style Vue components (hero, review loop, install snippets, diagrams) replace copy-pasted markdown and hand-rolled icons; `design-tokens.css` is rewritten around the noir palette so VitePress content pages inherit the language; three onboarding pages merge into one Quick Start with meta-refresh redirect stubs.

**Tech Stack:** VitePress 1.x, Vue 3 SFCs (scoped CSS), CSS keyframes + IntersectionObserver (no animation libraries), Node scripts for drift checks.

**Spec:** `docs/superpowers/specs/2026-07-13-docs-overhaul-design.md` (approved). Read it before starting any task.

## Global Constraints

- Work on the current `agent/add-claude-provider` branch. Commit only files this plan names; the branch has unrelated uncommitted work that must not be swept into commits.
- No new npm dependencies anywhere.
- Force-dark stays (`appearance: "force-dark"` in config.ts is untouched).
- Palette tokens exactly as specified: bg `#0a0b0c`, raised `#0e1012`, border `#1c2126`, border-strong `#2a3138`, text `#e8eaed`, text-2 `#9aa3ab`, text-3 `#7d8590`, accent `#7ee787`, claude `#d97757`. One radius: 4px. No gradients, no glows, no pure `#000`/`#fff`.
- Phosphor green `#7ee787` is BOTH the site accent AND Codex's color. Claude coral `#d97757` appears only in Claude contexts. Antigravity/Ollama/Gemini render monochrome.
- No em-dash characters anywhere in visible site copy (use commas, colons, periods).
- Model names, package names, and install commands in page content come ONLY from `providers.data.ts` or verbatim quotes of `packages/*/src/constants.ts`. Never hand-typed twice. Current verified values: codex `gpt-5.6-sol`→`gpt-5.6-terra`, claude `opus`→`sonnet`, antigravity `Gemini 3.1 Pro (High)`→`Gemini 3.5 Flash (High)`, gemini `gemini-3.1-pro-preview`→`gemini-3.5-flash`, ollama `qwen3.6:27b` (no fallback).
- Every animation is gated behind `@media (prefers-reduced-motion: reduce)` (CSS) or a `matchMedia` check (JS), degrading to the final static frame.
- Typographic glyphs (`▮`, `→`, `$`, `⇀`, `↽`) instead of SVG icons. No hand-rolled icon paths.
- All internal links use the `/ask-llm/` base path convention VitePress applies automatically (write root-relative `/getting-started` style links in markdown; hardcode `/ask-llm/` only in raw HTML `href`s, matching current `index.md` practice).
- WCAG AA: body text tokens on their backgrounds; visible focus outlines (`1px solid #7ee787`, `outline-offset: 2px`) on all interactive elements.
- After the final task, update `docs/ROADMAP.md` (dated run entry) and `docs/DECISIONS.md` (ADR for the docs redesign), per repo workflow.

**Verification commands used throughout** (docs app has no unit-test runner; these are the test cycle):

- `yarn docs:build` from repo root: fails on dead internal links and Vue compile errors.
- `node scripts/check-docs-drift.mjs`: package/provider coverage plus the model-drift check added in Task 1.
- `yarn lint`: Biome + tsc across workspaces (covers `.vitepress/**/*.ts`).

---

### Task 1: `providers.data.ts` single source of truth + drift-check extension

**Files:**
- Create: `apps/docs/.vitepress/theme/providers.data.ts`
- Modify: `scripts/check-docs-drift.mjs`

**Interfaces:**
- Produces: `ProviderDoc` interface; `PROVIDER_DOCS: Record<ProviderId, ProviderDoc>`; `HERO_IDS`, `SUPPORTING_IDS` arrays; helper `providerList(): ProviderDoc[]`. Consumed by every component task (2, 5, 6, 7) and page tasks.

- [ ] **Step 1: Create the data module**

```ts
// apps/docs/.vitepress/theme/providers.data.ts
// Single source of truth for provider facts shown anywhere on the docs site.
// Values are drift-checked against packages/*/src/constants.ts by
// scripts/check-docs-drift.mjs. Update BOTH when a default model changes.

export type ProviderId =
  | "codex"
  | "claude"
  | "antigravity"
  | "ollama"
  | "gemini"
  | "unified";

export interface ProviderDoc {
  id: ProviderId;
  name: string;
  pkg: string;
  serverName: string;
  cliInstall: string;
  defaultModel: string;
  fallbackModel?: string;
  status?: "enterprise" | "experimental" | "local";
  tier: "hero" | "supporting" | "unified";
  tagline: string;
  tools: string[];
  docPath: string;
}

export const PROVIDER_DOCS: Record<ProviderId, ProviderDoc> = {
  codex: {
    id: "codex",
    name: "Codex",
    pkg: "ask-codex-mcp",
    serverName: "codex",
    cliInstall: "npm install -g @openai/codex",
    defaultModel: "gpt-5.6-sol",
    fallbackModel: "gpt-5.6-terra",
    tier: "hero",
    tagline: "GPT-5.6 workhorse reviewer. Strongest code reasoning for targeted reviews and architecture critique.",
    tools: ["ask-codex", "ask-codex-edit", "get-usage-stats", "ping"],
    docPath: "/providers/codex",
  },
  claude: {
    id: "claude",
    name: "Claude",
    pkg: "ask-claude-mcp",
    serverName: "claude",
    cliInstall: "npm install -g @anthropic-ai/claude-code",
    defaultModel: "opus",
    fallbackModel: "sonnet",
    tier: "hero",
    tagline: "Opus-powered read-only reviewer for Codex CLI and other non-Claude hosts. The reverse path.",
    tools: ["ask-claude", "get-usage-stats", "ping"],
    docPath: "/providers/claude",
  },
  antigravity: {
    id: "antigravity",
    name: "Antigravity",
    pkg: "ask-antigravity-mcp",
    serverName: "antigravity",
    cliInstall: "# install agy from https://antigravity.google, then log in once",
    defaultModel: "Gemini 3.1 Pro (High)",
    fallbackModel: "Gemini 3.5 Flash (High)",
    status: "experimental",
    tier: "supporting",
    tagline: "Subscription-backed second opinion via Google AI Pro/Ultra (agy).",
    tools: ["ask-antigravity", "get-usage-stats", "ping"],
    docPath: "/providers/antigravity",
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    pkg: "ask-ollama-mcp",
    serverName: "ollama",
    cliInstall: "# install from https://ollama.com, then: ollama pull qwen3.6:27b",
    defaultModel: "qwen3.6:27b",
    status: "local",
    tier: "supporting",
    tagline: "Local models. No API keys, fully private, zero cost.",
    tools: ["ask-ollama", "get-usage-stats", "ping"],
    docPath: "/providers/ollama",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    pkg: "ask-gemini-mcp",
    serverName: "gemini",
    cliInstall: "npm install -g @google/gemini-cli && gemini login",
    defaultModel: "gemini-3.1-pro-preview",
    fallbackModel: "gemini-3.5-flash",
    status: "enterprise",
    tier: "supporting",
    tagline: "1M+ token context for whole-codebase reads. Enterprise seats only since 2026-06-18.",
    tools: ["ask-gemini", "ask-gemini-edit", "fetch-chunk", "get-usage-stats", "ping"],
    docPath: "/providers/gemini",
  },
  unified: {
    id: "unified",
    name: "Unified",
    pkg: "ask-llm-mcp",
    serverName: "ask-llm",
    cliInstall: "# no extra CLI: auto-detects the provider CLIs you already have",
    defaultModel: "per provider",
    tier: "unified",
    tagline: "All providers in one server. Auto-detects installed CLIs, routes each request, or fans one prompt out to several.",
    tools: ["ask-llm", "multi-llm", "get-usage-stats", "diagnose", "ping"],
    docPath: "/providers/unified",
  },
};

export const HERO_IDS: ProviderId[] = ["claude", "codex"];
export const SUPPORTING_IDS: ProviderId[] = ["antigravity", "ollama", "gemini"];

export function providerList(): ProviderDoc[] {
  return Object.values(PROVIDER_DOCS);
}
```

- [ ] **Step 2: Extend the drift check to fail on model drift**

Append to `scripts/check-docs-drift.mjs`, immediately BEFORE the `if (errors.length > 0)` block:

```js
// providers.data.ts must quote the same default/fallback models as package constants.
const dataSource = readFileSync(
  join(root, "apps/docs/.vitepress/theme/providers.data.ts"),
  "utf8",
);
const modelChecks = [
  ["codex", "packages/codex-mcp/src/constants.ts", /FACTORY_DEFAULT_MODEL = "([^"]+)"/],
  ["claude", "packages/claude-mcp/src/constants.ts", /FACTORY_DEFAULT_MODEL = "([^"]+)"/],
  ["gemini", "packages/gemini-mcp/src/constants.ts", /FACTORY_DEFAULT_MODEL = "([^"]+)"/],
  ["ollama", "packages/ollama-mcp/src/constants.ts", /FACTORY_DEFAULT_MODEL = "([^"]+)"/],
  ["antigravity", "packages/antigravity-mcp/src/constants.ts", /DEFAULT: "([^"]+)"/],
];
for (const [provider, constantsPath, pattern] of modelChecks) {
  const constant = readFileSync(join(root, constantsPath), "utf8").match(pattern)?.[1];
  if (!constant) {
    errors.push(`${constantsPath} no longer matches the default-model pattern for ${provider}`);
    continue;
  }
  if (!dataSource.includes(`defaultModel: "${constant}"`)) {
    errors.push(
      `providers.data.ts defaultModel for ${provider} is out of sync with ${constantsPath} (expected "${constant}")`,
    );
  }
}
```

- [ ] **Step 3: Verify the drift check passes, then prove it catches drift**

Run: `node scripts/check-docs-drift.mjs`
Expected: `Documentation drift checks passed (...)`.

Then temporarily change `defaultModel: "gpt-5.6-sol"` to `"gpt-5.5"` in `providers.data.ts`, re-run, expect a failing exit with the sync error, and revert the temporary change.

- [ ] **Step 4: Lint and commit**

```bash
yarn lint
git add apps/docs/.vitepress/theme/providers.data.ts scripts/check-docs-drift.mjs
git commit -m "docs(theme): add providers.data.ts single source of truth with model drift guard"
```

---

### Task 2: Noir design tokens + global CSS rebase

**Files:**
- Modify: `apps/docs/.vitepress/theme/design-tokens.css` (full rewrite)
- Modify: `apps/docs/.vitepress/theme/custom.css` (global sections only; homepage-specific card CSS is DELETED here and replaced by scoped component styles in Tasks 5-7)
- Modify: `apps/docs/.vitepress/config.ts:45` (add Geist Mono 700 to the font URL)

**Interfaces:**
- Produces: CSS custom properties `--noir-bg`, `--noir-raised`, `--noir-border`, `--noir-border-strong`, `--noir-text`, `--noir-text-2`, `--noir-text-3`, `--accent`, `--claude`, `--radius`, `--font-mono`, `--font-sans`. Every later component consumes these names exactly.

- [ ] **Step 1: Rewrite `design-tokens.css`**

Replace the whole file:

```css
/* ================================================================
   Ask LLM: Terminal Noir token system
   Dark-only, monospace-led, phosphor accent.
   Spec: docs/superpowers/specs/2026-07-13-docs-overhaul-design.md
   ================================================================ */

:root {
  /* Surfaces */
  --noir-bg: #0a0b0c;
  --noir-raised: #0e1012;
  --noir-border: #1c2126;
  --noir-border-strong: #2a3138;

  /* Text */
  --noir-text: #e8eaed;
  --noir-text-2: #9aa3ab;
  --noir-text-3: #7d8590;

  /* Accent: phosphor green, shared by the site brand and Codex */
  --accent: #7ee787;
  --accent-dim: #56c76a;
  --accent-tint: rgba(126, 231, 135, 0.06);
  /* Claude coral: used only in Claude contexts */
  --claude: #d97757;
  --claude-tint: rgba(217, 119, 87, 0.06);

  /* Status */
  --color-error: #f87171;

  /* Geometry: one radius everywhere */
  --radius: 4px;

  /* Typography */
  --font-sans: "Geist", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono: "Geist Mono", "SF Mono", Monaco, "Cascadia Code", ui-monospace, monospace;

  /* Spacing (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;

  /* VitePress remaps: content pages inherit the language from these */
  --vp-c-brand-1: var(--accent);
  --vp-c-brand-2: var(--accent-dim);
  --vp-c-brand-3: var(--accent-dim);
  --vp-c-brand-soft: var(--accent-tint);

  --vp-c-bg: var(--noir-bg);
  --vp-c-bg-soft: var(--noir-raised);
  --vp-c-bg-mute: var(--noir-raised);
  --vp-c-bg-alt: var(--noir-bg);

  --vp-c-text-1: var(--noir-text);
  --vp-c-text-2: var(--noir-text-2);
  --vp-c-text-3: var(--noir-text-3);

  --vp-c-divider: var(--noir-border);
  --vp-c-divider-light: var(--noir-border);

  --vp-font-family-base: var(--font-sans);
  --vp-font-family-mono: var(--font-mono);

  --vp-code-block-bg: var(--noir-raised);
  --vp-border-radius: var(--radius);

  --vp-c-default-1: var(--noir-text);
  --vp-c-default-2: var(--noir-text-2);
  --vp-c-default-3: var(--noir-text-3);
  --vp-c-default-soft: var(--noir-raised);

  --vp-button-brand-bg: var(--accent);
  --vp-button-brand-hover-bg: var(--accent-dim);
  --vp-button-brand-active-bg: var(--accent-dim);
  --vp-button-brand-border: transparent;
  --vp-button-brand-hover-border: transparent;
  --vp-button-brand-text: var(--noir-bg);

  --vp-button-alt-bg: transparent;
  --vp-button-alt-hover-bg: var(--noir-raised);
  --vp-button-alt-border: var(--noir-border-strong);
  --vp-button-alt-hover-border: var(--accent);
  --vp-button-alt-text: var(--noir-text);
}
```

Note the deliberate deletions: all `--color-brand*` indigo tokens, all per-provider glow tokens, `--corner-size*`. Task 2 Step 2 removes their consumers.

- [ ] **Step 2: Rebase `custom.css`**

Rewrite `custom.css` keeping ONLY these concerns, each expressed with the new tokens (use the current file's selectors as the map of what VitePress needs overridden; the section header comments at custom.css:8-855 list them):

1. Base: body background/color, `::selection` (accent tint).
2. Navigation: solid `--noir-bg` bar, 1px `--noir-border` bottom, mono site title prefixed with a green `▮` via `.VPNavBarTitle .title::before { content: "▮ "; color: var(--accent); }`.
3. Sidebar: mono section headers (11px, uppercase, `--noir-text-3`), active item accent text + 2px left accent border.
4. Typography: h1-h3 in `--font-mono` with `letter-spacing: -0.02em`; body in `--font-sans`.
5. Inline code, tables, info boxes, details/summary, links, scrollbar, Mermaid container, footer: restyle with noir tokens, radius 4px, hairline borders, no shadows.
6. Focus visible: `a:focus-visible, button:focus-visible { outline: 1px solid var(--accent); outline-offset: 2px; }`.
7. Motion primitives used by later tasks:

```css
/* Scroll-reveal primitive: components add .reveal, useInView adds .in-view */
.reveal {
  opacity: 0;
  transform: translateY(12px);
  transition: opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal.in-view {
  opacity: 1;
  transform: none;
}
@media (prefers-reduced-motion: reduce) {
  .reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }
}

/* Shared shell for all animated diagram figures (components add only
   their own node/wire/keyframe rules in scoped styles) */
.noir-diagram {
  margin: var(--space-6) 0;
  padding: var(--space-6);
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  background: var(--noir-raised);
}
.noir-diagram svg {
  width: 100%;
  height: auto;
  display: block;
}
.noir-diagram figcaption {
  margin-top: var(--space-3);
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--noir-text-3);
}
```

DELETE outright: hero glow backgrounds, gradient hero text, `.feature-card`, `.provider-card`, `.next-step-card`, `.provider-grid`, `.features-grid`, `.next-steps-grid`, per-provider hover glows, anti-grid corner clip-paths, terminal CTA styles. (Their replacements are scoped inside new components; the homepage markdown that references the old classes is rewritten in Task 7, so expect the homepage to look broken until then. Content pages must look correct after this task.)

- [ ] **Step 3: Add Geist Mono 700 to the font link**

In `apps/docs/.vitepress/config.ts` change the Google Fonts href to:

```
https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500;600;700&display=swap
```

- [ ] **Step 4: Build and eyeball content pages**

Run: `yarn docs:build`
Expected: clean build.
Run: `yarn docs:dev`, open `/providers/codex` and `/concepts/how-it-works`: mono headings, noir surfaces, accent links, no indigo remnants. Homepage is allowed to look broken at this point.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/.vitepress/theme/design-tokens.css apps/docs/.vitepress/theme/custom.css apps/docs/.vitepress/config.ts
git commit -m "docs(theme): rebuild token system and global CSS for Terminal Noir"
```

---

### Task 3: `useInView` composable

**Files:**
- Create: `apps/docs/.vitepress/theme/useInView.ts`

**Interfaces:**
- Produces: `useInView(target: Ref<Element | null>, threshold?: number): Ref<boolean>`; fires once, disconnects after intersection; returns `true` immediately when IntersectionObserver is unavailable (SSR/build) or `prefers-reduced-motion` is set. Consumed by all diagram components and reveal wrappers.

- [ ] **Step 1: Write the composable**

```ts
// apps/docs/.vitepress/theme/useInView.ts
import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/**
 * One-shot viewport visibility. Flips to true the first time `target`
 * intersects, then disconnects. Under prefers-reduced-motion (or when
 * IntersectionObserver is unavailable, e.g. SSR) it is true immediately
 * so diagrams render their final frame.
 */
export function useInView(
  target: Ref<Element | null>,
  threshold = 0.4,
): Ref<boolean> {
  const inView = ref(false);
  let observer: IntersectionObserver | undefined;

  onMounted(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduced || typeof IntersectionObserver === "undefined" || !target.value) {
      inView.value = true;
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          inView.value = true;
          observer?.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(target.value);
  });

  onBeforeUnmount(() => observer?.disconnect());
  return inView;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `yarn lint` (tsc covers `.vitepress`) and `yarn docs:build`.
Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/docs/.vitepress/theme/useInView.ts
git commit -m "docs(theme): add one-shot useInView composable with reduced-motion fallback"
```

---

### Task 4: Diagram components, part 1: `RequestFlow.vue` + `PairLoop.vue`

**Files:**
- Create: `apps/docs/.vitepress/components/diagrams/RequestFlow.vue`
- Create: `apps/docs/.vitepress/components/diagrams/PairLoop.vue`
- Modify: `apps/docs/.vitepress/theme/index.ts` (register both)

**Interfaces:**
- Consumes: `useInView` from Task 3, tokens from Task 2.
- Produces: global components `<RequestFlow />` and `<PairLoop />`, no props. Registered names are used verbatim in markdown by Tasks 7, 9, 10.

Shared diagram conventions (all diagram components in this plan follow them):
- Root `<figure class="noir-diagram" ref="root">` with `useInView(root)` toggling class `run` on an inner `<svg role="img" :aria-label="...">`. The figure/svg/figcaption chrome is styled by the global `.noir-diagram` rules added to `custom.css` in Task 2; scoped styles contain ONLY the component's own node/wire/pulse/keyframe rules.
- Animations are CSS keyframes scoped in the SFC, all selectors under `.run` so nothing moves until in view; a `@media (prefers-reduced-motion: reduce)` block forces every animated element to its final state (the composable also short-circuits, this is belt and braces).
- `<figcaption>` carries a one-sentence prose explanation so the SVG is never the sole carrier of meaning.

- [ ] **Step 1: Write `RequestFlow.vue`**

```vue
<template>
  <figure ref="root" class="noir-diagram">
    <svg
      viewBox="0 0 640 120"
      role="img"
      aria-label="Diagram: a request travels from your agent to the MCP server to the provider CLI, and the response returns along the same path."
      :class="{ run: inView }"
    >
      <g class="node n1">
        <rect x="8" y="38" width="150" height="44" rx="4" />
        <text x="83" y="64">your agent</text>
      </g>
      <g class="node n2">
        <rect x="245" y="38" width="150" height="44" rx="4" />
        <text x="320" y="64">mcp server</text>
      </g>
      <g class="node n3 hot">
        <rect x="482" y="38" width="150" height="44" rx="4" />
        <text x="557" y="64">provider cli</text>
      </g>
      <line class="wire" x1="158" y1="52" x2="245" y2="52" />
      <line class="wire" x1="395" y1="52" x2="482" y2="52" />
      <line class="wire ret" x1="482" y1="68" x2="395" y2="68" />
      <line class="wire ret" x1="245" y1="68" x2="158" y2="68" />
      <circle class="pulse out1" cy="52" r="4" />
      <circle class="pulse out2" cy="52" r="4" />
      <circle class="pulse ret1" cy="68" r="4" />
      <circle class="pulse ret2" cy="68" r="4" />
    </svg>
    <figcaption>
      Your agent calls an MCP tool; the server spawns the provider CLI and
      streams the answer back as structured content.
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useInView } from "../../theme/useInView";

const root = ref<Element | null>(null);
const inView = useInView(root);
</script>

<style scoped>
/* figure/svg/figcaption chrome comes from the global .noir-diagram rules (custom.css) */
.node rect {
  fill: transparent;
  stroke: var(--noir-border-strong);
}
.node text {
  fill: var(--noir-text);
  font-family: var(--font-mono);
  font-size: 13px;
  text-anchor: middle;
}
.node.hot rect { stroke: var(--accent); }
.node.hot text { fill: var(--accent); }
.wire { stroke: var(--noir-border-strong); stroke-width: 1; }
.pulse { fill: var(--accent); opacity: 0; }

/* Timeline: out1 0-0.9s, out2 0.9-1.8s, ret1 2-2.9s, ret2 2.9-3.8s */
.run .out1 { animation: flow-a 0.9s 0.1s ease-in-out forwards; }
.run .out2 { animation: flow-b 0.9s 1s ease-in-out forwards; }
.run .ret1 { animation: flow-c 0.9s 2.1s ease-in-out forwards; }
.run .ret2 { animation: flow-d 0.9s 3s ease-in-out forwards; }
@keyframes flow-a {
  from { opacity: 1; cx: 158px; }
  to { opacity: 0; cx: 245px; }
}
@keyframes flow-b {
  from { opacity: 1; cx: 395px; }
  to { opacity: 0; cx: 482px; }
}
@keyframes flow-c {
  from { opacity: 1; cx: 482px; }
  to { opacity: 0; cx: 395px; }
}
@keyframes flow-d {
  from { opacity: 1; cx: 245px; }
  to { opacity: 0; cx: 158px; }
}
@media (prefers-reduced-motion: reduce) {
  .pulse { animation: none !important; opacity: 0; }
}
</style>
```

Implementation note: `cx` animation in CSS requires the SVG attribute to be promoted to a CSS property, which all evergreen browsers support (Chrome 106+/Safari 16+/Firefox 110+ per caniuse "cx as presentation attribute"). If dev-server testing shows a target browser without it, switch the `.pulse` circles to `transform: translateX()` keyframes with `cx="0"` baselines; keep the same timeline.

- [ ] **Step 2: Write `PairLoop.vue`**

```vue
<template>
  <figure ref="root" class="noir-diagram pair-loop">
    <svg
      viewBox="0 0 640 150"
      role="img"
      aria-label="Diagram: Claude and Codex exchange review requests in both directions."
      :class="{ run: inView }"
    >
      <g class="node claude">
        <rect x="8" y="45" width="180" height="60" rx="4" />
        <text x="98" y="80">▮ claude</text>
      </g>
      <g class="node codex">
        <rect x="452" y="45" width="180" height="60" rx="4" />
        <text x="542" y="80">▮ codex</text>
      </g>
      <path class="arc top" d="M 188 60 C 290 20, 350 20, 452 60" fill="none" />
      <path class="arc bottom" d="M 452 90 C 350 130, 290 130, 188 90" fill="none" />
      <circle class="pulse to-codex" r="4" />
      <circle class="pulse to-claude" r="4" />
    </svg>
    <figcaption>
      Claude asks Codex for a second opinion; Codex asks Claude back through
      the reverse path. Each reads, your agent edits.
    </figcaption>
  </figure>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useInView } from "../../theme/useInView";

const root = ref<Element | null>(null);
const inView = useInView(root);
</script>

<style scoped>
/* figure/svg/figcaption chrome comes from the global .noir-diagram rules (custom.css) */
.node text {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  text-anchor: middle;
}
.node.claude rect { fill: var(--claude-tint); stroke: var(--claude); }
.node.claude text { fill: var(--claude); }
.node.codex rect { fill: var(--accent-tint); stroke: var(--accent); }
.node.codex text { fill: var(--accent); }
.arc { stroke: var(--noir-border-strong); stroke-width: 1; }
.pulse { opacity: 0; }
.to-codex { fill: var(--claude); }
.to-claude { fill: var(--accent); }
.run .to-codex {
  offset-path: path("M 188 60 C 290 20, 350 20, 452 60");
  animation: travel 1.4s 0.2s ease-in-out infinite;
}
.run .to-claude {
  offset-path: path("M 452 90 C 350 130, 290 130, 188 90");
  animation: travel 1.4s 0.9s ease-in-out infinite;
}
@keyframes travel {
  0% { opacity: 0; offset-distance: 0%; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { opacity: 0; offset-distance: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .pulse { animation: none !important; opacity: 0; }
}
</style>
```

This is the one deliberately looping animation on the site (homepage hero section). Every other diagram plays once.

- [ ] **Step 3: Register both components**

In `apps/docs/.vitepress/theme/index.ts` add imports and `app.component("RequestFlow", RequestFlow); app.component("PairLoop", PairLoop);` alongside the existing registrations.

- [ ] **Step 4: Verify on a scratch page**

Temporarily append `<RequestFlow />\n<PairLoop />` to `apps/docs/concepts/how-it-works.md`, run `yarn docs:dev`, confirm: animation starts when scrolled into view, plays correctly, and with OS reduced-motion emulation (DevTools rendering panel) shows the static diagram. Remove the temporary lines.

Run: `yarn docs:build` and `yarn lint`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/.vitepress/components/diagrams/RequestFlow.vue apps/docs/.vitepress/components/diagrams/PairLoop.vue apps/docs/.vitepress/theme/index.ts
git commit -m "docs(diagrams): add animated RequestFlow and PairLoop SVG components"
```

---

### Task 5: Diagram components, part 2: `FanOut.vue`, `FallbackChain.vue`, `SessionThread.vue`

**Files:**
- Create: `apps/docs/.vitepress/components/diagrams/FanOut.vue`
- Create: `apps/docs/.vitepress/components/diagrams/FallbackChain.vue`
- Create: `apps/docs/.vitepress/components/diagrams/SessionThread.vue`
- Modify: `apps/docs/.vitepress/theme/index.ts` (register all three)

**Interfaces:**
- Consumes: `useInView` (Task 3), tokens (Task 2), `PROVIDER_DOCS` (Task 1: FanOut and FallbackChain read provider names/models so copy cannot drift).
- Produces: global components `<FanOut />`, `<SessionThread />`, and `<FallbackChain provider="codex" />` (prop `provider: "codex" | "claude" | "antigravity" | "gemini"`; providers with a `fallbackModel`).

All three reuse the `.noir-diagram` figure shell (global CSS from Task 2), the `useInView` wiring, and the reduced-motion block shown in Task 4. Scoped styles contain only each component's own node/wire/keyframe rules; only the SVG content and keyframes differ:

- [ ] **Step 1: Write `FanOut.vue`**

SVG `viewBox="0 0 640 240"`. Left node `multi-llm` (accent-stroked rect at x=8, vertically centered). Four right nodes stacked (x=452, y=8/68/128/188, width 180, height 44): labels `codex`, `claude`, `antigravity`, `ollama` rendered from `PROVIDER_DOCS` names (lowercased). Four straight `line.beam` elements from the left node's right edge (x=188, y=120) to each right node's left edge. Aria label: "Diagram: one prompt fans out to several providers in parallel and each response returns independently."

Animation (play once): beams draw via `stroke-dasharray: 300; stroke-dashoffset: 300;` animating to 0, staggered `0.15s * index`; then each right node's rect gets a `stroke` color flip to `--accent` (codex), `--claude` (claude), `--noir-text-2` (others) at staggered delays 1.2s to 2.4s, using `animation-fill-mode: forwards`. Add a fifth, deliberately delayed node treatment: `ollama`'s flip uses delay 2.4s so the stagger reads "responses return at different times". Figcaption: "multi-llm dispatches the same prompt in parallel. A provider failing or hitting quota does not fail the others."

- [ ] **Step 2: Write `FallbackChain.vue`**

```vue
<script setup lang="ts">
import { computed, ref } from "vue";
import { PROVIDER_DOCS, type ProviderId } from "../../theme/providers.data";
import { useInView } from "../../theme/useInView";

const props = defineProps<{ provider: ProviderId }>();
const doc = computed(() => PROVIDER_DOCS[props.provider]);
const root = ref<Element | null>(null);
const inView = useInView(root);
</script>
```

Template: SVG `viewBox="0 0 640 120"`. Three elements left to right: node `{{ doc.defaultModel }}`, a mono text `quota / rate limit` in `--color-error` that flashes in at 0.8s, node `{{ doc.fallbackModel }}` that lights up (`stroke` flips to `--accent`) at 1.6s, with a wire between the nodes drawn at 1.2s. Both model names render via SVG `<text>` bound to the computed `doc`, so the diagram always shows the drift-checked values. Aria label bound: `` `Diagram: ${doc.value.defaultModel} falls back to ${doc.value.fallbackModel} when quota is exhausted.` ``. Figcaption: "When the default model hits quota, the executor retries once on the fallback and reports the actual model used in the response."

- [ ] **Step 3: Write `SessionThread.vue`**

SVG `viewBox="0 0 640 140"`. A horizontal timeline line at y=70 (drawn once via dashoffset over 1s). Three call markers (circles at x=120/320/520) that pop in (scale via `transform-origin` + opacity keyframes) at 1.0s/1.4s/1.8s, each with a mono label above: `call 1`, `call 2 (sessionId)`, `call 3 (sessionId)`. Below the second marker, a small `--noir-text-3` mono annotation `cache bypassed` fades in at 2.2s. Aria label: "Diagram: passing the returned sessionId threads later calls onto the same provider conversation." Figcaption: "The first call returns a sessionId. Passing it back continues the same conversation, and cached responses are skipped for session calls."

- [ ] **Step 4: Register, verify, commit**

Register all three in `theme/index.ts`. Temporarily embed `<FanOut />`, `<FallbackChain provider="codex" />`, `<SessionThread />` in `apps/docs/concepts/models.md`, verify in `yarn docs:dev` (both motion states, FallbackChain renders `gpt-5.6-sol` and `gpt-5.6-terra` from data), remove the temporary embeds.

Run: `yarn docs:build && yarn lint`. Expected: clean.

```bash
git add apps/docs/.vitepress/components/diagrams/ apps/docs/.vitepress/theme/index.ts
git commit -m "docs(diagrams): add FanOut, FallbackChain, and SessionThread animated diagrams"
```

---

### Task 6: `InstallSnippet.vue` + data-driven `SetupTabs.vue` rework

**Files:**
- Create: `apps/docs/.vitepress/components/InstallSnippet.vue`
- Create: `apps/docs/.vitepress/components/ProviderStatus.vue`
- Modify: `apps/docs/.vitepress/components/SetupTabs.vue` (full rework)
- Modify: `apps/docs/.vitepress/theme/index.ts` (register `InstallSnippet`, `ProviderStatus`)

**Interfaces:**
- Consumes: `PROVIDER_DOCS` (Task 1), tokens (Task 2).
- Produces: `<InstallSnippet provider="codex" />` (prop `provider: ProviderId`): renders the provider CLI install command plus the `claude mcp add` command for that provider, each in a copyable block. `<ProviderStatus provider="codex" />` (same prop): one-line data-driven status strip for provider page headers. `<SetupTabs provider="unified" />` keeps its existing prop contract (`provider: ProviderId`, default `"unified"`) so existing page embeds keep working, but all commands/JSON now derive from `PROVIDER_DOCS[provider]` fields (`pkg`, `serverName`) instead of a hardcoded `cfg` map. Tabs: `Claude Code`, `Codex CLI`, `Cursor`, `JSON config`.

- [ ] **Step 1: Write `InstallSnippet.vue`**

```vue
<template>
  <div class="install-snippet">
    <p class="label">1. Provider CLI</p>
    <pre><code>{{ doc.cliInstall }}</code></pre>
    <p class="label">2. Register the MCP server (Claude Code shown; see Quick Start for other clients)</p>
    <pre><code>claude mcp add --scope user {{ doc.serverName }} -- npx -y {{ doc.pkg }}</code></pre>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PROVIDER_DOCS, type ProviderId } from "../theme/providers.data";

const props = defineProps<{ provider: ProviderId }>();
const doc = computed(() => PROVIDER_DOCS[props.provider]);
</script>

<style scoped>
.install-snippet {
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  padding: var(--space-4);
  background: var(--noir-raised);
  margin: var(--space-4) 0;
}
.label {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--noir-text-3);
  margin: var(--space-2) 0;
}
pre {
  margin: 0 0 var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--noir-border);
  border-radius: var(--radius);
  background: var(--noir-bg);
  overflow-x: auto;
}
code {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--noir-text);
}
</style>
```

- [ ] **Step 2: Write `ProviderStatus.vue`**

```vue
<template>
  <p class="provider-status">
    <span class="pkg">{{ doc.pkg }}</span>
    <span v-if="doc.status" class="badge">{{ doc.status }}</span>
    <span class="models">
      default <code>{{ doc.defaultModel }}</code><template v-if="doc.fallbackModel">
        → fallback <code>{{ doc.fallbackModel }}</code></template>
    </span>
  </p>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { PROVIDER_DOCS, type ProviderId } from "../theme/providers.data";

const props = defineProps<{ provider: ProviderId }>();
const doc = computed(() => PROVIDER_DOCS[props.provider]);
</script>

<style scoped>
.provider-status {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--noir-text-3);
  padding: var(--space-3) 0;
  border-top: 1px solid var(--noir-border);
  border-bottom: 1px solid var(--noir-border);
  margin: var(--space-4) 0 var(--space-6);
}
.pkg { color: var(--noir-text); }
.badge {
  border: 1px solid var(--noir-border-strong);
  border-radius: var(--radius);
  padding: 1px 8px;
  text-transform: uppercase;
  font-size: 10px;
  letter-spacing: 0.08em;
}
.models code {
  font-size: 12px;
  background: transparent;
  padding: 0;
  color: var(--noir-text-2);
}
</style>
```

- [ ] **Step 3: Rework `SetupTabs.vue`**

Rebuild with the same four-panel structure it has today (see current file for panel content shapes) but: tab list `Claude Code / Codex CLI / Cursor / JSON config`; every occurrence of the old hardcoded `cfg.serverName` / `cfg.pkg` replaced by fields read from `PROVIDER_DOCS[props.provider]`; the mac-dots ornament removed; real `<button role="tab" :aria-selected="...">` semantics with arrow-key switching:

```ts
const tabs = ["claude-code", "codex", "cursor", "json"] as const;
function onKeydown(event: KeyboardEvent) {
  const order = tabs.indexOf(activeTab.value);
  if (event.key === "ArrowRight") activeTab.value = tabs[(order + 1) % tabs.length];
  if (event.key === "ArrowLeft") activeTab.value = tabs[(order + tabs.length - 1) % tabs.length];
}
```

Panel content per tab (all interpolating `doc.serverName` and `doc.pkg`):
- Claude Code: project-scope and user-scope `claude mcp add` commands, plus the plugin install block (`/plugin marketplace add Lykhoyda/ask-llm`, `/plugin install ask-llm@ask-llm-plugins`) kept verbatim from the current component.
- Codex CLI: `codex mcp add {server} -- npx -y {pkg}`.
- Cursor: `.cursor/mcp.json` JSON snippet.
- JSON config: generic `mcpServers` JSON (covers Claude Desktop, Warp, and other JSON-config clients; hint text names them).

Scoped styles: noir tokens, active tab = accent text + 2px accent underline that slides via `transition: transform` on an underline element (static under reduced motion).

- [ ] **Step 4: Register and verify**

Register `InstallSnippet` and `ProviderStatus` in `theme/index.ts`. Run `yarn docs:dev`, check `/getting-started` (still the old page; its `<SetupTabs>` embed must render the reworked component correctly) and keyboard-switch tabs. Run `yarn docs:build && yarn lint`.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/.vitepress/components/InstallSnippet.vue apps/docs/.vitepress/components/ProviderStatus.vue apps/docs/.vitepress/components/SetupTabs.vue apps/docs/.vitepress/theme/index.ts
git commit -m "docs(components): data-driven InstallSnippet, ProviderStatus, and SetupTabs rework"
```

---

### Task 7: Homepage rebuild

**Files:**
- Create: `apps/docs/.vitepress/components/NoirHero.vue`
- Create: `apps/docs/.vitepress/components/ReviewLoop.vue`
- Create: `apps/docs/.vitepress/components/ProviderChips.vue`
- Delete: `apps/docs/.vitepress/components/InAction.vue`
- Modify: `apps/docs/.vitepress/theme/index.ts` (register new three, drop `InAction`)
- Modify: `apps/docs/index.md` (full rewrite)

**Interfaces:**
- Consumes: `PROVIDER_DOCS`, `HERO_IDS`, `SUPPORTING_IDS` (Task 1), `PairLoop` + `RequestFlow` (Task 4), `SetupTabs` (Task 6), `useInView` (Task 3).
- Produces: the shipped homepage; no downstream consumers.

- [ ] **Step 1: Write `NoirHero.vue`**

Typed-command hero. Behavior: the command string types itself character by character on mount (35ms/char via `setInterval`, cleared on unmount); under reduced motion the full string renders immediately. Cursor is a `▌` span with a CSS blink (also gated). Headline, subtext, CTAs are static markup below.

```vue
<template>
  <section class="noir-hero">
    <p class="command" aria-label="claude mcp add ask-llm -- npx -y ask-llm-mcp">
      <span aria-hidden="true">$ {{ typed }}</span><span class="cursor" aria-hidden="true">▌</span>
    </p>
    <h1>Every diff deserves<br />a second opinion.</h1>
    <p class="sub">
      Your coding agent consults another frontier model over MCP. Independent
      reviews, plan debates, fresh eyes.
    </p>
    <p class="ctas">
      <a class="cta primary" :href="withBase('/getting-started')">Quick Start</a>
      <a class="cta alt" :href="withBase('/plugin/overview')">Install Plugin</a>
    </p>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { withBase } from "vitepress";

const FULL = "claude mcp add ask-llm -- npx -y ask-llm-mcp";
const typed = ref("");
let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    typed.value = FULL;
    return;
  }
  let i = 0;
  timer = setInterval(() => {
    i += 1;
    typed.value = FULL.slice(0, i);
    if (i >= FULL.length) clearInterval(timer);
  }, 35);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<style scoped>
.noir-hero {
  padding: var(--space-16) 0 var(--space-12);
  max-width: 760px;
}
.command {
  font-family: var(--font-mono);
  font-size: 14px;
  color: var(--accent);
  min-height: 1.5em;
  margin: 0 0 var(--space-4);
}
.cursor { animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }
h1 {
  font-family: var(--font-mono);
  font-size: clamp(32px, 5vw, 52px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.1;
  margin: 0 0 var(--space-4);
  border: none;
}
.sub {
  font-family: var(--font-sans);
  color: var(--noir-text-2);
  font-size: 16px;
  max-width: 52ch;
  margin: 0 0 var(--space-6);
}
.ctas { display: flex; gap: var(--space-3); margin: 0; }
.cta {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  padding: 10px 18px;
  border-radius: var(--radius);
  text-decoration: none;
  transition: transform 0.1s ease;
}
.cta:active { transform: translateY(1px); }
.cta.primary { background: var(--accent); color: var(--noir-bg); }
.cta.primary:hover { background: var(--accent-dim); }
.cta.alt { border: 1px solid var(--noir-border-strong); color: var(--noir-text); }
.cta.alt:hover { border-color: var(--accent); }
@media (prefers-reduced-motion: reduce) {
  .cursor { animation: none; }
}
@media (max-width: 640px) {
  .noir-hero { padding-top: var(--space-8); }
  .ctas { flex-direction: column; }
}
</style>
```

- [ ] **Step 2: Write `ReviewLoop.vue`**

Renders the two hero cards from `HERO_IDS` flanking `<PairLoop />`-style exchange arrows. Structure: heading + sub prose, then a grid `card | arrows | card` on desktop collapsing to stacked on mobile. Cards are `<a :href="withBase(doc.docPath)">` (import `withBase` from `vitepress`) containing: `▮ NAME` title line (claude coral / codex green per id), tagline from data, and the `$ npx {pkg}` line in a mini code chip. Model line: `default {{ doc.defaultModel }} → fallback {{ doc.fallbackModel }}` in `--noir-text-3` mono 11px. Arrows column: two spans `⇀` (accent) and `↽` (claude) with a gentle opacity alternation keyframe (gated). Cards use `.reveal` + `useInView` on the section root, with a 60ms stagger via `transition-delay` on the second card. Scoped styles follow the token conventions from Step 1 (hairline borders, 4px radius, tint backgrounds `--claude-tint`/`--accent-tint`, focus-visible outline).

Copy (exact): heading `The review loop`; sub `Claude and Codex review each other's work. The other model reads, your agent edits.`

- [ ] **Step 3: Write `ProviderChips.vue`**

One row, label `Also speaks:` (sans, `--noir-text-2`, 13px) followed by chips from `SUPPORTING_IDS` plus a final unified chip. Each chip is an `<a>` to `withBase(doc.docPath)`: mono 12px, 1px `--noir-border` border, `--noir-text-2` text, provider name plus a `--noir-text-3` annotation (`agy` for antigravity, `local` for ollama, `enterprise` for gemini, derived from `status ?? "agy"` mapping written explicitly in the component). Unified chip: `unified: all of them →` with `--noir-border-strong` border and `--noir-text` text. Hover: border-color accent. Wraps on mobile.

- [ ] **Step 4: Rewrite `apps/docs/index.md`**

```md
---
layout: home
description: MCP servers for AI-to-AI collaboration. Claude and Codex review each other's work; Antigravity, Ollama, and Gemini extend the bench.
---

<div class="vp-doc home-content">

<NoirHero />

<ReviewLoop />

<ProviderChips />

<h2 class="home-h2">How a request flows</h2>

<RequestFlow />

<h2 class="home-h2">Quick start</h2>

<SetupTabs provider="unified" />

<p class="home-verify">Then ask your agent: <code>Use ask-llm ping to test the connection</code>. A <em>Pong!</em> reply lists every provider it detected. Something off? Run <code>npx ask-llm-mcp doctor</code>.</p>

<h2 class="home-h2">Explore</h2>

<ul class="home-explore">
  <li><a href="/ask-llm/concepts/how-it-works">How It Works</a> <span>request flow in depth</span></li>
  <li><a href="/ask-llm/usage/how-to-ask">How to Ask</a> <span>usage patterns and examples</span></li>
  <li><a href="/ask-llm/concepts/models">Model Selection</a> <span>defaults, fallbacks, overrides</span></li>
  <li><a href="/ask-llm/usage/multi-turn-sessions">Multi-Turn Sessions</a> <span>continue conversations across calls</span></li>
  <li><a href="/ask-llm/plugin/overview">Claude Code Plugin</a> <span>reviews, brainstorming, hooks</span></li>
  <li><a href="/ask-llm/resources/troubleshooting">Troubleshooting</a> <span>common issues and fixes</span></li>
</ul>

</div>
```

Add to `custom.css` (homepage-global helpers; keep them together under a `/* Home */` header):

```css
.home-content { max-width: 960px; margin: 0 auto; padding: 0 var(--space-6) var(--space-16); }
.home-h2 {
  font-family: var(--font-mono);
  font-size: 20px;
  font-weight: 700;
  border: none;
  margin: var(--space-16) 0 var(--space-2);
  padding: 0;
}
.home-verify { color: var(--noir-text-2); font-size: 14px; max-width: 65ch; }
.home-explore { list-style: none; padding: 0; margin: var(--space-4) 0 0; }
.home-explore li {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--noir-border);
}
.home-explore a { font-family: var(--font-mono); font-size: 14px; }
.home-explore span { color: var(--noir-text-3); font-size: 13px; }
```

- [ ] **Step 5: Delete `InAction.vue` and update registrations**

Remove the file, its import, and its `app.component("InAction", ...)` line. Register `NoirHero`, `ReviewLoop`, `ProviderChips`.

- [ ] **Step 6: Verify**

`yarn docs:dev`: homepage matches the approved mockup composition (typed hero, review loop with looping pulses, chips, request flow animating once on scroll, tabs, explore list). Check reduced-motion emulation: no typing (full command shown), no pulses, diagrams static-final. Keyboard-walk the page: every link/tab reachable with visible focus. Mobile width 375px: hero CTAs stack, review loop stacks, chips wrap.

Run: `yarn docs:build && yarn lint`. Expected: clean (build fails if any old class references remain in index.md).

- [ ] **Step 7: Commit**

```bash
git add apps/docs/index.md apps/docs/.vitepress/components/ apps/docs/.vitepress/theme/
git commit -m "docs(home): rebuild homepage with Terminal Noir hero, review loop, and animated flow"
```

---

### Task 8: Quick Start merge + redirect stubs + nav/sidebar update

**Files:**
- Modify: `apps/docs/getting-started.md` (full rewrite as the merged Quick Start)
- Modify: `apps/docs/installation.md` (replace with redirect stub)
- Modify: `apps/docs/first-steps.md` (replace with redirect stub)
- Modify: `apps/docs/.vitepress/config.ts` (nav + sidebar)

**Interfaces:**
- Consumes: `<SetupTabs>` (Task 6), `PROVIDER_DOCS` ordering conventions.
- Produces: final URL set. Task 11 (llms.txt) depends on it.

- [ ] **Step 1: Rewrite `getting-started.md`**

Full content (this is the merged page; source material is the current three pages, deduplicated):

````md
---
description: Install a provider CLI, register the MCP server, and verify with ping. One page from zero to a working second opinion.
---

# Quick Start

Three steps: install at least one provider CLI, register the MCP server with your client, verify with ping. Start with one provider and add others anytime.

## 1. Install a provider

**Node.js v20+** is required. Then pick a provider. Codex and Claude are the recommended pair: each can review the other.

::: code-group

```bash [Codex]
npm install -g @openai/codex
# follow the codex CLI's auth instructions
```

```bash [Claude]
npm install -g @anthropic-ai/claude-code
# run claude once and authenticate
# (use this provider FROM Codex or another non-Claude host)
```

```bash [Antigravity]
# install agy from https://antigravity.google, then log in once
```

```bash [Ollama]
# install from https://ollama.com, then:
ollama pull qwen3.6:27b
```

```bash [Gemini]
npm install -g @google/gemini-cli && gemini login
# enterprise seats only since 2026-06-18
```

:::

Not sure which? See each provider's page: [Codex](/providers/codex), [Claude](/providers/claude), [Antigravity](/providers/antigravity), [Ollama](/providers/ollama), [Gemini](/providers/gemini).

## 2. Register the MCP server

The recommended package is `ask-llm-mcp`, the unified orchestrator: it auto-detects every provider CLI you installed and exposes one `ask-llm` tool plus `multi-llm`, `get-usage-stats`, `diagnose`, and `ping`.

<SetupTabs provider="unified" />

Prefer a single provider with its richer tool surface (`ask-codex-edit`, `fetch-chunk`, native session tools)? Install the per-provider package instead: swap `ask-llm-mcp` for `ask-codex-mcp`, `ask-claude-mcp`, `ask-antigravity-mcp`, `ask-ollama-mcp`, or `ask-gemini-mcp` in any tab above.

## 3. Verify

Ask your agent:

```text
Use ask-llm ping to test the connection
```

A `Pong!` reply lists the providers your server detected. If something is off, run the doctor from your terminal; it works even when the MCP server cannot start:

```bash
npx ask-llm-mcp doctor
```

## First calls

```text
Use ask-llm to ask Codex to review the staged changes
Use ask-llm to ask Claude to critique this plan
Use multi-llm to ask Codex and Claude whether this approach is thread-safe
```

`multi-llm` returns per-provider responses plus token usage in one structured payload, and one provider hitting quota does not fail the others.

## Next steps

- [How to Ask](/usage/how-to-ask): prompt patterns that work
- [Multi-Turn Sessions](/usage/multi-turn-sessions): continue a conversation across calls
- [Claude Code Plugin](/plugin/overview): slash commands, reviewer agents, hooks
````

- [ ] **Step 2: Replace `installation.md` and `first-steps.md` with redirect stubs**

`installation.md`:

```md
---
description: Moved. Installation now lives in the Quick Start.
head:
  - - meta
    - http-equiv: refresh
      content: "0; url=/ask-llm/getting-started.html"
  - - link
    - rel: canonical
      href: https://lykhoyda.github.io/ask-llm/getting-started.html
---

# Moved

Installation now lives in the [Quick Start](/getting-started).
```

`first-steps.md`: identical structure, body `First steps now live in the [Quick Start](/getting-started#3-verify).` and the same refresh/canonical targets.

- [ ] **Step 3: Update `config.ts` nav and sidebar**

Nav: `Guide` stays `/getting-started`; Providers dropdown order Codex, Claude, Antigravity, Ollama, Gemini, Unified (already correct). Sidebar Getting Started group becomes:

```ts
{
  text: "Getting Started",
  collapsed: false,
  items: [
    { text: "Overview", link: "/" },
    { text: "Quick Start", link: "/getting-started" },
  ],
},
```

(`Installation` and `First Steps` entries removed; everything else unchanged.)

- [ ] **Step 4: Verify**

`yarn docs:build` (dead-link check will catch any page still linking to removed sidebar anchors; fix any `/installation` or `/first-steps` links surfaced by grep):

Run: `grep -rn "/installation\|/first-steps" apps/docs --include="*.md" --include="*.vue" --include="*.ts" | grep -v ".vitepress/dist"`
Expected: only the two stub files themselves. Rewrite any other hits to point at `/getting-started`.

`yarn docs:dev`: visiting `/installation` shows the stub and immediately lands on Quick Start.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/getting-started.md apps/docs/installation.md apps/docs/first-steps.md apps/docs/.vitepress/config.ts
git commit -m "docs: merge onboarding into one Quick Start with redirect stubs"
```

---

### Task 9: Provider pages on the shared template

**Files:**
- Modify: `apps/docs/providers/codex.md`, `claude.md`, `antigravity.md`, `ollama.md`, `gemini.md`, `unified.md`

**Interfaces:**
- Consumes: `<InstallSnippet>` (Task 6), `<FallbackChain>` (Task 5), `<FanOut>` (Task 5).

Template (every page, in order): H1 → `<ProviderStatus provider="x" />` status strip → intro paragraph → `## Installation` with `<InstallSnippet provider="x" />` + global-install one-liner → `## Tools` table → `## Models` with `<FallbackChain provider="x" />` where a fallback exists → provider-specific sections (kept from current pages) → `## Configuration` env table → `## npm` links.

- [ ] **Step 1: Rewrite `codex.md` as the canonical example**

Keep the current page's provider-specific sections (JSONL parsing notes, edit mode, archived sessions, whatever exists) verbatim; replace the Installation section with:

```md
## Installation

<InstallSnippet provider="codex" />

Or install globally: `npm install -g ask-codex-mcp`
```

Replace the Models section prose with:

```md
## Models

<FallbackChain provider="codex" />

- **Default:** `gpt-5.6-sol` (GPT-5.6 Sol flagship)
- **Quota fallback:** `gpt-5.6-terra`, the balanced GPT-5.6 tier
- **Overrides:** `ASK_CODEX_MODEL`, `ASK_CODEX_FALLBACK_MODEL`, or the per-call `model` parameter
```

Update the intro to hero framing: `OpenAI's Codex CLI is the workhorse reviewer of the pair: strongest code reasoning for targeted reviews, architecture critique, and diff analysis. Claude asks Codex; Codex asks Claude back through` [`ask-claude-mcp`](/providers/claude)`.`

- [ ] **Step 2: Apply the same template to the other five pages**

Per page:
- `claude.md`: replace `<SetupTabs provider="claude" />` with `<InstallSnippet provider="claude" />`; add `<FallbackChain provider="claude" />` at the top of `## Models`; keep Read-only boundary and Native sessions sections verbatim; intro gains the mirror sentence linking back to `/providers/codex`.
- `antigravity.md`: `<InstallSnippet provider="antigravity" />`; `<FallbackChain provider="antigravity" />` in Models.
- `gemini.md`: `<InstallSnippet provider="gemini" />`; `<FallbackChain provider="gemini" />`; keep the enterprise-gating callout as the FIRST element after the intro.
- `ollama.md`: `<InstallSnippet provider="ollama" />`; NO FallbackChain (no fallback by design); keep/add the sentence `There is deliberately no model fallback: a missing model fails fast with an actionable ollama pull command.`
- `unified.md`: `<InstallSnippet provider="unified" />`; add `<FanOut />` under a `## Parallel dispatch` heading with one sentence of prose; keep provider-detection notes.

Every page: ensure the Tools table rows exactly match the `tools` array in `providers.data.ts` for that provider; scan and remove any em-dashes in copy.

- [ ] **Step 3: Verify and commit**

Run: `yarn docs:build && node scripts/check-docs-drift.mjs`
Expected: both clean.
`yarn docs:dev`: spot-check codex + claude + unified pages, both motion states.

```bash
git add apps/docs/providers/
git commit -m "docs(providers): shared template with InstallSnippet and animated fallback diagrams"
```

---

### Task 10: Concepts + usage pages: animated diagrams and dedup

**Files:**
- Modify: `apps/docs/concepts/how-it-works.md`, `concepts/models.md`, `usage/multi-turn-sessions.md`, `usage/how-to-ask.md`, `usage/strategies-and-examples.md`, `concepts/sandbox.md`

**Interfaces:**
- Consumes: `<RequestFlow>`, `<FanOut>`, `<FallbackChain>`, `<SessionThread>`.

- [ ] **Step 1: `concepts/how-it-works.md`**

Replace the request-flow Mermaid diagram (the page's primary diagram) with `<RequestFlow />`. Keep surrounding prose; trim any paragraph that only restates what the diagram caption now says. If the page has a second Mermaid for multi-provider dispatch, replace with `<FanOut />`; other Mermaids stay.

- [ ] **Step 2: `concepts/models.md`**

Add `<FallbackChain provider="codex" />` directly under the fallback-behavior heading. Rewrite any hardcoded model names to the current constants (`gpt-5.6-sol`, `gpt-5.6-terra`, etc. per the Global Constraints list). Ensure the per-provider defaults table matches `providers.data.ts` exactly.

- [ ] **Step 3: `usage/multi-turn-sessions.md`**

Add `<SessionThread />` after the intro paragraph. Verify the page states that response caching is bypassed whenever `sessionId` is provided (ADR-063 semantics); add one sentence if missing.

- [ ] **Step 4: Dedup pass across `usage/how-to-ask.md`, `usage/strategies-and-examples.md`, `concepts/sandbox.md`**

Rules: delete any install/registration instructions (link to `/getting-started` instead); ensure examples lead with Codex and Claude (rewrite `ask gemini ...` first-examples to `ask codex ...` / `ask claude ...`, keeping one Gemini and one Ollama example each where they illustrate something provider-specific); remove em-dashes; keep everything else.

- [ ] **Step 5: Verify and commit**

Run: `yarn docs:build`
Expected: clean. `yarn docs:dev`: each embedded diagram animates once in place, static under reduced motion.

```bash
git add apps/docs/concepts/ apps/docs/usage/
git commit -m "docs(concepts,usage): animated concept diagrams and dedup pass"
```

---

### Task 11: Plugin + resources pages sweep, llms.txt, hero-pair copy audit

**Files:**
- Modify: `apps/docs/plugin/overview.md`, `plugin/skills.md`, `plugin/hooks.md`, `plugin/agents.md`, `resources/faq.md`, `resources/troubleshooting.md`
- Modify: `apps/docs/public/llms.txt`, `apps/docs/public/llms-full.txt`

- [ ] **Step 1: Plugin + resources sweep**

Same dedup rules as Task 10 Step 4 (no inline install blocks beyond the plugin's own two-line install; Codex/Claude-first examples; no em-dashes). In `plugin/overview.md` ensure the install block matches the SetupTabs plugin block verbatim (`/plugin marketplace add Lykhoyda/ask-llm`, `/plugin install ask-llm@ask-llm-plugins`). In `resources/faq.md` and `troubleshooting.md`, update any references to `/installation` or `/first-steps` to `/getting-started` (Task 8's grep should already have caught these; re-verify).

- [ ] **Step 2: Update llms.txt + llms-full.txt**

In both files: remove or rewrite entries describing `installation` and `first-steps` pages to point at `getting-started`; verify every published package name still appears (the drift script requires it); update any model names to the constants-verified values; describe the six providers with Codex and Claude listed first.

- [ ] **Step 3: Verify and commit**

Run: `node scripts/check-docs-drift.mjs && yarn docs:build`
Expected: both clean.

```bash
git add apps/docs/plugin/ apps/docs/resources/ apps/docs/public/llms.txt apps/docs/public/llms-full.txt
git commit -m "docs(plugin,resources): hero-pair copy sweep and llms.txt refresh"
```

---

### Task 12: Final verification pass + project docs

**Files:**
- Modify: `docs/ROADMAP.md`, `docs/DECISIONS.md`

- [ ] **Step 1: Full verification matrix**

1. `yarn docs:build`: clean.
2. `node scripts/check-docs-drift.mjs`: clean.
3. `yarn lint`: clean.
4. Browser pass (`yarn docs:dev`): every page in the sidebar, default motion. Then DevTools rendering panel → emulate `prefers-reduced-motion: reduce` → re-check homepage + the five diagram host pages: everything static, final frames shown.
5. Keyboard-only walk: homepage and Quick Start end to end; every interactive element reachable with a visible green focus outline.
6. Contrast spot-check (DevTools contrast tooltip): `--noir-text-2` and `--noir-text-3` on both `--noir-bg` and `--noir-raised`; accent-on-bg for CTA text (accent bg with `--noir-bg` text must pass AA for its 13px bold size, ratio is ~12:1, verify).
7. Em-dash scan: `grep -rn "—" apps/docs --include="*.md" --include="*.vue" | grep -v ".vitepress/dist"` returns nothing.
8. Redirect stubs: visit `/ask-llm/installation.html` on the built site (`yarn docs:build && npx serve apps/docs/.vitepress/dist` or vitepress preview) and confirm the meta refresh lands on Quick Start.
9. Local search: on the built site, search `install`, `codex`, and `claude`; confirm the top hits land on Quick Start and the provider pages (the merged page changes anchors, so stale results indicate the index did not rebuild).

Fix anything surfaced, amend into the relevant area, re-run.

- [ ] **Step 2: Update project docs**

- `docs/ROADMAP.md`: dated entry summarizing the overhaul (IA merge, Terminal Noir system, five animated diagrams, providers.data.ts drift guard).
- `docs/DECISIONS.md`: new ADR (next free number): "Docs site Terminal Noir redesign with providers.data.ts single source of truth". Context: duplication drift + hero repositioning; Decision: data-module-driven docs, animated SVG concept diagrams, CSS-only motion; Alternatives: motion library (rejected: dependency weight), keeping three onboarding pages (rejected: triplicated content); Consequences: model changes require providers.data.ts update enforced by check-docs-drift.mjs.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md docs/DECISIONS.md
git commit -m "docs: log Terminal Noir overhaul ADR and roadmap entry"
```
