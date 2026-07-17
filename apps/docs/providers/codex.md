---
description: Bridge Claude with OpenAI Codex CLI for GPT-5.6 Sol code review and analysis. Automatic fallback to GPT-5.6 Terra on quota limits.
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
| `ask-codex` | Send prompts to Codex CLI. Optional `reasoningEffort` and `sessionId` for multi-turn; the latter maps to Codex's native `thread_id` and uses `codex exec resume <id>` under the hood |
| `ask-codex-edit` | Propose structured code edits via a read-only `codex exec --output-schema` pass. Returns edit blocks for the calling client to apply |
| `get-usage-stats` | Per-session token totals + breakdowns. In-memory |
| `ping` | Fast connection test to verify MCP setup |

`ask-codex` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`. The Thread ID returned in the response footer is the same value as `structuredContent.sessionId`; pass it back as `sessionId` to continue the conversation.

## Models

<FallbackChain provider="codex" />

- **Default:** `gpt-5.6-sol` (GPT-5.6 Sol flagship)
- **Quota fallback:** `gpt-5.6-terra`, the balanced GPT-5.6 tier
- **Overrides:** `ASK_CODEX_MODEL`, `ASK_CODEX_FALLBACK_MODEL`, or the per-call `model` parameter

## Key Features

- **GPT-5.6 Sol access** via the official Codex CLI
- **Reasoning control:** ordinary calls default to `medium`; `/codex-review` and `/brainstorm` use `high`; direct calls can request `low`, `medium`, `high`, `xhigh`, or `max`
- **Native session continuity:** `sessionId` parameter maps to Codex's `thread_id`; `codex exec resume <id>` is used internally for follow-up turns (zero replay cost, Codex retains state)
- **Read-only, non-interactive sandbox:** `codex exec --sandbox read-only` keeps second-opinion, review, edit-proposal, resumed-session, and codex-pair calls from modifying the workspace. Codex `exec` is non-interactive by definition, so no approval prompt can hang the MCP subprocess. The optional `sandbox: "workspace-write"` parameter is a deliberate opt-out for flows that need Codex to write files (e.g. `/codex-image`); review flows must not set it.
- **JSONL output parsing** for structured responses + token usage
- **Automatic quota fallback** from GPT-5.6 Sol to Terra
- **Structured AskResponse** via outputSchema for programmatic clients
- **Standard MCP transport** works with 40+ clients

## npm

- **Package:** [@ask-llm/codex-mcp](https://www.npmjs.com/package/@ask-llm/codex-mcp)
- **Binary:** `ask-codex-mcp`
