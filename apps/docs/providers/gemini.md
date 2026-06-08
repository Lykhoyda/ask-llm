---
description: Bridge Claude with Google Gemini via the official CLI. 1M+ token context window for large codebase analysis, structured edits, and quota-aware model fallback.
---

# Gemini

Bridge Claude with Google's Gemini via the official Gemini CLI. Leverages Gemini's massive 1M+ token context window for large file and codebase analysis while Claude handles interaction and code editing.

::: danger Discontinued on consumer tiers — migrate to Antigravity
As of **2026-06-18**, Google ended Gemini CLI access for **free, Google AI Pro, and Ultra** accounts. Only **Gemini Code Assist Standard/Enterprise** seats keep working with `ask-gemini-mcp`.

**On a subscription tier?** Migrate to **[Antigravity (`agy`)](./antigravity)** — Google's successor CLI, covered by the same AI Pro/Ultra subscription with no per-token billing. Install [`ask-antigravity-mcp`](./antigravity), or switch to [`ask-codex`](./codex) / [`ask-ollama`](./ollama). The **2026-06-18 tier change** section below covers what happens at runtime.
:::

## 2026-06-18 tier change

On **2026-06-18**, Google stopped serving Gemini CLI requests for free, Google AI Pro, and Ultra accounts. Only **Gemini Code Assist Standard/Enterprise** seats keep working with the same `gemini` binary and backend.

What this means for `ask-gemini-mcp`:

- The npm package **still installs and launches** — the binary is unchanged. The failure for non-enterprise accounts is a **runtime auth/quota error**, not a missing binary, so reinstalling will not help.
- On or after the cutoff, an auth/quota-class failure now surfaces an actionable notice (cutoff date + options) instead of a raw error. The note is **advisory** ("likely caused by the tier change") — a genuine auth, billing, or quota error can also trigger it.
- Google's successor is the **Antigravity CLI (`agy`)** — a separate, closed-source binary. `ask-gemini-mcp` does **not** wrap `agy` yet; it is a separate migration path, not a drop-in. Run `agy` directly, or switch to [`ask-codex`](./codex) / [`ask-ollama`](./ollama).
- **Testing the guidance:** set `ASK_GEMINI_TIER_CUTOFF` to a past UTC instant (e.g. `2020-01-01T00:00:00Z`) to force the post-cutoff gate on; an auth/quota failure will then prepend the notice. The default cutoff is `2026-06-18T00:00:00Z`.

[Google's announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/).

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
