---
description: All LLM providers in one MCP server. Auto-detects installed CLIs (Gemini, Codex, Claude, Ollama, Antigravity) and registers available tools behind runtime checks.
---

# Unified (@ask-llm/mcp)

<ProviderStatus provider="unified" />

All providers in one MCP server. Auto-detects which CLIs are installed and registers only the available tools. One install, all providers.

> **Best for:** installing once and letting the orchestrator route each request to whatever provider you have, or fanning the same prompt out to several at once. The recommended starting point.
> **Not for:** nothing in particular; if you're unsure which provider to install, start here.

## Installation

<InstallSnippet provider="unified" />

Or install globally: `npm install -g @ask-llm/mcp`

## Prerequisites

1. **Node.js** v20.0.0 or higher
2. **At least one provider** installed and authenticated:
   - [Gemini CLI](https://github.com/google-gemini/gemini-cli) for `ask-gemini` tools
   - [Codex CLI](https://github.com/openai/codex) for `ask-codex` tools
   - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/getting-started) for Codex and other non-Claude hosts to consult Claude
   - [Ollama](https://ollama.com) running locally for `ask-ollama` tools

## How It Works

On startup, the unified server:

1. Checks for CLI availability (Gemini, Codex, Claude, Antigravity)
2. Checks for HTTP availability via health endpoints (Ollama)
3. Dynamically imports and registers tools from available providers
4. Exposes only the tools for providers that are actually installed

## Tools

The orchestrator exposes a single `ask-llm` tool (not one per provider, ADR-029), so the same tool surface is registered whenever any provider is installed:

| Tool | Purpose |
|------|---------|
| `ask-llm` | Single unified tool; picks the provider via `provider` parameter (`gemini`, `codex`, `claude`, `ollama`, `antigravity`). Optional `sessionId` for multi-turn continuation |
| `multi-llm` | Dispatch the same prompt to multiple providers in parallel; returns per-provider responses + usage in one call |
| `get-usage-stats` | Per-session token totals + breakdowns by provider/model; in-memory, no persistence |
| `diagnose` | Self-diagnosis: Node version, PATH, provider CLI presence + versions. Read-only |
| `ping` | Connection test |

The orchestrator uses a single `ask-llm` tool (not one per provider) for token efficiency; see [ADR-029](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md). All `ask-*` tools return both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`.

It also exposes `usage://current-session` as an MCP Resource for live JSON snapshots of token spend.

## Parallel dispatch

`multi-llm` fans one prompt out to every requested provider at once, running them concurrently and collecting each response with per-provider failure isolation.

<FanOut />

## CLI Subcommands

The `@ask-llm/mcp` binary supports two CLI modes alongside the default MCP server:

```bash
npx @ask-llm/mcp repl     # interactive multi-provider REPL with sessions, usage tracking, slash commands
npx @ask-llm/mcp doctor   # diagnose Node version, PATH, provider CLIs, env vars (--json for machine output)
```

## Key Features

- **Single server** for all providers
- **Auto-detection** of installed CLIs
- **Host-aware Claude routing:** Claude is available to Codex and other clients, but suppressed when the host is Claude Code because nested Claude sessions are unsupported
- **Single unified `ask-llm` tool** for token efficiency
- **Multi-provider parallel dispatch** via `multi-llm` (Promise.all internally; per-provider failure isolation)
- **Session continuity** across four session-capable providers: Claude/Gemini (`--resume`), Codex (`exec resume`), Ollama (server-side replay); Antigravity is single-turn
- **Graceful degradation** if a provider is unavailable

## npm

- **Package:** [@ask-llm/mcp](https://www.npmjs.com/package/@ask-llm/mcp)
- **Binary:** `@ask-llm/mcp`
