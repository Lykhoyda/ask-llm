# Docs + README Rewrite & Site UI/UX Refinement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition the README and VitePress docs site to lead with the "second opinion before you ship" value, present providers neutrally (Codex/Antigravity-forward, Gemini flagged enterprise-gated), and refine the dark/mono theme — without restructuring routes or changing any server/plugin code.

**Architecture:** Documentation-only change across three surfaces: the root `README.md`, the VitePress site in `apps/docs/`, and the site theme in `apps/docs/.vitepress/`. One new Vue component (`InAction.vue`) renders a concrete prompt→review→fix transcript on the homepage. Provider ordering and the homepage card layout change; no routes are renamed (links/SEO preserved). Two sidebar-orphaned pages are wired back into navigation with distinct roles.

**Tech Stack:** VitePress (Vue 3 SFCs, Markdown), CSS custom properties (design tokens), Biome (lint/format), Yarn workspaces. No npm-published package changes ⇒ **no changeset required** (the root README and `apps/docs` are not published packages; docs deploy via `deploy-docs.yml`).

**Spec:** `docs/superpowers/specs/2026-06-14-docs-readme-uiux-rewrite-design.md`

**Conventions for every task below:**
- This is prose/markup work: the "test" is `yarn docs:build` (clean), plus targeted `grep`/screenshot checks. `yarn lint` only matters for the `.vue` component task.
- Homepage HTML uses absolute base-path links (`/ask-llm/...`). Preserve that convention.
- Commit messages use Conventional Commits and end with the `Co-Authored-By` trailer.
- New color use should reference existing design tokens. Raw hex is limited to: (1) the Task 1 muted-contrast bump; (2) in `InAction.vue`, the window-chrome traffic-light dots and the `⚠` amber (`#fbbf24`) — both reuse values already hardcoded in `SetupTabs.vue` / the theme's existing warning color `rgb(251,191,36)`.

**Provider order (canonical, applied everywhere):** Codex → Antigravity → Ollama → Gemini → Unified (`ask-llm`).

---

### Task 1: Foundation — provider reorder, sidebar de-orphan, accessibility token

**Files:**
- Modify: `apps/docs/.vitepress/config.ts` (nav `Providers` dropdown ~114-120; sidebar `Getting Started` group ~126-133; sidebar `Providers` group ~135-144)
- Modify: `apps/docs/.vitepress/theme/design-tokens.css:38` (`--color-text-muted`)

- [ ] **Step 1: Reorder the nav `Providers` dropdown** in `config.ts`. Replace the current `items` (Gemini, Codex, Ollama, Antigravity, Unified) with:

```ts
        {
          text: "Providers",
          items: [
            { text: "Codex", link: "/providers/codex" },
            { text: "Antigravity", link: "/providers/antigravity" },
            { text: "Ollama", link: "/providers/ollama" },
            { text: "Gemini", link: "/providers/gemini" },
            { text: "Unified", link: "/providers/unified" },
          ],
        },
```

- [ ] **Step 2: Wire the two orphan pages into the `Getting Started` sidebar group.** Replace that group's `items` with the install→verify progression:

```ts
          items: [
            { text: "Overview", link: "/" },
            { text: "Quick Start", link: "/getting-started" },
            { text: "Installation", link: "/installation" },
            { text: "First Steps", link: "/first-steps" },
          ],
```

- [ ] **Step 3: Reorder the `Providers` sidebar group** to match the canonical order:

```ts
          items: [
            { text: "Codex", link: "/providers/codex" },
            { text: "Antigravity", link: "/providers/antigravity" },
            { text: "Ollama", link: "/providers/ollama" },
            { text: "Gemini", link: "/providers/gemini" },
            { text: "Unified (ask-llm)", link: "/providers/unified" },
          ],
```

- [ ] **Step 4: Fix the muted-text contrast.** In `design-tokens.css`, change:

```css
  --color-text-muted: #52525b;
```
to:
```css
  --color-text-muted: #82828c; /* WCAG AA: ~5.2:1 on --color-bg (was #52525b ~2.5:1) */
```

- [ ] **Step 5: Build and verify.**

Run: `yarn docs:build`
Expected: completes with no errors and no dead-link warnings.

- [ ] **Step 6: Verify the orphans are now linked.**

Run: `grep -nE "/installation|/first-steps" apps/docs/.vitepress/config.ts`
Expected: both routes appear in the sidebar config.

