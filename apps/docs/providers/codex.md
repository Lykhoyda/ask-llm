---
description: Bridge Claude with OpenAI Codex CLI for GPT-5.5 code review and analysis. Automatic fallback to GPT-5.5-mini on quota limits.
---

# Codex

Bridge Claude with OpenAI's Codex CLI. Access GPT-5.5 for code generation, analysis, and review with automatic fallback to GPT-5.5-mini on quota limits.

## Installation

<SetupTabs provider="codex" />

Or install globally:

```bash
npm install -g ask-codex-mcp
```

## Prerequisites

1. **Node.js** v20.0.0 or higher
2. **[Codex CLI](https://github.com/openai/codex)** installed and authenticated

## Tools

| Tool | Purpose |
|------|---------|
| `ask-codex` | Send prompts to Codex CLI. Optional `sessionId` for multi-turn — maps to Codex's native `thread_id` and uses `codex exec resume <id>` under the hood ([ADR-058](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) |
| `get-usage-stats` | Per-session token totals + breakdowns. In-memory ([ADR-054](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) |
| `ping` | Fast connection test to verify MCP setup |

`ask-codex` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`. The Thread ID returned in the response footer is the same value as `structuredContent.sessionId` — pass it back as `sessionId` to continue the conversation.

## Models

- **Default:** `gpt-5.5` (highest capability)
- **Fallback:** `gpt-5.5-mini` (automatic on quota errors per [ADR-028](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md), model bumped in [ADR-067](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md))

## Key Features

- **GPT-5.5 access** via the official Codex CLI
- **Native session continuity** — `sessionId` parameter maps to Codex's `thread_id`; `codex exec resume <id>` is used internally for follow-up turns (zero replay cost — Codex retains state)
- **Non-interactive sandbox** — `codex exec --sandbox workspace-write` so Codex never hangs on approval prompts in MCP subprocess context (`--full-auto` was removed upstream in codex 0.128; `exec` is non-interactive by definition — [ADR-075](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md))
- **JSONL output parsing** for structured responses + token usage
- **Automatic quota fallback** from GPT-5.5 to mini
- **Structured AskResponse** via outputSchema for programmatic clients
- **Standard MCP transport** works with 40+ clients

## npm

- **Package:** [ask-codex-mcp](https://www.npmjs.com/package/ask-codex-mcp)
- **Binary:** `ask-codex-mcp`
