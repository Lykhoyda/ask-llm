---
description: Install Ask LLM via npx, npm global, or per-provider packages. Prerequisites, supported clients, and configuration for the unified orchestrator and individual providers.
---

# Installation

Multiple ways to install Ask LLM, depending on whether you want the unified orchestrator or specific providers.

## Prerequisites

- **Node.js** v20.0.0 or higher (LTS 20 or 22)
- **An MCP client** — Claude Code, Claude Desktop, Cursor, Warp, Copilot, or any of the [40+ compatible clients](https://modelcontextprotocol.io/clients)
- **At least one provider CLI** installed and authenticated:
  - `npm install -g @openai/codex` (then follow CLI auth) for Codex
  - [Antigravity CLI](https://antigravity.google) (`agy`) installed and logged in once for Antigravity
  - [Ollama](https://ollama.com) running locally with a model pulled (`ollama pull qwen2.5-coder:7b`)
  - `npm install -g @google/gemini-cli && gemini login` for Gemini ([enterprise-gated from 2026-06-18](/providers/gemini))

## Packages

| Package | Purpose | Tools exposed |
|---------|---------|---------------|
| [`ask-llm-mcp`](https://www.npmjs.com/package/ask-llm-mcp) | **Unified orchestrator (recommended)** — auto-detects all installed providers | `ask-llm`, `multi-llm`, `get-usage-stats`, `diagnose`, `ping` |
| [`ask-codex-mcp`](https://www.npmjs.com/package/ask-codex-mcp) | Codex-only | `ask-codex`, `get-usage-stats`, `ping` |
| [`ask-antigravity-mcp`](https://www.npmjs.com/package/ask-antigravity-mcp) | Antigravity-only (experimental) — subscription-backed via `agy` | `ask-antigravity`, `get-usage-stats`, `ping` |
| [`ask-ollama-mcp`](https://www.npmjs.com/package/ask-ollama-mcp) | Ollama-only (local) | `ask-ollama`, `get-usage-stats`, `ping` |
| [`ask-gemini-mcp`](https://www.npmjs.com/package/ask-gemini-mcp) | Gemini-only — full feature set including `@` file syntax, sandbox, edit mode. [Enterprise-gated from 2026-06-18](/providers/gemini) | `ask-gemini`, `ask-gemini-edit`, `fetch-chunk`, `get-usage-stats`, `ping` |

The unified orchestrator uses a single `ask-llm` tool with a `provider` parameter for token efficiency ([ADR-029](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) — you pick the provider per call. Per-provider packages expose the richer per-provider tool surface (`ask-gemini-edit` for structured edits, `fetch-chunk` for large response pagination, etc.).

## Method 1: NPX (recommended)

No install needed — `npx` downloads on first invocation and caches:

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "npx",
      "args": ["-y", "ask-llm-mcp"]
    }
  }
}
```

For per-provider packages, swap `ask-llm-mcp` for the package you want.

## Method 2: Global install via Claude Code

```bash
claude mcp add --scope user ask-llm -- npx -y ask-llm-mcp

# Or per-provider
claude mcp add --scope user gemini -- npx -y ask-gemini-mcp
claude mcp add --scope user codex  -- npx -y ask-codex-mcp
claude mcp add --scope user ollama -- npx -y ask-ollama-mcp
claude mcp add --scope user antigravity -- npx -y ask-antigravity-mcp
```

`--scope user` registers globally for all projects. Drop the flag for per-project scope.

## Method 3: Plain npm global

```bash
npm install -g ask-llm-mcp
# Binary is at: $(npm bin -g)/ask-llm-mcp
```

Then point your MCP config at the binary path or just use `ask-llm-mcp` directly:

```json
{
  "mcpServers": {
    "ask-llm": { "command": "ask-llm-mcp" }
  }
}
```

## Method 4: Claude Code Plugin (richer experience)

If you're a Claude Code user, the plugin adds slash commands (`/multi-review`, `/brainstorm`, `/compare`, `/gemini-review`, `/codex-review`, `/ollama-review`, `/antigravity-review`), reviewer subagents with confidence-based filtering, and an opt-in continuous `codex-pair` review hook:

```bash
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

See [Plugin Overview](/plugin/overview) for details.

## Verify

```bash
# From terminal — works even if MCP isn't configured yet
npx ask-llm-mcp doctor
```

The doctor reports Node version, resolved PATH, every provider CLI's presence + version, and active env vars — your first stop when something doesn't work.

Next, head to [First Steps](/first-steps) to confirm the connection and send your first prompt, or [How to Ask](/usage/how-to-ask) for usage patterns.