- [ ] **Step 7: Commit.**

```bash
git add apps/docs/.vitepress/config.ts apps/docs/.vitepress/theme/design-tokens.css
git commit -m "$(printf 'docs(site): reorder providers, de-orphan install pages, fix muted contrast\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: `InAction.vue` — homepage "see it in action" transcript component

**Files:**
- Create: `apps/docs/.vitepress/components/InAction.vue`
- Modify: `apps/docs/.vitepress/theme/index.ts` (register the component globally)

- [ ] **Step 1: Read the existing component-registration pattern.**

Run: `cat apps/docs/.vitepress/theme/index.ts`
Expected: shows how `SetupTabs`/`DiagramModal` are imported and registered via `app.component(...)`. Mirror it exactly for `InAction`.

- [ ] **Step 2: Create `InAction.vue`** with this exact content (mirrors `SetupTabs.vue` window chrome; all colors from tokens):

```vue
<template>
  <div class="in-action">
    <div class="ia-window">
      <div class="ia-header">
        <div class="mac-dots"><span></span><span></span><span></span></div>
        <span class="ia-title">second opinion</span>
      </div>
      <div class="ia-body">
        <p class="ia-line">
          <span class="ia-role ia-you">you</span>
          <span class="ia-text">ask codex to review <code>@src/auth.ts</code> for security issues</span>
        </p>
        <p class="ia-line">
          <span class="ia-role ia-codex">codex</span>
          <span class="ia-text"><span class="ia-warn">⚠</span> <code>verifyToken()</code> compares tokens with <code>===</code> — not timing-safe (line 42)</span>
        </p>
        <p class="ia-line">
          <span class="ia-role ia-codex">codex</span>
          <span class="ia-text"><span class="ia-warn">⚠</span> the session cookie is missing a <code>SameSite</code> attribute</span>
        </p>
        <p class="ia-line">
          <span class="ia-role ia-claude">claude</span>
          <span class="ia-text">Good catches — applying both fixes to <code>src/auth.ts</code>.</span>
        </p>
      </div>
    </div>
    <p class="ia-caption">One prompt. A second model reviews independently; your assistant applies the fix.</p>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.in-action {
  max-width: 720px;
  margin: 8px auto 56px;
  position: relative;
  z-index: 2;
}

.ia-window {
  background: var(--color-bg-raised);
  border: 1px solid var(--color-bg-border);
  overflow: hidden;
  clip-path: polygon(
    var(--corner-size) 0%, 100% 0%, 100% calc(100% - var(--corner-size)),
    calc(100% - var(--corner-size)) 100%, 0% 100%, 0% var(--corner-size)
  );
}

.ia-header {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--color-bg-hover);
  border-bottom: 1px solid var(--color-bg-border);
  padding: 12px 16px;
}

