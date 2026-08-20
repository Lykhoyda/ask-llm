---
description: All LLM providers in one MCP server. Detects configured providers (Gemini, Codex, Claude, Grok, Ollama, Antigravity) and registers available tools behind runtime checks.
---

# Unified (@ask-llm/mcp)

<ProviderStatus provider="unified" />

All providers in one MCP server. Detects which provider CLIs/endpoints are available and whether `XAI_API_KEY` configures Grok, then registers only the available providers. One install, all providers.

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
   - [xAI API key](https://console.x.ai/team/default/api-keys) in `XAI_API_KEY` for the default metered Grok harness, or official Grok Build with `ASK_GROK_HARNESS=grok-cli`
   - [Cursor CLI](https://cursor.com/docs/cli) authenticated for the optional model-neutral `ask-cursor-agent` tool
   - [Ollama](https://ollama.com) running locally for `ask-ollama` tools

## How It Works

On startup, the unified server:

1. Checks for CLI availability (Gemini, Codex, Claude, Antigravity)
2. Checks HTTP readiness for Ollama and the explicitly configured Grok harness (`XAI_API_KEY` for API, headless JSON capability for CLI) without making a billed inference
3. Dynamically imports and registers tools from available providers
4. Exposes only the tools for providers that are actually installed

## Tools

The orchestrator exposes a single `ask-llm` tool (not one per provider), so the same tool surface is registered whenever any provider is installed:

| Tool | Purpose |
|------|---------|
| `ask-llm` | Single unified tool; picks the provider via `provider` parameter (`gemini`, `codex`, `claude`, `grok`, `ollama`, `antigravity`). For Codex continuity, pass `sessionId: ""` first, then resume with the returned ID |
| `ask-cursor-agent` | Model-neutral Cursor Agent harness. Requires separate `provider` (`claude`, `codex`, `gemini`, `grok`), exact `model` from `agent --list-models`, and `prompt`; the requested model must match the provider family (Auto and noncanonical IDs are refused) and is echoed back as `model`, with Cursor's display label in optional `reportedModel`; prompts above 16 KB are piped over stdin; read-only ask mode, no fallback |
| `multi-llm` | Dispatch the same prompt to multiple providers in parallel; returns per-provider responses + usage in one call |
| `get-usage-stats` | Per-session token totals + breakdowns by provider/model; in-memory, no persistence |
| `diagnose` | Self-diagnosis: Node version, PATH, provider CLI presence + versions. Read-only |
| `ping` | Connection test |

The orchestrator uses a single `ask-llm` provider-routing tool (not one per provider) for token efficiency. All `ask-*` tools return both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`.

Codex calls are ephemeral when `sessionId` is omitted. To create a resumable Codex conversation, pass `sessionId: ""` on the first `ask-llm` call and pass its returned Thread ID on follow-ups.

It also exposes `usage://current-session` as an MCP Resource for live JSON snapshots of token spend.

## Parallel dispatch

`multi-llm` fans one prompt out to every requested provider at once, running them concurrently and collecting each response with per-provider failure isolation.

<FanOut />

## CLI Subcommands

The `@ask-llm/mcp` binary supports two CLI modes alongside the default MCP server:

```bash
npx @ask-llm/mcp repl                   # interactive multi-provider REPL
npx @ask-llm/mcp doctor                 # human-readable diagnostics
npx @ask-llm/mcp doctor --json          # established full JSON
npx @ask-llm/mcp doctor --format toon  # bounded, versioned agent-facing TOON pilot
```

## Key Features

- **Single server** for all providers
- **Auto-detection** of installed CLIs
- **Host-aware Claude routing:** Claude is available to Codex and other clients, but suppressed when the host is Claude Code because nested Claude sessions are unsupported
- **Single unified `ask-llm` provider tool** plus an explicit model-neutral `ask-cursor-agent` harness tool
- **Multi-provider parallel dispatch** via `multi-llm` (Promise.all internally; per-provider failure isolation)
- **Grok harness selection:** `xai-api` (default) or official headless `grok-cli`, never automatic failover
- **Cursor Agent harness:** exact account model ID + separate provider attribution verified against the model family, `--mode ask`, no force/trust/spend changes/fallback
- **Grok API cost safety:** exact model IDs, no fallback, `store:false`, no billing/credits/priority changes
- **Session continuity** across four session-capable providers: Claude/Gemini (`--resume`), Codex (`exec resume`), Ollama (server-side replay); Antigravity is single-turn
- **Graceful degradation** if a provider is unavailable

## npm

- **Package:** [@ask-llm/mcp](https://www.npmjs.com/package/@ask-llm/mcp)
- **Binary:** `ask-llm-mcp`
