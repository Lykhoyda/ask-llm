---
description: Install Ask LLM via npx, npm global, or per-provider packages. Prerequisites, supported clients, and configuration for the unified orchestrator and individual providers.
---

# Installation

Multiple ways to install Ask LLM, depending on whether you want the unified orchestrator or specific providers.

## Prerequisites

- **Node.js** v20.0.0 or higher (LTS 20 or 22)
- **An MCP client** — Claude Code, Codex CLI, Claude Desktop, Cursor, Warp, Copilot, or any of the [40+ compatible clients](https://modelcontextprotocol.io/clients)
- **At least one provider CLI** installed and authenticated:
  - `npm install -g @openai/codex` (then follow CLI auth) for Codex
  - `npm install -g @anthropic-ai/claude-code` (then authenticate) for Claude
  - [Antigravity CLI](https://antigravity.google) (`agy`) installed and logged in once for Antigravity
  - [Ollama](https://ollama.com) running locally with a model pulled (`ollama pull qwen3.6:27b`)
  - `npm install -g @google/gemini-cli && gemini login` for Gemini ([enterprise-gated from 2026-06-18](/providers/gemini))

## Packages

| Package | Purpose | Tools exposed |
|---------|---------|---------------|
| [`@ask-llm/mcp`](https://www.npmjs.com/package/@ask-llm/mcp) | **Unified orchestrator (recommended)** — auto-detects all installed providers | `ask-llm`, `multi-llm`, `get-usage-stats`, `diagnose`, `ping` |
| [`@ask-llm/codex-mcp`](https://www.npmjs.com/package/@ask-llm/codex-mcp) | Codex-only | `ask-codex`, `get-usage-stats`, `ping` |
| [`@ask-llm/claude-mcp`](https://www.npmjs.com/package/@ask-llm/claude-mcp) | Claude-only — designed for Codex and other non-Claude hosts; read-only file tools | `ask-claude`, `get-usage-stats`, `ping` |
| [`@ask-llm/antigravity-mcp`](https://www.npmjs.com/package/@ask-llm/antigravity-mcp) | Antigravity-only (experimental) — subscription-backed via `agy` | `ask-antigravity`, `get-usage-stats`, `ping` |
| [`@ask-llm/ollama-mcp`](https://www.npmjs.com/package/@ask-llm/ollama-mcp) | Ollama-only (local) | `ask-ollama`, `get-usage-stats`, `ping` |
| [`@ask-llm/gemini-mcp`](https://www.npmjs.com/package/@ask-llm/gemini-mcp) | Gemini-only — full feature set including `@` file syntax, sandbox, edit mode. [Enterprise-gated from 2026-06-18](/providers/gemini) | `ask-gemini`, `ask-gemini-edit`, `fetch-chunk`, `get-usage-stats`, `ping` |

The unified orchestrator uses a single `ask-llm` tool with a `provider` parameter for token efficiency ([ADR-029](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) — you pick the provider per call. Per-provider packages expose the richer per-provider tool surface (`ask-gemini-edit` for structured edits, `fetch-chunk` for large response pagination, etc.).

## Migrating from the legacy names

The six public MCP packages moved to the `@ask-llm` npm organization. Their old
package names are deprecated and point to these replacements:

| Deprecated package | Replacement |
|--------------------|-------------|
| `ask-gemini-mcp` | `@ask-llm/gemini-mcp` |
| `ask-codex-mcp` | `@ask-llm/codex-mcp` |
| `@anton-lykhoyda/ask-claude-mcp` | `@ask-llm/claude-mcp` |
| `ask-ollama-mcp` | `@ask-llm/ollama-mcp` |
| `ask-antigravity-mcp` | `@ask-llm/antigravity-mcp` |
| `ask-llm-mcp` | `@ask-llm/mcp` |

Existing installations are not forcibly removed, but npm warns when a deprecated
name is installed. Replace only the package name in `npx`/`npm install` commands
and MCP configuration. The executable names remain unchanged, so globally
installed commands and scripts do not need to be renamed.

## Method 1: NPX (recommended)

No install needed — `npx` downloads on first invocation and caches:

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "npx",
      "args": ["-y", "@ask-llm/mcp"]
    }
  }
}
```

For per-provider packages, swap `@ask-llm/mcp` for the package you want.

## Method 2: Global install via Claude Code

```bash
claude mcp add --scope user ask-llm -- npx -y @ask-llm/mcp

# Or per-provider
claude mcp add --scope user gemini -- npx -y @ask-llm/gemini-mcp
claude mcp add --scope user codex  -- npx -y @ask-llm/codex-mcp
claude mcp add --scope user ollama -- npx -y @ask-llm/ollama-mcp
claude mcp add --scope user antigravity -- npx -y @ask-llm/antigravity-mcp
```

`--scope user` registers globally for all projects. Drop the flag for per-project scope.

The unified server suppresses its Claude provider when the MCP host is already Claude Code because Claude Code does not permit nested Claude sessions.

## Method 3: Codex CLI → Claude

For the reverse collaboration path—Codex asking Claude for a second opinion:

```bash
codex mcp add claude -- npx -y @ask-llm/claude-mcp
```

Claude runs in safe mode with only `Read`, `Glob`, and `Grep`; Codex remains responsible for edits.

## Method 4: Plain npm global

```bash
npm install -g @ask-llm/mcp
# Installs the ask-llm-mcp executable on your global PATH
```

Then point your MCP config at the installed executable:

```json
{
  "mcpServers": {
    "ask-llm": { "command": "ask-llm-mcp" }
  }
}
```

The npm packages moved into the `@ask-llm` organization, but their executable
names remain unchanged for existing global-install and MCP configurations:

| Package | Executable |
|---------|------------|
| `@ask-llm/mcp` | `ask-llm-mcp` |
| `@ask-llm/gemini-mcp` | `ask-gemini-mcp` |
| `@ask-llm/codex-mcp` | `ask-codex-mcp` |
| `@ask-llm/claude-mcp` | `ask-claude-mcp` |
| `@ask-llm/ollama-mcp` | `ask-ollama-mcp` |
| `@ask-llm/antigravity-mcp` | `ask-antigravity-mcp` |

## Method 5: Claude Code Plugin (richer experience)

If you're a Claude Code user, the plugin adds slash commands (`/multi-review`, `/brainstorm`, `/compare`, `/gemini-review`, `/codex-review`, `/ollama-review`, `/antigravity-review`), reviewer subagents with confidence-based filtering, and an opt-in continuous `codex-pair` review hook:

```bash
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

See [Plugin Overview](/plugin/overview) for details.

## Verify

```bash
# From terminal — works even if MCP isn't configured yet
npx @ask-llm/mcp doctor
```

The doctor reports Node version, resolved PATH, every provider CLI's presence + version, and active env vars — your first stop when something doesn't work.

Next, head to [First Steps](/first-steps) to confirm the connection and send your first prompt, or [How to Ask](/usage/how-to-ask) for usage patterns.