.mac-dots { display: flex; gap: 8px; }
.mac-dots span {
  width: 12px; height: 12px; border-radius: 50%;
  box-shadow: inset 0 1px 2px rgba(255,255,255,0.1), inset 0 -1px 2px rgba(0,0,0,0.3);
}
.mac-dots span:nth-child(1) { background: #ff5f56; border: 1px solid #e0443e; }
.mac-dots span:nth-child(2) { background: #ffbd2e; border: 1px solid #dea123; }
.mac-dots span:nth-child(3) { background: #27c93f; border: 1px solid #1aab29; }

.ia-title {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-muted);
}

.ia-body { padding: 20px 24px; }

.ia-line {
  display: flex;
  gap: 14px;
  align-items: baseline;
  margin: 0 0 12px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.6;
}
.ia-line:last-child { margin-bottom: 0; }

.ia-role {
  flex-shrink: 0;
  width: 52px;
  text-align: right;
  font-weight: 600;
  font-size: 12px;
}
.ia-you { color: var(--color-brand); }
.ia-codex { color: var(--color-codex); }
.ia-claude { color: var(--color-plugin); }

.ia-text { color: var(--color-text-secondary); }
.ia-text code {
  font-family: var(--font-mono);
  color: var(--color-text-primary);
  background: var(--color-bg-hover);
  padding: 1px 5px;
  border-radius: var(--radius-sm);
  font-size: 0.92em;
}
.ia-warn { color: #fbbf24; }

.ia-caption {
  text-align: center;
  font-size: 13px;
  color: var(--color-text-muted);
  margin: 16px 0 0;
}
</style>
```

- [ ] **Step 3: Register the component** in `apps/docs/.vitepress/theme/index.ts`. Add the import after the `SetupTabs` import (line 5):

```ts
import InAction from "../components/InAction.vue";
```

and the registration inside `enhanceApp`, after the `app.component("SetupTabs", SetupTabs);` line:

```ts
    app.component("InAction", InAction);
```

- [ ] **Step 4: Lint and build.**

Run: `yarn lint && yarn docs:build`
Expected: Biome/tsc clean; docs build succeeds.

- [ ] **Step 5: Commit.**

```bash
git add apps/docs/.vitepress/components/InAction.vue apps/docs/.vitepress/theme/index.ts
git commit -m "$(printf 'docs(site): add InAction component for homepage in-action transcript\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Homepage rewrite (`index.md`) + homepage CSS

**Files:**
- Modify: `apps/docs/index.md` (hero frontmatter; add `<InAction />`; restructure cards)
- Modify: `apps/docs/.vitepress/theme/custom.css` (unified-featured card rule; Gemini "enterprise" tag)

- [ ] **Step 1: Replace the hero frontmatter** `text`/`tagline` (keep the three `actions` as-is) with benefit-first copy:

```yaml
hero:
  name: "Ask LLM"
  text: "Get a second opinion before you ship"
  tagline: "Let your AI assistant consult Codex, Antigravity, Ollama, or Gemini for an independent code review, a plan debate, or a fresh pair of eyes on a diff. Standard MCP — works in Claude Code, Cursor, Claude Desktop, and 40+ clients."
```

- [ ] **Step 2: Insert the in-action block** immediately after the opening `<div class="vp-doc home-content">` line, before the "Claude Code Plugin" section:

```html
<InAction />
```

- [ ] **Step 3: Restructure the "MCP Servers" card section.** Replace the current 4-card grid (Gemini, Codex, Ollama, Unified) with a Unified featured card + a 2×2 provider grid in canonical order, adding the missing Antigravity card and the Gemini enterprise tag. Replace the `<h2 class="section-title">MCP Servers</h2>` block and its `<div class="provider-grid">…</div>` with:

```html
<h2 class="section-title">MCP Servers</h2>

<div class="provider-grid">
  <a href="/ask-llm/providers/unified" class="provider-card unified-featured" data-provider="unified">
    <span class="provider-name">Unified — start here</span>
    <span class="provider-desc">All providers in one server. Auto-detects the CLIs you have installed and routes each request, or fans out to several at once.</span>
    <span class="provider-pkg">npx ask-llm-mcp</span>
  </a>
  <a href="/ask-llm/providers/codex" class="provider-card" data-provider="codex">
    <span class="provider-name">Codex</span>
    <span class="provider-desc">OpenAI's Codex CLI (GPT-5.5). Strongest code reasoning — the default workhorse reviewer.</span>
    <span class="provider-pkg">npx ask-codex-mcp</span>
  </a>
  <a href="/ask-llm/providers/antigravity" class="provider-card" data-provider="plugin">
    <span class="provider-name">Antigravity</span>
    <span class="provider-desc">Google Antigravity (agy) — a subscription-backed second opinion via your Google AI Pro/Ultra plan. The Gemini CLI successor.</span>
    <span class="provider-pkg">npx ask-antigravity-mcp</span>
  </a>
  <a href="/ask-llm/providers/ollama" class="provider-card" data-provider="ollama">
    <span class="provider-name">Ollama</span>
    <span class="provider-desc">Local models via Ollama. No API keys, fully private, zero cost — for code that can't leave your machine.</span>
    <span class="provider-pkg">npx ask-ollama-mcp</span>
  </a>
  <a href="/ask-llm/providers/gemini" class="provider-card" data-provider="gemini">
    <span class="provider-name">Gemini <span class="provider-tag">enterprise</span></span>
    <span class="provider-desc">Google's Gemini CLI. 1M+ token context for whole-codebase reads. Gated to enterprise seats since 2026-06-18.</span>
    <span class="provider-pkg">npx ask-gemini-mcp</span>
  </a>
</div>
```

(Note: the Antigravity card reuses `data-provider="plugin"` for its purple accent; there is no `antigravity` provider-glow token. Keep it unless Step 5 adds a dedicated token.)

- [ ] **Step 4: Refresh the feature-card copy** in the `.features-grid` so the "Quick Setup" / "Verify" / "Standard MCP" / "Multi-Turn Sessions" cards reference the second-opinion framing and the canonical provider order (e.g., the Verify card's example should use `Use ask-llm ping to test the connection`). Keep the SVG icons and grid markup; edit only the `<h3>`/`<p>` text.

- [ ] **Step 5: Add the CSS for the unified-featured card and the enterprise tag** to `custom.css`, after the existing `.provider-card.plugin-featured` rules (~line 568):

```css
.provider-card.unified-featured {
  grid-column: 1 / -1;
}
.provider-card.unified-featured .provider-name {
  color: var(--color-unified);
}

.provider-tag {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  vertical-align: middle;
  margin-left: 8px;
  padding: 2px 7px;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  background: var(--color-bg-hover);
  border: 1px solid var(--color-bg-border);
}
```

- [ ] **Step 6: Build and screenshot-verify.**

Run: `yarn docs:build`
Expected: clean build. Then (in Task 11) the dev-server screenshot confirms: hero reads benefit-first, `<InAction />` renders, 5 MCP cards present in order (Unified featured, then Codex/Antigravity/Ollama/Gemini), Gemini shows the `enterprise` tag.

- [ ] **Step 7: Verify Antigravity is now on the homepage.**

Run: `grep -c "providers/antigravity" apps/docs/index.md`
Expected: `1` (the new card).

- [ ] **Step 8: Commit.**

```bash
git add apps/docs/index.md apps/docs/.vitepress/theme/custom.css
git commit -m "$(printf 'docs(site): benefit-first homepage with in-action block and Antigravity card\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: README rewrite

**Files:**
- Modify: `README.md` (resequence; rewrite intro, Why, add In-action, replace Quick Start lead + provider table)

- [ ] **Step 1: Keep** the title, badges, and package table (lines 1-21) unchanged.

- [ ] **Step 2: Replace the intro paragraph** (current lines 23) with a benefit-first lead:

```markdown
**Get a second opinion before you ship.** Ask LLM lets your AI assistant — Claude Code, Cursor, Claude Desktop, or any of [40+ MCP clients](https://modelcontextprotocol.io/clients) — consult a *second* model to review your code, debate a plan, or catch a bug it might have missed. Pick the reviewer that fits: OpenAI **Codex** (GPT-5.5), Google **Antigravity** (`agy`), a local **Ollama** model, or **Gemini** (1M+ token context). Standard [MCP](https://modelcontextprotocol.io/), no prompt hacks.
```

- [ ] **Step 3: Keep the Gemini tier notice** (current line 25 blockquote) but condense it to three sentences and move it directly under the intro. Final text:

```markdown
> **⚠️ Gemini CLI is enterprise-gated (since 2026-06-18):** Google restricts Gemini CLI to Gemini Code Assist Standard/Enterprise seats — free, Google AI Pro, and Ultra accounts are no longer served. `ask-gemini-mcp` still installs, but on a non-enterprise account it surfaces actionable guidance instead of output. Free/Pro users: switch to **`ask-antigravity`** (the Google-sanctioned successor, subscription-backed via Google AI Pro/Ultra), **`ask-codex`**, or **`ask-ollama`**. [Announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)
```

- [ ] **Step 4: Replace the "## Why?" section** (current lines 27-33) with "## Why a second opinion?" framed as the three jobs:

```markdown
## Why a second opinion?

Your primary AI is confident — but confidence isn't correctness. A second model, with no stake in the first one's answer, catches what it missed.

- **Second opinion on code** — before you commit to an approach, have another model review it independently.
- **Debate a plan** — send an architecture proposal for critique, alternatives, and trade-off analysis.
- **Review a diff** — have a different model analyze your changes to surface issues your primary AI glossed over.
- **Read more than fits** — Gemini and Antigravity's large context windows ingest whole codebases at once.
- **Keep it local** — run reviews through Ollama when nothing can leave your machine.
```

- [ ] **Step 5: Add an "## In action" section** immediately after, before Quick Start:

````markdown
## In action

```text
You:    ask codex to review @src/auth.ts for security issues
Codex:  ⚠ verifyToken() compares tokens with === — not timing-safe (line 42)
        ⚠ the session cookie is missing a SameSite attribute
Claude: Good catches — applying both fixes to src/auth.ts.
```

One prompt. A second model reviews independently; your assistant applies the fix. No copy-paste between tools.
````

- [ ] **Step 6: Keep the Quick Start section** structure (Claude Code / Claude Desktop / other clients) unchanged — it already leads with the unified `ask-llm-mcp`. Verify the unified command is the first, un-collapsed option (it is).

- [ ] **Step 7: Add a "## Choose your reviewer" table** after Quick Start (before "## Claude Code Plugin"), in canonical order:

```markdown
## Choose your reviewer

| Provider | Best for | Model (default → fallback) | Notes |
|----------|----------|-----------------------------|-------|
| **Codex** | Code reasoning, targeted reviews, architecture critique | `gpt-5.5` → `gpt-5.5-mini` | Requires an OpenAI/Codex account |
| **Antigravity** | A subscription-backed second opinion; larger-context reads | `agy` (one-shot) | Google AI Pro/Ultra plan; experimental |
| **Ollama** | Private/local review, zero cost, offline | `qwen2.5-coder:7b` → `:1.5b` | Runs entirely on your machine |
| **Gemini** | Whole-codebase reads (1M+ tokens) | `gemini-3.1-pro-preview` → `gemini-3.5-flash` | ⚠️ Enterprise-gated since 2026-06-18 |
| **Unified (`ask-llm`)** | One install for all of the above; fan-out in parallel | routes per call | **Recommended** |
```

- [ ] **Step 8: Leave** the "Claude Code Plugin", "Prerequisites", "MCP Tools", "Usage Examples", "CLI Subcommands", "Models", "Documentation", "Contributing", and "License" sections in place. Update "Usage Examples" (current lines 177-183) so the first example uses Codex rather than Gemini, reflecting the reposition:

```text
ask codex to review the changes in @src/auth.ts for security issues
ask antigravity to debate this architecture plan: @docs/design.md
ask ollama to explain @src/config.ts (runs locally, no data sent anywhere)
ask gemini to summarize @. the current directory (1M+ context)
use multi-llm to compare what codex and gemini think about this approach
```

- [ ] **Step 9: Verify the README leads with value, not Gemini.**

Run: `grep -n "second opinion" README.md | head -1` and `awk 'NR>=22 && NR<=40' README.md`
Expected: the benefit-first intro and "Why a second opinion?" appear near the top; Gemini is no longer the first provider named in the intro sentence.

- [ ] **Step 10: Commit.**

```bash
git add README.md
git commit -m "$(printf 'docs: rewrite README to lead with second-opinion value, reposition providers\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Provider pages — "Best for / Not for" framing + Gemini tier banner

**Files:**
- Modify: `apps/docs/providers/codex.md`, `antigravity.md`, `ollama.md`, `gemini.md`, `unified.md` (add a framing block at the top of each, under the H1)

- [ ] **Step 1: Read each provider page's current top** to find the insertion point (under the H1, before the first section).

Run: `for f in codex antigravity ollama gemini unified; do echo "=== $f ==="; head -20 apps/docs/providers/$f.md; done`
Expected: shows the H1 + intro of each; insert the framing block immediately after the intro paragraph.

- [ ] **Step 2: Add the Codex framing block** to `codex.md`:

```markdown
> **Best for:** targeted code reasoning, architecture critique, and security review of specific files. The default workhorse reviewer.
> **Not for:** whole-repository reads beyond its context window (use Gemini/Antigravity), or fully offline/air-gapped use (it's a hosted model — use Ollama).
```

- [ ] **Step 3: Add the Antigravity framing block** to `antigravity.md`:

```markdown
> **Best for:** a subscription-backed second opinion if you have a Google AI Pro/Ultra plan, and larger-context reads. The Google-sanctioned successor to Gemini CLI.
> **Not for:** fine-grained per-edit automation — it's one-shot and experimental. For continuous review, use Codex via `codex-pair`.
```

- [ ] **Step 4: Add the Ollama framing block** to `ollama.md`:

```markdown
> **Best for:** private, air-gapped review of code that can't leave your machine — zero cost, no API keys, works offline.
> **Not for:** frontier-level reasoning. Local 7B models are weaker than hosted frontier models; use Codex when you need maximum capability.
```

- [ ] **Step 5: Add the Gemini tier banner + framing block** to `gemini.md` (the banner replaces or augments any existing top notice — use a VitePress `warning` container so it's visually prominent):

```markdown
::: warning Enterprise-gated since 2026-06-18
Google restricts Gemini CLI to Gemini Code Assist Standard/Enterprise seats. Free, Google AI Pro, and Ultra accounts are no longer served. `ask-gemini-mcp` still installs and launches, but on a non-enterprise account it surfaces actionable guidance instead of output. The Google-sanctioned successor is **Antigravity CLI (`agy`)** — see [Antigravity](/providers/antigravity).
:::

> **Best for:** whole-codebase reads using the 1M+ token context window, if you have an eligible enterprise seat.
> **Not for:** most users since 2026-06-18 (see the notice above). For large-context reads without an enterprise seat, use Antigravity.
```

- [ ] **Step 6: Add the Unified framing block** to `unified.md`:

```markdown
> **Best for:** installing once and letting the orchestrator route each request to whatever provider you have — or fan the same prompt out to several at once. The recommended starting point.
> **Not for:** nothing in particular — if you're unsure which provider to install, start here.
```

- [ ] **Step 7: Build and verify the Gemini banner renders.**

Run: `yarn docs:build && grep -n "Enterprise-gated" apps/docs/providers/gemini.md`
Expected: clean build; the warning container line is present.

- [ ] **Step 8: Commit.**

```bash
git add apps/docs/providers/
git commit -m "$(printf 'docs(providers): add Best-for/Not-for framing and Gemini enterprise banner\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: Getting-started trio — distinct roles, de-dupe

**Files:**
- Modify: `apps/docs/getting-started.md` (frame as "Quick Start"; hand off to Installation/First Steps)
- Modify: `apps/docs/installation.md` (frame as the comprehensive reference; reflect provider order)
- Modify: `apps/docs/first-steps.md` (frame as verify→first-prompt→parallel; reflect provider order)

- [ ] **Step 1: Read all three pages in full** to map overlapping content.

Run: `for f in getting-started installation first-steps; do echo "=== $f ==="; cat apps/docs/$f.md; done`
Expected: identify which install/verify content is duplicated so each page keeps one clear role.

- [ ] **Step 2: Edit `getting-started.md` ("Quick Start").** Keep the concise 3-step flow. At the end, add a handoff:

```markdown
## Next steps

- Need every install method and client config? See [Installation](/installation).
- Set up and want to send your first prompt? See [First Steps](/first-steps).
```
Where the "which provider first?" tip lists providers, reorder to Codex → Antigravity → Ollama → Gemini (Gemini noted as enterprise-gated).

- [ ] **Step 3: Edit `installation.md` ("Installation").** Position it as the comprehensive reference (all install methods: npx / `npm i -g` / per-provider; all clients). Remove any duplicated "verify" content (that now lives in First Steps) and link to it. Ensure provider examples follow canonical order and Gemini carries the enterprise note. Keep the `/installation` route (the FAQ links it).

- [ ] **Step 4: Edit `first-steps.md` ("First Steps").** Position it as: verify (`ping` / `doctor`) → send your first prompt (one concrete example per the second-opinion framing) → try parallel dispatch (`multi-llm`). Remove duplicated install instructions; link back to Quick Start / Installation. Reorder any provider mentions.

- [ ] **Step 5: Build and verify no dangling links between the three.**

Run: `yarn docs:build && grep -rnE "/getting-started|/installation|/first-steps" apps/docs/getting-started.md apps/docs/installation.md apps/docs/first-steps.md`
Expected: clean build; cross-links resolve to real routes.

- [ ] **Step 6: Commit.**

```bash
git add apps/docs/getting-started.md apps/docs/installation.md apps/docs/first-steps.md
git commit -m "$(printf 'docs(getting-started): give Quick Start/Installation/First Steps distinct roles\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: Concepts pages refresh

**Files:**
- Modify: `apps/docs/concepts/how-it-works.md`, `concepts/models.md`, `concepts/sandbox.md`

- [ ] **Step 1: `how-it-works.md`.** Keep the Mermaid diagram and the ADR-cited "what's inside" list. Edit only: (a) the opening sentence to mention providers in canonical order (Codex, Antigravity, Ollama, Gemini) rather than "Gemini CLI, Codex CLI, Ollama"; (b) the "Natural Language Workflow" bullets to keep the second-opinion framing consistent. Do not touch the ADR links or diagram source.

- [ ] **Step 2: `models.md`.** Verify model names/fallbacks against `packages/*/src/constants.ts` (Gemini `gemini-3.1-pro-preview`→`gemini-3.5-flash`; Codex `gpt-5.5`→`gpt-5.5-mini`; Ollama `qwen2.5-coder:7b`→`:1.5b`). Fix any drift; reorder any provider list to canonical order.

Run (reference): `grep -rnE "gemini-3|gpt-5|qwen2.5" packages/*/src/constants.ts`

- [ ] **Step 3: `sandbox.md`.** Clarity pass only — tighten the intro to state up front what sandbox mode is and why it matters. Preserve all technical detail.

- [ ] **Step 4: Build and commit.**

```bash
yarn docs:build
git add apps/docs/concepts/
git commit -m "$(printf 'docs(concepts): refresh how-it-works/models/sandbox for clarity and provider order\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 8: Usage pages — clarity + promote Strategies to Recipes

**Files:**
- Modify: `apps/docs/usage/how-to-ask.md`, `usage/multi-turn-sessions.md`
- Modify: `apps/docs/usage/strategies-and-examples.md` (reframe as task-oriented "Recipes")

- [ ] **Step 1: Read the three usage pages.**

Run: `for f in how-to-ask multi-turn-sessions strategies-and-examples; do echo "=== $f ==="; cat apps/docs/usage/$f.md; done`
Expected: understand current structure before editing.

- [ ] **Step 2: `how-to-ask.md`.** Clarity pass: keep the parameter reference; ensure examples lead with Codex/second-opinion and follow canonical provider order.

- [ ] **Step 3: `multi-turn-sessions.md`.** Tighten the intro to state the payoff first ("continue a review into a fix without re-sending context"). Preserve the `sessionId` mechanics.

- [ ] **Step 4: `strategies-and-examples.md` → Recipes.** Reframe the page around the three jobs as copy-paste recipes. Keep the H1/route but lead with a recipe structure, each with a concrete prompt:
  - **Recipe: Second opinion on an approach** — `ask codex to review my approach in @src/...`
  - **Recipe: Debate an architecture plan** — `ask antigravity to critique this plan: @docs/...`
  - **Recipe: Review a diff before committing** — pipe the diff / `@`-reference changed files
  - **Recipe: Read a whole codebase** — `ask gemini to map @. ` (note enterprise gating)
  - **Recipe: Private/local review** — `ask ollama to review @src/... (nothing leaves your machine)`
  Preserve any existing valuable examples; reorganize under these headings.

- [ ] **Step 5: Build and commit.**

```bash
yarn docs:build
git add apps/docs/usage/
git commit -m "$(printf 'docs(usage): clarity pass and reframe strategies as task-oriented recipes\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 9: Plugin pages clarity

**Files:**
- Modify: `apps/docs/plugin/overview.md`, `plugin/skills.md`, `plugin/hooks.md`, `plugin/agents.md`

- [ ] **Step 1: `overview.md`.** Keep all tables (Skills/Agents/Hooks/CLI). Rewrite only the opening paragraph (current: "The `@ask-llm/plugin` package integrates…") to lead with the three jobs in a Claude Code context:

```markdown
The **Ask LLM plugin** brings the second opinion into Claude Code itself: slash-command reviews (`/codex-review`, `/multi-review`), multi-model brainstorming (`/brainstorm`), and an opt-in continuous review hook (`codex-pair`) that checks every edit as you make it.
```

- [ ] **Step 2: `skills.md`, `hooks.md`, `agents.md`.** Clarity pass for consistency with the overview's framing and canonical provider order. Preserve all command/flag/behavior detail and ADR links.

- [ ] **Step 3: Build and commit.**

```bash
yarn docs:build
git add apps/docs/plugin/
git commit -m "$(printf 'docs(plugin): lead plugin pages with the second-opinion workflow\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 10: Resources — troubleshooting + FAQ (add Gemini-gated entry)

**Files:**
- Modify: `apps/docs/resources/troubleshooting.md`, `resources/faq.md`

- [ ] **Step 1: `troubleshooting.md`.** Freshness pass: verify each symptom/fix still matches current behavior; ensure the Gemini section mentions the enterprise gating as a possible cause of "no output" and points to Antigravity/Codex.

- [ ] **Step 2: Add a FAQ entry** to `faq.md` (near the top, after the intro) answering the most likely new question:

```markdown
### Why is Gemini gated now, and what should I use instead?

As of 2026-06-18, Google restricts Gemini CLI to Gemini Code Assist Standard/Enterprise seats — free, Google AI Pro, and Ultra accounts are no longer served. `ask-gemini-mcp` still installs, but a non-enterprise account will see guidance instead of output. Use **Antigravity** (`ask-antigravity` — the Google-sanctioned successor, subscription-backed via Google AI Pro/Ultra), **Codex** (`ask-codex`), or **Ollama** (`ask-ollama`) instead. See [Antigravity](/providers/antigravity).
```

- [ ] **Step 3: Verify the existing `/installation` link still resolves** (it lives in this file at ~line 61).

Run: `grep -n "/installation" apps/docs/resources/faq.md`
Expected: the link is present and `/installation` is a real route (wired into the sidebar in Task 1).

- [ ] **Step 4: Build and commit.**

```bash
yarn docs:build
git add apps/docs/resources/
git commit -m "$(printf 'docs(resources): add Gemini-gating FAQ entry, refresh troubleshooting\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 11: Hygiene + final verification

**Files:**
- Modify: `docs/DECISIONS.md` (add ADR-124), `docs/ROADMAP.md` (note the run)

- [ ] **Step 1: Add ADR-124 to `docs/DECISIONS.md`** matching the existing ADR format, recording: the positioning shift (Gemini-first → provider-neutral, Codex/Antigravity-forward; Gemini flagged enterprise-gated), the homepage in-action block + Antigravity card, the orphan-page reconciliation (Quick Start/Installation/First Steps roles), and the WCAG AA muted-contrast fix. Reference this plan and the spec.

- [ ] **Step 2: Update `docs/ROADMAP.md`** with a dated entry summarizing the docs/README/UI-UX overhaul (per the project CLAUDE.md "update ROADMAP after every run").

- [ ] **Step 3: Full clean build.**

Run: `yarn docs:build`
Expected: no errors, no dead-link warnings.

- [ ] **Step 4: Lint (covers the Vue component).**

Run: `yarn lint`
Expected: Biome + tsc clean.

- [ ] **Step 5: Screenshot the running site** (desktop ~1280px and mobile ~390px).

Run: `yarn docs:dev` (background), then capture the homepage with Playwright/Chrome MCP.
Verify: benefit-first hero; `<InAction />` transcript renders with role colors; 5 MCP cards (Unified featured + Codex/Antigravity/Ollama/Gemini 2×2); Gemini `enterprise` tag visible; muted text is legible; cards stack cleanly on mobile; focus-visible ring shows on keyboard-tabbing a card.

- [ ] **Step 6: Internal link audit.**

Run: `grep -rnE "\]\(/[a-z]" apps/docs --include="*.md" | grep -vE "/(providers|plugin|concepts|usage|resources|getting-started|installation|first-steps|ask-llm)" | head`
Expected: no links to nonexistent routes (empty or only known-good results).

- [ ] **Step 7: Dogfood (optional, on-brand).** Run `/codex-review` (or `ask-codex`) on the new `README.md` + `apps/docs/index.md` copy for a second opinion; fold in any high-confidence clarity fixes.

- [ ] **Step 8: Commit hygiene docs.**

```bash
git add docs/DECISIONS.md docs/ROADMAP.md
git commit -m "$(printf 'docs: record ADR-124 (docs reposition) and roadmap entry\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

- [ ] **Step 9: Open the PR** (per project workflow — wait for CI, review feedback before merge).

```bash
git push -u origin docs/readme-uiux-rewrite
gh pr create --title "docs: README + docs-site rewrite & UI/UX refinement" --body "<summary of the reposition, in-action block, Antigravity card, de-orphaning, and a11y fix; links the spec and this plan>"
```

---

## Notes for the implementer

- **No code/behavior changes.** If any task tempts you to change server/plugin code, stop — that's out of scope (spec §4).
- **Preserve reference tables** (tools, models, env vars). Clarity work targets prose and ordering, not stripping detail.
- **Provider order is canonical everywhere:** Codex → Antigravity → Ollama → Gemini → Unified.
- **Facts to keep accurate:** Gemini gating date is **2026-06-18**; default models per Task 7 Step 2; the `/installation` route must survive (faq links it).
- **Each task is independently committable** and leaves the docs building cleanly — safe to stop between tasks.
