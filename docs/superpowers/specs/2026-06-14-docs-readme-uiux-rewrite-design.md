# Docs + README rewrite & docs-site UI/UX refinement

- **Date:** 2026-06-14
- **Status:** Approved design (brainstormed)
- **Issue:** none (maintainer-requested documentation overhaul)
- **ADR:** ADR-124 (added during implementation) — records the positioning shift + orphan-page reconciliation

## 1. Problem / Motivation

The README and the VitePress docs site (`apps/docs/`) are comprehensive and visually
polished, but three structural problems blunt their value to a first-time reader:

1. **Positioning lags reality.** Every surface (README intro, homepage hero, nav,
   sidebar, provider cards) leads with **Gemini first**. But the project's own notice
   says Gemini CLI becomes **enterprise-only on 2026-06-18** — free/Pro/Ultra accounts
   are no longer served. Leading with a provider most readers can no longer use
   undercuts the pitch on the first screen.
2. **Mechanism before benefit.** The homepage hero leads with "AI-to-AI collaboration
   via MCP" (protocol jargon). The actual value — *get a second opinion before you
   commit, debate a plan, catch a bug another model missed* — is buried in a "Why?"
   bullet list partway down the README and is absent from the homepage's first screen.
3. **No "see it in action."** A reader never sees a concrete prompt → outcome until
   they dig into a sub-page. The request-flow Mermaid diagram lives only on
   `concepts/how-it-works`.

Secondary findings from the audit:

- **Antigravity has no homepage card** despite being the designated Gemini successor
  (subscription-backed via `agy`). It only appears in the nav dropdown and its own page.
- **Orphaned-from-sidebar pages:** `apps/docs/installation.md` and
  `apps/docs/first-steps.md` exist on disk and hold substantive, distinct content
  (a fuller install reference; a verify + first-prompt + parallel-dispatch guide) but are
  **not in the `config.ts` sidebar** (which lists only `/` and `/getting-started` under
  "Getting Started"). Note: `installation.md` *is* linked in-content from `faq.md:61`
  (`[Installation](/installation)`), so it cannot simply be deleted; `first-steps.md` has
  no inbound route links. Their content overlaps `getting-started.md` (all three touch
  install/verify), so roles must be disambiguated, not duplicated.
- **Accessibility:** `--color-text-muted: #52525b` on `--color-bg: #0a0a0b` is ≈2.5:1
  contrast — below WCAG AA (4.5:1 for normal text, 3:1 for large/UI). It is used for
  real small text (`.next-step-desc` 12px, `.provider-pkg`, sidebar level-0 labels).

## 2. Decision

Three positioning decisions were locked during brainstorming (maintainer, 2026-06-14):

| Axis | Decision |
|---|---|
| **Provider positioning** | **Provider-neutral, Codex/Antigravity-forward.** Stop leading with Gemini. Present providers by use-case fit. Gemini stays fully documented but flagged as enterprise-gated. |
| **Lead value** | **AI peer review / second opinion.** Both README and homepage lead with the maintainer's real use cases: second opinion, debate a plan, review a diff. |
| **UI/UX ambition** | **Refine the current dark/mono theme.** Keep the brand and structure; fix hierarchy, add an in-action example, fix accessibility, polish. No light mode, no redesign. |

**Scope approach: B — Moderate restructure.** Keep the existing page set (no deletions
beyond reconciling the two orphans); reorder providers by fit; add the missing
Antigravity homepage card; restructure the homepage so value/jobs precede the provider
grid; add a concrete in-action example; strengthen `strategies-and-examples` into a
"Recipes" page. Rejected: **A (surgical)** leaves the Gemini-first ordering and missing
Antigravity card unaddressed; **C (major overhaul)** risks broken links/SEO and discards
polished structure for no decided benefit.

## 3. Design

### 3.1 Narrative spine (shared by README + homepage)

Both surfaces follow one arc, so the message is consistent wherever a reader lands:

1. **Hook** — the job, not the protocol: *"Your AI is confident. Is it right? Get a
   second opinion from another model before you ship."*
2. **What it is** (one sentence) — MCP servers + a Claude Code plugin that let your
   assistant consult Codex, Antigravity, Ollama, or Gemini.
