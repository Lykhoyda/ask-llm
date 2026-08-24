---
description: Bridge Claude with OpenAI Codex CLI for GPT-5.6 Sol code review and analysis. Automatic fallback to GPT-5.6 Luna on quota limits.
---

# Codex

<ProviderStatus provider="codex" />

OpenAI's Codex CLI is the workhorse reviewer of the pair: strongest code reasoning for targeted reviews, architecture critique, and diff analysis. Claude asks Codex; Codex asks Claude back through [`@ask-llm/claude-mcp`](/providers/claude).

> **Best for:** targeted code reasoning, architecture critique, and security review of specific files, the default workhorse reviewer.
> **Not for:** whole-repository reads beyond its context window (use Gemini or Antigravity), or fully offline/air-gapped use (it's a hosted model; use Ollama).

## Installation

<InstallSnippet provider="codex" />

Or install globally: `npm install -g @ask-llm/codex-mcp`

## Prerequisites

1. **Node.js** v20.0.0 or higher
2. **[Codex CLI](https://github.com/openai/codex)** installed and authenticated

## Tools

| Tool | Purpose |
|------|---------|
| `ask-codex` | Send prompts to Codex CLI. Optional `reasoningEffort`; omit `sessionId` for an ephemeral call, pass `sessionId: ""` to start a persisted thread, or pass a returned thread ID to resume it |
| `ask-codex-edit` | Propose structured code edits via a read-only `codex exec --output-schema` pass. Returns edit blocks for the calling client to apply |
| `get-usage-stats` | Per-session token totals + breakdowns. In-memory |
| `ping` | Fast connection test to verify MCP setup |

`ask-codex` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`. Calls are ephemeral by default for privacy: a Thread ID from a call that omitted `sessionId` is not resumable. To opt into continuity, pass `sessionId: ""` on the first call; its returned Thread ID is the same value as `structuredContent.sessionId`, and can be passed back on later calls.

## Models

<FallbackChain provider="codex" />

- **Default:** `gpt-5.6-sol` (GPT-5.6 Sol flagship)
- **Quota fallback:** `gpt-5.6-luna`, the fast/affordable GPT-5.6 tier
- **Overrides:** `ASK_CODEX_MODEL`, `ASK_CODEX_FALLBACK_MODEL`, or the per-call `model` parameter

## Key Features

- **GPT-5.6 Sol access** via the official Codex CLI
- **Reasoning control:** ordinary calls default to `medium`; `/codex-review` and `/brainstorm` use `high`; direct calls can request `low`, `medium`, `high`, `xhigh`, or `max`
- **Native session continuity:** omit `sessionId` for an ephemeral one-off call; pass `sessionId: ""` on turn one to persist a thread, then pass its returned `thread_id` on later turns. Follow-ups use `codex exec resume <id>` with the stable `-c sandbox_mode="<mode>"` grammar (zero replay cost, Codex retains state).
- **Read-only, non-interactive sandbox:** fresh calls use `codex exec --sandbox read-only`; resumed calls use the equivalent supported config override `-c sandbox_mode="read-only"`. Both keep second-opinion, review, and edit-proposal calls from modifying the workspace. Codex `exec` is non-interactive by definition, so no approval prompt can hang the MCP subprocess. The optional `sandbox: "workspace-write"` parameter is a deliberate opt-out for flows that need Codex to write files (e.g. `/codex-image`); review flows must not set it.
- **JSONL output parsing** for structured responses + token usage
- **Automatic quota fallback** from GPT-5.6 Sol to Luna
- **Structured AskResponse** via outputSchema for programmatic clients
- **Standard MCP transport** works with 40+ clients

## npm

- **Package:** [@ask-llm/codex-mcp](https://www.npmjs.com/package/@ask-llm/codex-mcp)
- **Binary:** `ask-codex-mcp`
