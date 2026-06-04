---
description: Bridge Claude with Google Gemini via the official CLI. 1M+ token context window for large codebase analysis, structured edits, and quota-aware model fallback.
---

# Gemini

Bridge Claude with Google's Gemini via the official Gemini CLI. Leverages Gemini's massive 1M+ token context window for large file and codebase analysis while Claude handles interaction and code editing.

## Installation

<SetupTabs provider="gemini" />

Or install globally:

```bash
npm install -g ask-gemini-mcp
```

## Prerequisites

1. **Node.js** v20.0.0 or higher
2. **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** installed and authenticated:

```bash
npm install -g @google/gemini-cli
gemini login
```

## Tools

| Tool | Purpose |
|------|---------|
| `ask-gemini` | Send prompts to Gemini CLI with `@` file syntax. Optional `sessionId` for multi-turn; live progressive output via `--output-format stream-json` ([ADR-057](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) |
| `ask-gemini-edit` | Structured code edits via Gemini changeMode. Returns OLD/NEW edit blocks. Supports `includeDirs` for monorepo context |
| `fetch-chunk` | Retrieve subsequent chunks from cached large responses |
| `get-usage-stats` | Per-session token totals + breakdowns by provider/model. In-memory ([ADR-054](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) |
| `ping` | Fast connection test to verify MCP setup |

`ask-gemini` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema` — programmatic clients can extract the sessionId and usage fields directly without parsing the response footer ([ADR-065](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)).

## Models

- **Default:** `gemini-3.1-pro-preview` (latest, highest capability)
- **Fallback:** `gemini-3.5-flash` (automatic on quota errors per [ADR-044](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md))

## Key Features

- **1M+ token context** for analyzing entire codebases
- **Multi-turn sessions** via `sessionId` — native `--resume <id>` (zero replay cost)
- **Include directories** for monorepo context (`includeDirs` parameter on `ask-gemini-edit`)
- **Live progressive output** — assistant message deltas stream to MCP progress notifications, no frozen waits on long calls
- **Structured AskResponse** via outputSchema for programmatic clients
- **Automatic quota fallback** from Pro to Flash on `RESOURCE_EXHAUSTED`

## npm

- **Package:** [ask-gemini-mcp](https://www.npmjs.com/package/ask-gemini-mcp)
- **Binary:** `ask-gemini-mcp`