3. **See it in action** — one concrete transcript: `ask codex to review @src/auth.ts for
   security issues` → findings → Claude applies the fix.
4. **The three jobs** — Second opinion · Debate a plan · Review a diff. (Plus: huge-context
   reads, private/local with Ollama.)
5. **Pick your reviewer** — providers by fit, not by brand.
6. **Install** (unified first) → **Plugin** (power-user layer) → reference.

### 3.2 Provider ordering (applied everywhere)

Current order: `Gemini, Codex, Ollama, Antigravity, Unified`.
**New order (by use-case fit for the median post-2026-06-18 reader):**

1. **Codex** — GPT-5.5; strongest code reasoning; the default workhorse reviewer.
2. **Antigravity** — subscription-backed (`agy`), the Gemini successor; large context.
3. **Ollama** — local, private, zero cost.
4. **Gemini** — huge 1M+ context, **but enterprise-gated as of 2026-06-18** (flagged).
5. **Unified (`ask-llm`)** — aggregator; the recommended install ("start here / all of them").

Applies to: README "choose your reviewer" table, `config.ts` nav dropdown + sidebar,
homepage cards.

### 3.3 README rewrite (section order)

Badges + package table (kept, lightly trimmed) → **benefit-first intro** (the hook) →
**tight Gemini tier callout** (kept, condensed from the current paragraph) → **"Why a
second opinion?"** (the three jobs) → **In action** (transcript block) → **Quick Start**
(unified `ask-llm-mcp` first; per-client details in `<details>`) → **Choose your
reviewer** (use-case table, new order) → **Claude Code Plugin** → **MCP Tools** (reference
table, kept) → **CLI Subcommands** (kept) → **Models** (kept) → Documentation /
Contributing / License. *Same facts, resequenced so value leads and reference follows.*

### 3.4 Docs site — IA changes (`apps/docs/.vitepress/config.ts`)

- **Nav "Providers" dropdown** and **sidebar "Providers" group**: reorder to Codex,
  Antigravity, Ollama, Gemini, Unified (per §3.2).
- **De-orphan the two unlisted pages** by giving the "Getting Started" sidebar group a
  clear progression: Overview (`/`) → Quick Start (`/getting-started`) → Installation
  (`/installation`) → First Steps (`/first-steps`). This wires both pages into navigation
  and keeps the `faq.md` → `/installation` link valid.
- No new top-level sections. No renamed routes (preserve links/SEO).

### 3.5 Docs site — homepage (`apps/docs/index.md`)

- **Hero** (frontmatter): benefit-first `text`/`tagline` matching the §3.1 hook.
- **New "In action" block** directly under the hero — a terminal-style transcript
  reusing the visual language of `SetupTabs.vue` (mac-dots header, mono body): one
  prompt → provider findings → Claude applies fix. Implemented as a small scoped Vue
  component (`InAction.vue`) or static styled markup; component preferred for reuse.
