# Ask LLM MCP (Unified)

<div align="center">

[![npm version](https://img.shields.io/npm/v/ask-llm-mcp)](https://www.npmjs.com/package/ask-llm-mcp)
[![npm downloads](https://img.shields.io/npm/dt/ask-llm-mcp)](https://www.npmjs.com/package/ask-llm-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**All LLM providers in one MCP server — auto-detects what's installed**

</div>

A unified [MCP](https://modelcontextprotocol.io/) server that auto-detects installed LLM providers (Gemini, Codex, Ollama, Antigravity) and registers only the available tools. One install, all providers. Works with Claude Code, Claude Desktop, Cursor, Warp, Copilot, and [40+ other MCP clients](https://modelcontextprotocol.io/clients).

Part of the [Ask LLM](https://github.com/Lykhoyda/ask-llm) monorepo.

## Quick Start

### Claude Code

```bash
claude mcp add ask-llm -- npx -y ask-llm-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

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

## Prerequisites

- **[Node.js](https://nodejs.org/)** v20.0.0 or higher
- **At least one provider** installed:
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) for `ask-gemini` tools
  - [Codex CLI](https://github.com/openai/codex) for `ask-codex` tools
  - [Ollama](https://ollama.com) running locally for `ask-ollama` tools

## How It Works

On startup, the unified server:

1. Checks CLI availability via `which` (Gemini, Codex, Antigravity)
2. Checks HTTP availability via health endpoints (Ollama)
3. Dynamically imports and registers tools from available providers
4. Exposes only the tools for providers that are actually installed

## Tools

The orchestrator exposes a **single `ask-llm` tool** (not one tool per provider — ADR-029, for token efficiency); you pick the provider per call. When any provider is installed it registers:

| Tool | Purpose |
|------|---------|
| `ask-llm` | Route a prompt to a provider via the `provider` param (`gemini`, `codex`, `ollama`, `antigravity`); optional `sessionId` for multi-turn |
| `multi-llm` | Dispatch one prompt to multiple providers in parallel; structured per-provider report |
| `get-usage-stats` | Per-session token totals + per-provider/model breakdowns (in-memory) |
| `diagnose` | Environment diagnostics — provider CLI presence + versions |
| `ping` | Connection test |

## Documentation

Full docs at [lykhoyda.github.io/ask-llm](https://lykhoyda.github.io/ask-llm/)

## License

MIT
