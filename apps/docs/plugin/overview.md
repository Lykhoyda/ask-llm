---
description: Claude Code plugin for AI-to-AI collaboration. Multi-provider code review, brainstorming agents, and the continuous codex-pair review hook.
---

# Claude Code Host

`@ask-llm/mcp` is the canonical multi-host package and owns the Claude Code marketplace assets; `@ask-llm/plugin` remains a dependent bridge. This page covers the Claude Code adapter. For the Cursor-adapted pair skills (`/codex-pair`, `/grok-pair`) through Cursor Agent Skills/MCP, see [Cursor Agent Host](/plugin/cursor); for native Pi tools and lifecycle events, see [Pi Host Support](/plugin/pi).

The **Ask LLM plugin** brings the second opinion into Claude Code itself: slash-command reviews (`/codex-review`, `/multi-review`), multi-model brainstorming (`/brainstorm`), and an opt-in continuous review hook (`codex-pair`) that checks every edit as you make it. Under the hood it adds review skills, brainstorm agents, and automated hooks.

## Installation

### Through setup (recommended)

Follow the [Quick Start](https://github.com/Lykhoyda/ask-llm#quick-start) to install through setup. See [Command compatibility](https://github.com/Lykhoyda/ask-llm/blob/main/packages/llm-mcp/README.md#command-compatibility) for workflow installation and removal, and [Skills](/plugin/skills) for portable names and compatibility aliases. To install only the Claude Code plugin by hand:

```bash
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

### From Source (development)

```bash
git clone https://github.com/Lykhoyda/ask-llm.git
cd ask-llm
yarn install && yarn build
claude --plugin-dir ./packages/llm-mcp
```

### MCP Servers

The recommended cross-provider server is `@ask-llm/mcp`; follow the [Quick Start](https://github.com/Lykhoyda/ask-llm#quick-start) to register it. Split provider packages (`@ask-llm/codex-mcp`, `@ask-llm/grok-mcp`, and the others) remain an advanced optimization for a richer per-provider tool surface.

The Claude Code plugin itself still ships only the Codex MCP registration used by review and pairing commands. Fully restart Claude Code after installation or upgrade, then run `/mcp`; `plugin:ask-llm:codex` should be connected and expose the exact `ask-codex` capability. Plugin agents and skills prefer that bundled `ask-codex` leaf, then a fully pinned unified `ask-llm` call (`provider: "codex"` plus model and Codex options), then the disclosed `codex exec` fallback.

`/grok-pair` relies on user-scoped servers instead of plugin bundling. Install the unified Ask LLM server (recommended: it exposes model-neutral `ask-cursor-agent` and the unified `ask-llm` tool, which pair skills call only with provider, harness, exact model, and effort pinned) and, optionally, the split Grok server for the `ask-grok` leaf:

```bash
ask-llm setup --host claude
claude mcp add --scope user grok -- npx -y @ask-llm/grok-mcp
```

Existing user-scoped Codex registrations remain supported if you prefer the shorter `codex:ask-codex` name. Register the other provider servers at user scope only when you want their split leaves:

```bash
claude mcp add --scope user antigravity -- npx -y @ask-llm/antigravity-mcp
claude mcp add --scope user ollama -- npx -y @ask-llm/ollama-mcp
claude mcp add --scope user gemini -- npx -y @ask-llm/gemini-mcp
```

If Codex registration is missing, provision the unified server first (`ask-llm setup --host claude`) or the split Codex leaf with `claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp`. If `/mcp` lists the server but it is disconnected, run `ask-llm doctor` and fully restart Claude Code. `/sol-review` preserves source-plugin and session-local MCP/settings context when reading the active `claude mcp list` inventory, treats failed health, an incomplete unified schema, or an MCP transport failure as unavailable, and discloses the explicit `codex exec` fallback.

## What's Included

### Skills (Slash Commands)

| Command | Provider | Description |
|---------|----------|-------------|
| `/multi-review` | Antigravity + Codex | Parallel review with 4-phase validation pipeline and consensus highlighting |
| `/gemini-review` | Gemini | Get a second opinion on your current changes |
| `/codex-review` | Codex | Get a second opinion from GPT-6 Astra |
| `/fable-review` | Fable | Native isolated review, pinned to Fable |
| `/sol-review` | GPT-6 Sol | Model-pinned review through Codex |
| `/grok-review` | Grok | Explicit xAI API or Grok CLI review; metered/plan-aware, no harness or model fallback |
| `/grok-pair` | Grok | Consent-gated iterative reviewer through exact Cursor Agent, xAI API, or Grok CLI route; no fallback |
| `/codex-pair` | Codex | Continuous Claude hook dashboard; Cursor uses the separate on-demand persisted-session adapter |
| `/ollama-review` | Ollama | Local review, no data leaves your machine |
| `/antigravity-review` | Antigravity | Subscription-backed second opinion via Google `agy` (experimental) |
| `/brainstorm` | Explicit panel + Claude Opus evidence | Supports exact provider/harness/model routes, including a no-Gemini Grok + GPT-6 Sol panel through Cursor Agent; partial failures never become consensus |
| `/brainstorm-all` | All + Claude Opus | Requests all five external providers plus Claude Opus research; see the [Antigravity execution gate](/providers/antigravity) |
| `/compare` | Multi (configurable) | Side-by-side raw responses from selected providers: no synthesis, no consensus extraction. Use when you want to see how each provider phrases the same answer |

> `/codex-review` and `/sol-review` require an installed, authenticated Codex CLI; the plugin supplies their MCP registration. `/grok-review`, `/ollama-review`, `/antigravity-review`, and bare-provider `/brainstorm` routes require their respective configured tools and credentials. Routed `/brainstorm ...@cursor-agent:<exact-id>` participants use the packaged model-neutral Cursor runner and require an authenticated Cursor Agent CLI; they do not silently use provider MCP tools as fallback.
>
> Looking for **continuous background review** (not a slash command)? See [`codex-pair`](/plugin/codex-pair), a PostToolUse hook that runs Codex against every file edit when a project has opted in via a marker file. It's the recall-first complement to `/codex-review`.

### Agents

| Agent | Description |
|-------|-------------|
| `gemini-reviewer` | Isolated Gemini code review with confidence-based filtering |
| `codex-reviewer` | Isolated Codex code review with confidence-based filtering |
| `fable-reviewer` | Native read-only Fable review with source validation |
| `sol-reviewer` | GPT-6 Sol review through Codex with source validation |
| `grok-reviewer` | Grok review through the selected API/CLI harness with source validation and no fallback |
| `ollama-reviewer` | Local Ollama code review, no data leaves your machine |
| `antigravity-reviewer` | Subscription-backed Antigravity (`agy`) code review, experimental |
| `brainstorm-coordinator` | Researches before dispatch, then synthesizes explicit participants. In exact Grok + Sol mode Claude is a non-voting verifier and two-model consensus requires both requested models to succeed. |

### Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| `codex-pair` PostToolUse | After every Edit/Write/MultiEdit | **Opt-in.** Self-gates on `.codex-pair/context.md` marker file. Zero cost without the marker. With marker: edits are debounced into a settle window, a detached worker reviews the settled file state, and HIGH/MED verdicts surface to Claude on a later edit, the next user prompt, or at turn end. See [Codex Pair](/plugin/codex-pair) for opt-in steps and cost characteristics |
| `codex-pair-prompt-drain` UserPromptSubmit | On every user prompt | Drains queued codex-pair verdicts that finished mid-turn so they reach Claude without waiting for the next edit |
| `codex-pair-stop-gate` Stop | At turn end | Drains remaining queued verdicts (no opt-in needed). With `blockOn: HIGH` in the marker frontmatter (opt-in, default OFF), blocks turn-end while unaddressed HIGH findings or in-flight reviews remain |
| `codex-pair-session` SessionStart / SessionEnd | At Claude session boundary | Manages pause, debounce, and broker state; see [Codex Pair](/plugin/codex-pair) |

The hook has zero workspace imports, required so it runs from marketplace `git-subdir` installs that don't run `npm install`. A previous `PreToolUse` Gemini-review pre-commit hook was removed because continuous codex-pair review covers the same need with higher recall; use `/gemini-review` or `/codex-review` on demand for explicit pre-commit review instead.

### CLI Binaries (source builds only)

These commands are available after cloning and building the plugin locally. Marketplace `git-subdir` installs do not build or ship the generated `dist/` binaries.

| Command | Description |
|---------|-------------|
| `ask-gemini-run` | Pipe code or prompts directly to Gemini CLI |
| `ask-codex-run` | Pipe code or prompts directly to Codex CLI |
| `ask-grok-run` | Pipe code or prompts to the explicitly configured Grok API/CLI harness |
| `ask-brainstorm-run` | Run the exact Grok + GPT-6 Sol panel with repeated `provider@harness:exact-model-id` participant specs and structured partial-failure output |
| `ask-ollama-run` | Pipe code or prompts directly to local Ollama |

## How It Works

The plugin uses several Claude Code integration points:

1. **`plugin.json` + `.mcp.json`**: Explicitly declares the Codex MCP component for Claude Code plugin sessions (see [Installation](#installation)); Cursor/Grok routes use user-scoped `@ask-llm/mcp` and `@ask-llm/grok-mcp` registrations, and the separate `.cursor-plugin/plugin.json` + unified-only `mcp.json` adapter uses Cursor's supported surfaces
2. **Skills** (`skills/`): User-invocable slash commands that trigger review or brainstorm workflows
3. **Agents** (`agents/`): Handle the actual interaction with each provider using confidence-based filtering (80%+ threshold). Agents read `CLAUDE.md` for project conventions when available.
4. **Hooks** (`hooks/`): Run the opt-in codex-pair continuous review pipeline: per-edit PostToolUse reviews, verdict drains on user prompts and at turn end, the opt-in Stop gate, and session lifecycle
5. **Source-build CLI binaries** (`src/`): After a local build/link, enable piped analysis from shell: `git diff | ask-gemini-run "review this"`

## Requirements

- **Claude Code** installed and authenticated
- **Codex CLI** authenticated, required for `/codex-review` and brainstorm with Codex
- **Ollama** running locally, required for `/ollama-review` and brainstorm with Ollama
- **Gemini CLI** authenticated (`gemini login`), required for Gemini features
- For `/brainstorm`, at least two providers should be available for meaningful synthesis

## Source

- **Pi:** `ask-llm setup --host pi` ([guide](/plugin/pi))
- **Marketplace:** `/plugin marketplace add Lykhoyda/ask-llm` then `/plugin install ask-llm@ask-llm-plugins`
- **Source:** [packages/llm-mcp](https://github.com/Lykhoyda/ask-llm/tree/main/packages/llm-mcp)