- **Card layout** restructured to two featured cards + a clean 2×2 provider grid:
  - "Claude Code Plugin" — Plugin featured card (kept).
  - "MCP Servers" — **Unified featured card** ("All providers in one server — start
    here") + 2×2 grid: **Codex, Antigravity, Ollama, Gemini**. This *adds the missing
    Antigravity card* and avoids an awkward 5-card row.
  - Gemini card gets a subtle inline "enterprise" tag.
- "Installation" (`SetupTabs`), "Features", and "Explore the Docs" sections retained;
  copy refreshed to the new framing.

### 3.6 Docs site — per-page content plan

| Page | Change | Key edits |
|---|---|---|
| `index.md` | Rewrite | §3.5 |
| `getting-started.md` | Clarity pass + role | "Quick Start": keep the concise 3-step flow; reflect provider reorder; hand off to Installation / First Steps |
| `installation.md` | **De-orphan + role** | Add to sidebar as "Installation" (the comprehensive install/clients/config reference); de-dupe vs Quick Start; keep `/installation` route (faq links it) |
| `first-steps.md` | **De-orphan + role** | Add to sidebar as "First Steps" (verify → first prompt → parallel dispatch); de-dupe vs Quick Start |
| `concepts/how-it-works.md` | Light refresh | Keep diagram; reorder provider mentions; benefit framing |
| `concepts/models.md` | Freshness pass | Verify model names/fallbacks vs constants |
| `concepts/sandbox.md` | Clarity pass | Tighten |
| `providers/codex.md` | Add framing | "Best for / Not for" header block |
| `providers/antigravity.md` | Add framing | "Best for / Not for"; subscription note |
| `providers/ollama.md` | Add framing | "Best for / Not for"; privacy emphasis |
| `providers/gemini.md` | Add framing + **tier banner** | Prominent enterprise-gated status banner at top |
| `providers/unified.md` | Clarity pass | Position as "start here" |
| `plugin/overview.md` | Clarity pass | Keep tables; tighten intro to the three jobs |
| `plugin/{skills,hooks,agents}.md` | Clarity pass | Consistency with overview |
| `usage/how-to-ask.md` | Clarity pass | Parameter reference; examples in new order |
| `usage/multi-turn-sessions.md` | Clarity pass | Tighten |
| `usage/strategies-and-examples.md` | **Promote → Recipes** | Reframe as copy-paste workflows for the three jobs |
| `resources/troubleshooting.md` | Freshness pass | Verify against current behavior |
| `resources/faq.md` | Freshness pass | Add "Why is Gemini gated now?" entry |

### 3.7 UI/UX refinements (`apps/docs/.vitepress/theme/`)

- **Accessibility (must-fix):** raise `--color-text-muted` so its small-text uses meet
  WCAG AA. Target ≥4.5:1 against `--color-bg` for body/secondary/small text; ≥3:1 for
  purely decorative/large. Pick the smallest bump that passes (verify the exact hex with
  a contrast check; preserve the muted/secondary hierarchy — do not flatten to
  `--color-text-secondary`). Likely lands near `#8a8a94`.
- **Homepage CSS:** support the two-featured-card + 2×2 layout (`custom.css`
  `.provider-grid` / `.plugin-featured` / new unified-featured rule); style the in-action
  block and the Gemini "enterprise" tag using existing design tokens.
- **Polish:** verify focus-visible states still read on the clip-path cards after layout
  changes; confirm reduced-motion and mobile stacking survive; keep all new color use on
  existing tokens (no new ad-hoc hex except the muted bump).

### 3.8 Voice & style

- Benefit-first, second person, active voice. Lead each page with what the reader gets.
- Keep factual reference tables intact (tools, models, env vars) — clarity work targets
  prose and ordering, not stripping reference detail.
- Preserve all working internal links and routes (no renames).

## 4. Out of scope (YAGNI)

- No light mode / no theme toggle (force-dark stays).
- No new docs framework, nav model, or route restructuring.
- No code/behavior changes to the MCP servers or plugin — **documentation only**.
- No new marketing copy beyond the docs/README surfaces.
- Package-level `packages/*/README.md` files: out of scope unless a quick consistency
  nudge is trivial (root README + docs site are the focus).

## 5. Verification & acceptance

1. `yarn docs:build` completes clean (no broken-link / dead-anchor warnings).
2. `yarn lint` stays green (Biome + tsc) — relevant if `InAction.vue` is added.
3. Run the docs dev server and screenshot **desktop + mobile** widths; confirm: hero
   reads benefit-first, in-action block renders, 5 provider cards present in new order,
   Antigravity card exists, Gemini tier flagged.
4. Contrast check the new `--color-text-muted` value against `--color-bg` (≥4.5:1 small).
5. Internal link audit: no references to removed/renamed orphan pages remain dangling.
6. **Dogfood (optional but on-brand):** run `/codex-review` (or `ask-codex`) on the new
   README + homepage copy for a second opinion before finalizing.

**Acceptance:** a first-time reader on the README top or homepage first screen
understands *what the tool does for them* and *sees one concrete example* without
scrolling into reference material; no surface leads with Gemini; Antigravity is present
on the homepage; the build is clean and the muted-text contrast passes AA.

## 6. Docs hygiene (per project CLAUDE.md)

- Add an ADR to `docs/DECISIONS.md` recording the positioning shift (Gemini-first →
  provider-neutral/Codex-Antigravity-forward) and the orphan-page reconciliation.
- Update `docs/ROADMAP.md` after the run.
- This spec stays in `docs/superpowers/specs/` (never deleted).
