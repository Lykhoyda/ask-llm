---
description: Claude Code plugin for AI-to-AI collaboration. Multi-provider code review, brainstorming agents, and the continuous codex-pair review hook.
---

# Claude Code Host

`@ask-llm/plugin` is the canonical dual-host package. This page covers its Claude Code marketplace adapter. For the same portable skill corpus with native tools and Pi lifecycle events, see [Pi Host Support](/plugin/pi).

The **Ask LLM plugin** brings the second opinion into Claude Code itself: slash-command reviews (`/codex-review`, `/multi-review`), multi-model brainstorming (`/brainstorm`), and an opt-in continuous review hook (`codex-pair`) that checks every edit as you make it. Under the hood it adds review skills, brainstorm agents, and automated hooks.

## Installation

### From Marketplace (recommended)

Add the Ask LLM marketplace, then install the plugin:

```bash
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

### From Source (development)

```bash
git clone https://github.com/Lykhoyda/ask-llm.git
cd ask-llm
yarn install && yarn build
claude --plugin-dir ./packages/claude-plugin
```

### MCP Servers

The plugin ships the Codex MCP registration used by `/codex-review` and `/sol-review`. Fully restart Claude Code after installation or upgrade, then run `/mcp`; the `plugin:ask-llm:codex` server should be connected and expose `ask-codex` automatically.

Existing user-scoped Codex registrations remain supported if you prefer the shorter `codex:ask-codex` name. Register the other provider servers at user scope:

```bash
claude mcp add --scope user antigravity -- npx -y @ask-llm/antigravity-mcp
claude mcp add --scope user ollama -- npx -y @ask-llm/ollama-mcp
claude mcp add --scope user gemini -- npx -y @ask-llm/gemini-mcp
```

If Codex registration is missing, provision it explicitly with `claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp`. If `/mcp` lists the server but it is disconnected, run `npx -y @ask-llm/mcp doctor` and fully restart Claude Code. `/sol-review` distinguishes those states before disclosing and using its `codex exec` fallback.

## What's Included

### Skills (Slash Commands)

| Command | Provider | Description |
|---------|----------|-------------|
| `/multi-review` | Antigravity + Codex | Parallel review with 4-phase validation pipeline and consensus highlighting |
| `/gemini-review` | Gemini | Get a second opinion on your current changes |
| `/codex-review` | Codex | Get a second opinion from GPT-5.6 Sol |
| `/fable-review` | Fable | Native isolated review, pinned to Fable |
| `/sol-review` | GPT-5.6 Sol | Model-pinned review through Codex |
| `/ollama-review` | Ollama | Local review, no data leaves your machine |
| `/antigravity-review` | Antigravity | Subscription-backed second opinion via Google `agy` (experimental) |
| `/brainstorm` | Multi + Claude Opus | Claude Opus researches the topic against real files in parallel with external providers, then synthesizes findings |
| `/brainstorm-all` | All + Claude Opus | Brainstorm with all four external providers (Gemini, Codex, Ollama, Antigravity) plus Claude Opus research |
| `/compare` | Multi (configurable) | Side-by-side raw responses from selected providers: no synthesis, no consensus extraction. Use when you want to see how each provider phrases the same answer |

> `/codex-review` and `/sol-review` require an installed, authenticated Codex CLI; the plugin supplies their MCP registration. `/ollama-review`, `/antigravity-review`, and `/brainstorm` require the respective CLI tools and MCP servers to be installed and authenticated.
>
> Looking for **continuous background review** (not a slash command)? See [`codex-pair`](/plugin/codex-pair), a PostToolUse hook that runs Codex against every file edit when a project has opted in via a marker file. It's the recall-first complement to `/codex-review`.

### Agents

| Agent | Description |
|-------|-------------|
| `gemini-reviewer` | Isolated Gemini code review with confidence-based filtering |
| `codex-reviewer` | Isolated Codex code review with confidence-based filtering |
| `fable-reviewer` | Native read-only Fable review with source validation |
| `sol-reviewer` | GPT-5.6 Sol review through Codex with source validation |
| `ollama-reviewer` | Local Ollama code review, no data leaves your machine |
| `antigravity-reviewer` | Subscription-backed Antigravity (`agy`) code review, experimental |
| `brainstorm-coordinator` | First-class research participant: runs its own Claude Opus research (reads real files, traces code, fetches docs) in parallel with external providers, then synthesizes consensus. Verified findings weighted higher than inferred ones. |

### Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| `codex-pair` PostToolUse | After every Edit/Write/MultiEdit | **Opt-in.** Self-gates on `.codex-pair/context.md` marker file. Zero cost without the marker. With marker: edits are debounced into a settle window, a detached worker reviews the settled file state, and HIGH/MED verdicts surface to Claude on a later edit, the next user prompt, or at turn end. See [Codex Pair](/plugin/codex-pair) for opt-in steps and cost characteristics |
| `codex-pair-prompt-drain` UserPromptSubmit | On every user prompt | Drains queued codex-pair verdicts that finished mid-turn so they reach Claude without waiting for the next edit |
| `codex-pair-stop-gate` Stop | At turn end | Drains remaining queued verdicts (no opt-in needed). With `blockOn: HIGH` in the marker frontmatter (opt-in, default OFF), blocks turn-end while unaddressed HIGH findings or in-flight reviews remain |
| `codex-pair-session` SessionStart / SessionEnd | At Claude session boundary | SessionStart announces a paused project or auto-resumes an expired auto-pause; SessionEnd clears debounce state so orphaned workers self-cancel. Lifecycle for the experimental `codex app-server` broker additionally runs only with `ASK_CODEX_BROKER=1` |

The hook shells out directly to `codex exec --json` with zero workspace imports, required so it runs from marketplace `git-subdir` installs that don't run `npm install`. A previous `PreToolUse` Gemini-review pre-commit hook was removed because continuous codex-pair review covers the same need with higher recall; use `/gemini-review` or `/codex-review` on demand for explicit pre-commit review instead.

### CLI Binaries (source builds only)

These commands are available after cloning and building the plugin locally. Marketplace `git-subdir` installs do not build or ship the generated `dist/` binaries.

| Command | Description |
|---------|-------------|
| `ask-gemini-run` | Pipe code or prompts directly to Gemini CLI |
| `ask-codex-run` | Pipe code or prompts directly to Codex CLI |
| `ask-ollama-run` | Pipe code or prompts directly to local Ollama |

## How It Works

The plugin uses several Claude Code integration points:

1. **`.mcp.json`**: Registers the canonical `@ask-llm/codex-mcp` server for Claude Code plugin sessions; other providers remain user-scoped (see [Installation](#installation))
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

- **Pi:** `pi install npm:@ask-llm/plugin` ([guide](/plugin/pi))
- **Marketplace:** `/plugin marketplace add Lykhoyda/ask-llm` then `/plugin install ask-llm@ask-llm-plugins`
- **Source:** [packages/claude-plugin](https://github.com/Lykhoyda/ask-llm/tree/main/packages/claude-plugin)
