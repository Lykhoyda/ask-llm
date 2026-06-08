# Ask LLM

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/Lykhoyda/ask-llm/ci.yml?branch=main&label=CI&logo=github)](https://github.com/Lykhoyda/ask-llm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/Lykhoyda/ask-llm/release.yml?branch=main&label=release&logo=npm)](https://github.com/Lykhoyda/ask-llm/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/Lykhoyda/ask-llm?logo=github&label=release)](https://github.com/Lykhoyda/ask-llm/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

| Package | Type | Version | Downloads |
|---------|------|---------|-----------|
| [`ask-gemini-mcp`](https://www.npmjs.com/package/ask-gemini-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/ask-gemini-mcp)](https://www.npmjs.com/package/ask-gemini-mcp) | [![downloads](https://img.shields.io/npm/dt/ask-gemini-mcp)](https://www.npmjs.com/package/ask-gemini-mcp) |
| [`ask-codex-mcp`](https://www.npmjs.com/package/ask-codex-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/ask-codex-mcp)](https://www.npmjs.com/package/ask-codex-mcp) | [![downloads](https://img.shields.io/npm/dt/ask-codex-mcp)](https://www.npmjs.com/package/ask-codex-mcp) |
| [`ask-ollama-mcp`](https://www.npmjs.com/package/ask-ollama-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/ask-ollama-mcp)](https://www.npmjs.com/package/ask-ollama-mcp) | [![downloads](https://img.shields.io/npm/dt/ask-ollama-mcp)](https://www.npmjs.com/package/ask-ollama-mcp) |
| [`ask-antigravity-mcp`](https://www.npmjs.com/package/ask-antigravity-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/ask-antigravity-mcp)](https://www.npmjs.com/package/ask-antigravity-mcp) | [![downloads](https://img.shields.io/npm/dt/ask-antigravity-mcp)](https://www.npmjs.com/package/ask-antigravity-mcp) |
| [`ask-llm-mcp`](https://www.npmjs.com/package/ask-llm-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/ask-llm-mcp)](https://www.npmjs.com/package/ask-llm-mcp) | [![downloads](https://img.shields.io/npm/dt/ask-llm-mcp)](https://www.npmjs.com/package/ask-llm-mcp) |
| [`@ask-llm/plugin`](https://github.com/Lykhoyda/ask-llm/tree/main/packages/claude-plugin) | Claude Code Plugin | [![GitHub](https://img.shields.io/github/v/release/Lykhoyda/ask-llm?label=latest)](https://github.com/Lykhoyda/ask-llm/releases) | `/plugin install` |

**MCP servers + Claude Code plugin for AI-to-AI collaboration**

</div>

MCP servers that bridge your AI client with multiple LLM providers for AI-to-AI collaboration. Works with Claude Code, Claude Desktop, Cursor, Warp, Copilot, and [40+ other MCP clients](https://modelcontextprotocol.io/clients). Leverage Gemini's 1M+ token context, Codex's GPT-5.5, local Ollama models, or Google Antigravity (`agy`) — all via standard [MCP](https://modelcontextprotocol.io/).

> **⚠️ Gemini CLI tier change (2026-06-18):** Google stopped serving Gemini CLI requests for free, Google AI Pro, and Ultra accounts on 2026-06-18 — only **Gemini Code Assist Standard/Enterprise** seats keep working. `ask-gemini-mcp` still installs and launches (the failure is account/backend access, so reinstalling won't help); on a non-enterprise account it now surfaces actionable guidance instead of a raw error. Google's successor, **Antigravity CLI (`agy`)**, is now supported via the separate **[`ask-antigravity-mcp`](https://www.npmjs.com/package/ask-antigravity-mcp)** package — subscription-backed through your Google AI Pro/Ultra plan (no per-token API billing). Free/Pro users can switch to `ask-antigravity`, `ask-codex`, or `ask-ollama`. [Announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/).

## Why?

- **Get a second opinion** — Ask another AI to review your coding approach before committing
- **Debate plans** — Send architecture proposals for critique and alternative suggestions
- **Review changes** — Have multiple AIs analyze diffs to catch issues your primary AI might miss
- **Massive context** — Gemini reads entire codebases (1M+ tokens) that would overflow other models
- **Local & private** — Use Ollama for reviews where no data leaves your machine

## Quick Start

### Claude Code

```bash
# All-in-one — auto-detects installed providers
claude mcp add --scope user ask-llm -- npx -y ask-llm-mcp
```

<details>
<summary>Or install providers individually</summary>

```bash
claude mcp add --scope user gemini -- npx -y ask-gemini-mcp
claude mcp add --scope user codex -- npx -y ask-codex-mcp
claude mcp add --scope user ollama -- npx -y ask-ollama-mcp
claude mcp add --scope user antigravity -- npx -y ask-antigravity-mcp
```

</details>

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

<details>
<summary>Or install providers individually</summary>

```json
{
  "mcpServers": {
    "gemini": {
      "command": "npx",
      "args": ["-y", "ask-gemini-mcp"]
    },
    "codex": {
      "command": "npx",
      "args": ["-y", "ask-codex-mcp"]
    },
    "ollama": {
      "command": "npx",
      "args": ["-y", "ask-ollama-mcp"]
    }
  }
}
```

</details>

<details>
<summary>Cursor, Codex CLI, OpenCode, and other clients</summary>

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "ask-llm": { "command": "npx", "args": ["-y", "ask-llm-mcp"] }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`):
```toml
[mcp_servers.ask-llm]
command = "npx"
args = ["-y", "ask-llm-mcp"]
```

**Any MCP Client** (STDIO transport):
```json
{ "command": "npx", "args": ["-y", "ask-llm-mcp"] }
```

Replace `ask-llm-mcp` with `ask-gemini-mcp`, `ask-codex-mcp`, or `ask-ollama-mcp` for a single provider.

</details>

## Claude Code Plugin

The **Ask LLM plugin** adds multi-provider code review, brainstorming, and automated hooks directly into Claude Code:

```
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

### What You Get

| Feature | Description |
|:---|:---|
| <nobr>`/multi-review`</nobr> | Parallel Gemini + Codex review with 4-phase validation pipeline and consensus highlighting |
| <nobr>`/gemini-review`</nobr> | Gemini-only review with confidence filtering |
| <nobr>`/codex-review`</nobr> | Codex-only review with confidence filtering |
| <nobr>`/ollama-review`</nobr> | Local review — no data leaves your machine |
| <nobr>`/brainstorm`</nobr> | Multi-LLM brainstorm: Claude Opus researches the topic against real files in parallel with external providers (Gemini/Codex/Ollama), then synthesizes all findings with verified findings weighted higher |
| <nobr>`/compare`</nobr> | Side-by-side raw responses from multiple providers, no synthesis — for when you want to see how each provider phrases the same answer |
| <nobr>**`codex-pair` hook**</nobr> | Opt-in continuous review — runs Codex against every Edit/Write/MultiEdit when a `.codex-pair/context.md` marker is present in the project |

The review agents use a 4-phase pipeline inspired by [Anthropic's code-review plugin](https://github.com/anthropics/claude-code/tree/main/plugins/code-review): context gathering, prompt construction with explicit false-positive exclusions, synthesis, and source-level validation of each finding.

See the [plugin docs](https://lykhoyda.github.io/ask-llm/plugin/overview) for details.

## Prerequisites

- **[Node.js](https://nodejs.org/)** v20.0.0 or higher (LTS)
- **At least one provider:**
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `npm install -g @google/gemini-cli && gemini login`
  - [Codex CLI](https://github.com/openai/codex) — installed and authenticated
  - [Ollama](https://ollama.com) — running locally with a model pulled (`ollama pull qwen2.5-coder:7b`)

## MCP Tools

| Tool | Package | Purpose |
|------|---------|---------|
| `ask-gemini` | ask-gemini-mcp | Send prompts to Gemini CLI with `@` file syntax. 1M+ token context. Live progressive output via `stream-json` |
| `ask-gemini-edit` | ask-gemini-mcp | Get structured OLD/NEW code edit blocks from Gemini |
| `fetch-chunk` | ask-gemini-mcp | Retrieve chunks from cached large responses |
| `ask-codex` | ask-codex-mcp | Send prompts to Codex CLI. GPT-5.5 with mini fallback. Native session resume via `sessionId` |
| `ask-ollama` | ask-ollama-mcp | Send prompts to local Ollama. Fully private, zero cost. Server-side conversation replay via `sessionId` |
| `ask-antigravity` | ask-antigravity-mcp | Send a prompt to Google Antigravity (`agy`) for a subscription-backed second opinion. Experimental; one-shot |
| `ask-llm` | ask-llm-mcp | Unified orchestrator — pick provider per call. Fan out to all installed providers |
| `multi-llm` | ask-llm-mcp | Dispatch the same prompt to multiple providers in parallel; returns per-provider responses + usage in one call |
| `get-usage-stats` | all | Per-session token totals, fallback counts, breakdowns by provider/model — all in-memory, no persistence |
| `diagnose` | ask-llm-mcp | Self-diagnosis: Node version, PATH resolution, provider CLI presence + versions. Read-only |
| `ping` | all | Connection test — verify MCP setup |

All `ask-*` tools accept an optional `sessionId` parameter for multi-turn conversations and now return a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema` alongside the human-readable text. The orchestrator (`ask-llm-mcp`) also exposes `usage://current-session` as an MCP Resource for live JSON snapshots.

### Usage Examples

```
ask gemini to review the changes in @src/auth.ts for security issues
ask codex to suggest a better algorithm for @src/sort.ts
ask ollama to explain @src/config.ts (runs locally, no data sent anywhere)
use gemini to summarize @. the current directory
use multi-llm to compare what gemini and codex think about this approach
```

## CLI Subcommands

The orchestrator binary (`ask-llm-mcp`) supports two CLI modes alongside the default MCP server:

```bash
# Interactive multi-provider REPL — switch providers, persist sessions, see usage live
npx ask-llm-mcp repl

# Diagnose your setup — Node version, PATH, provider CLI versions, env vars
npx ask-llm-mcp doctor          # human-readable
npx ask-llm-mcp doctor --json   # machine-readable, exit 1 on error
```

The REPL ships sessions per provider (`/provider gemini`, `/provider codex`, `/new`, `/sessions`, `/usage`) and inherits all the executor behavior (quota fallback, stream-json output for Gemini, native session resume).

## Models

| Provider | Default | Fallback |
|----------|---------|----------|
| Gemini | `gemini-3.1-pro-preview` | `gemini-3.5-flash` (on quota) |
| Codex | `gpt-5.5` | `gpt-5.5-mini` (on quota) |
| Ollama | `qwen2.5-coder:7b` | `qwen2.5-coder:1.5b` (if not found) |

All providers automatically fall back to a lighter model on errors.

## Documentation

- **Docs site:** [lykhoyda.github.io/ask-llm](https://lykhoyda.github.io/ask-llm/)
- **AI-readable:** [llms.txt](https://lykhoyda.github.io/ask-llm/llms.txt) | [llms-full.txt](https://lykhoyda.github.io/ask-llm/llms-full.txt)

## Contributing

Contributions are welcome! See [open issues](https://github.com/Lykhoyda/ask-llm/issues) for things to work on.

## License

MIT License. See [LICENSE](LICENSE) for details.

**Disclaimer:** This is an unofficial, third-party tool and is not affiliated with, endorsed, or sponsored by Google or OpenAI.
