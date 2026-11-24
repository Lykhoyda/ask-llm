# Ask Codex MCP

> [!WARNING]
> **Retired.** `@ask-llm/codex-mcp` is no longer published: it was unpublished from npm in November 2026 and its MCP Registry entry is deleted. This folder is a private workspace whose Codex provider code is bundled into [`@ask-llm/mcp`](https://www.npmjs.com/package/@ask-llm/mcp). Install that with `npm install -g @ask-llm/mcp`, then run `ask-llm setup`; see the [migration guide](https://lykhoyda.github.io/ask-llm/reference/migration.html). The rest of this README describes the retired standalone server and is kept for reference.

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**MCP server that connects any AI client to OpenAI Codex CLI**

</div>

An [MCP](https://modelcontextprotocol.io/) server for AI-to-AI collaboration via the Codex CLI. Works with Claude Code, Claude Desktop, Cursor, Warp, Copilot, and [40+ other MCP clients](https://modelcontextprotocol.io/clients). Access GPT-6.2 Sol for code generation, analysis, and review with automatic fallback to GPT-6.1 Terra on quota limits.

Part of the [Ask LLM](https://github.com/Lykhoyda/ask-llm) monorepo.

## Quick Start

### Claude Code

```bash
claude mcp add codex -- npx -y @ask-llm/codex-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codex": {
      "command": "npx",
      "args": ["-y", "@ask-llm/codex-mcp"]
    }
  }
}
```

### Any MCP Client

```json
{
  "command": "npx",
  "args": ["-y", "@ask-llm/codex-mcp"]
}
```

## Prerequisites

- **[Node.js](https://nodejs.org/)** v24.0.0 or higher
- **[Codex CLI](https://github.com/openai/codex)** installed and authenticated

## Tools

| Tool | Purpose |
|------|---------|
| `ask-codex` | Send prompts to Codex CLI. Defaults to GPT-6.2 Sol at medium effort with automatic Terra fallback; optional `reasoningEffort` override |
| `ask-codex-edit` | Propose edits in a read-only sandbox; the host applies the returned proposals |
| `ask-codex-write` | Run explicit file-writing tasks, including image generation, with workspace-write permission. Replaces `ask-codex({ sandbox: "workspace-write" })` |
| `ping` | Connection test — verify MCP setup without using tokens |

`ask-codex` rejects `workspace-write`; use `ask-codex-write` when Codex must create files. All three tools return readable text and a structured `AskResponse` via MCP `outputSchema`.

`ask-codex` also accepts an optional `outputSchema` argument for a strict JSON reply. Set `additionalProperties: false` and list all properties in `required` for each object. Validated JSON appears in `structuredContent.structuredResult`. The raw text stays in `structuredContent.response`, and a reply that fails parsing or validation adds `structuredContent.validationError`. Schema calls bypass the cache and retain the normal model fallback unless `noFallback: true` is set. Supply the schema on each turn that needs JSON.

Codex calls are ephemeral when `sessionId` is omitted. Pass `sessionId: ""` on the first call to persist a resumable thread, then pass its returned Thread ID on follow-up calls.

## Models

| Model | Use Case |
|-------|----------|
| `gpt-6.2-astra` | Explicit model option and `/astra-review` pin at `high` effort |
| `gpt-6.2-sol` | Default for Codex consultations and `codex-pair` (`high` effort for pairing). Also the `/sol-review` and direct Codex brainstorm pin. For Cursor catalog IDs, see [Brainstorm](https://lykhoyda.github.io/ask-llm/workflows/brainstorm). |
| `gpt-6.1-terra` | Automatic cheaper, faster fallback on quota errors |

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ASK_CODEX_MODEL` | `gpt-6.2-sol` | Override the default model |
| `ASK_CODEX_PREFERRED_MODEL` | `gpt-6.2-sol` | Legacy review-tier escape hatch; only attempted separately when it differs from the default |
| `ASK_CODEX_FALLBACK_MODEL` | `gpt-6.1-terra` | Override the quota-fallback model |
| `ASK_CODEX_REASONING_EFFORT` | `medium` | Default reasoning effort (`low`, `medium`, `high`, `xhigh`, `max`, or `ultra`); per-call `reasoningEffort` wins. `ultra` is opt-in only (maximum reasoning with automatic task delegation) and is not used by `/codex-review` or `/brainstorm` defaults |
| `ASK_CODEX_LOAD_USER_CONFIG` | _(unset)_ | Set to `1` to opt back into loading `~/.codex/config.toml` (hooks, MCP servers, preferences) and execpolicy `.rules` files. By default the wrapper passes `--ignore-user-config --ignore-rules` so behavior stays deterministic across host machines. Auth credentials in `CODEX_HOME` always load regardless. See ADR-071. |
| `ASK_CODEX_TIMEOUT_MS` | `800000` | Per-call timeout for the spawned codex process (13.3 min — reasoning models routinely take 5–10 min on substantive prompts; raised in ADR-074) |
| `GMCPT_TIMEOUT_MS` | _(unset)_ | Cross-provider timeout override; lower precedence than `ASK_CODEX_TIMEOUT_MS` |
| `GMCPT_LOG_LEVEL` | `warn` | `debug`, `info`, `warn`, or `error` |

## Documentation

Full docs at [lykhoyda.github.io/ask-llm](https://lykhoyda.github.io/ask-llm/)

## License

MIT
