---
description: Run local LLMs via Ollama for fully private AI code review. No API keys, zero cost, and data never leaves your machine.
---

# Ollama

<ProviderStatus provider="ollama" />

Run local LLMs via Ollama's HTTP API. No API keys needed, fully private, zero cost. Uses native `fetch` against Ollama's local server.

> **Best for:** private, air-gapped review of code that can't leave your machine: zero cost, no API keys, works offline.
> **Not for:** frontier-level reasoning. Local 7B models are weaker than hosted frontier models; use Codex when you need maximum capability.

## Installation

<InstallSnippet provider="ollama" />

Or install globally: `npm install -g @ask-llm/ollama-mcp`

## Prerequisites

1. **Node.js** v20.0.0 or higher
2. **[Ollama](https://ollama.com)** installed and running locally
3. **A model pulled:**

```bash
ollama pull qwen3.8:27b
```

## Tools

| Tool | Purpose |
|------|---------|
| `ask-ollama` | Send prompts to local Ollama via HTTP. Optional `sessionId` for multi-turn; server-side conversation replay since Ollama has no native session support |
| `get-usage-stats` | Per-session token totals + breakdowns. In-memory |
| `ping` | Lists locally available Ollama models via /api/tags |

`ask-ollama` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`; programmatic clients can extract the sessionId and usage fields directly without parsing the response footer. Pass `sessionId: ""` (empty string) to start a fresh session and have the executor return a new UUID.

## Models

- **Default:** `qwen3.8:27b`, Qwen's flagship-level local coding model (~18 GB; needs a capable GPU / plenty of RAM). Set `ASK_OLLAMA_MODEL` to pick a lighter model.
- There is deliberately no model fallback: a missing model fails fast with an actionable ollama pull command. Ollama is local, so you pull the model you want and the server never silently substitutes another.

## Configuration

Set `OLLAMA_HOST` environment variable to customize the Ollama server address (defaults to `http://localhost:11434`).

## Sessions

Ollama has no native session support, so the MCP server stores conversation history server-side at `/tmp/ask-llm-sessions/<id>.json` with owner-only permissions and atomic temp+rename writes:

- **24-hour TTL:** sessions auto-expire
- **40-message cap:** oldest dropped on overflow to bound replay cost
- **Owner-only permissions:** `0o600` on files, `0o700` on directory
- **Atomic temp+rename writes:** readers never see partial JSON
- **Symlink rejection via `lstatSync`:** defense-in-depth against `/tmp/` race attacks

Each turn replays the full prior conversation (input tokens grow linearly with depth), but Ollama runs locally so there's no token bill.

## Key Features

- **No API keys** required
- **Fully local** and private, nothing leaves your machine
- **Zero cost** per query
- **Server-side session continuity** with hardened storage
- **Model auto-detection** via `/api/tags` endpoint
- **No silent model substitution:** a clear "pull it first" error if a model isn't installed
- **Structured AskResponse** via outputSchema for programmatic clients

## npm

- **Package:** [@ask-llm/ollama-mcp](https://www.npmjs.com/package/@ask-llm/ollama-mcp)
- **Binary:** `ask-ollama-mcp`
