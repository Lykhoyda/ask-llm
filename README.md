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

**Get a second opinion before you ship.** Ask LLM lets your AI assistant — Claude Code, Cursor, Claude Desktop, or any of [40+ MCP clients](https://modelcontextprotocol.io/clients) — consult a _second_ model to review your code, debate a plan, or catch a bug it might have missed. Pick the reviewer that fits: OpenAI **Codex** (GPT-5.5), Google **Antigravity** (`agy`), a local **Ollama** model, or **Gemini** (1M+ token context). Standard [MCP](https://modelcontextprotocol.io/), no prompt hacks.

> **⚠️ Gemini CLI goes enterprise-only on 2026-06-18:** From that date Google restricts Gemini CLI to **Gemini Code Assist Standard/Enterprise** seats, and free, Google AI Pro, and Ultra accounts lose access. `ask-gemini-mcp` still installs, but a non-enterprise account then surfaces actionable guidance instead of output. Free/Pro users: switch to **`ask-antigravity`** (the Google-sanctioned successor, subscription-backed via Google AI Pro/Ultra), **`ask-codex`**, or **`ask-ollama`**. [Announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)

## Why a second opinion?

Your primary AI is confident — but confidence isn't correctness. A second model, with no stake in the first one's answer, catches what it missed.

- **Second opinion on code** — before you commit to an approach, have another model review it independently.
- **Debate a plan** — send an architecture proposal for critique, alternatives, and trade-off analysis.
- **Review a diff** — have a different model analyze your changes to surface issues your primary AI glossed over.
- **Read more than fits** — Gemini and Antigravity's large context windows ingest whole codebases at once.
- **Keep it local** — run reviews through Ollama when nothing can leave your machine.

## In action

```text
You:    ask codex to review src/auth.ts for security issues
Codex:  ⚠ verifyToken() compares tokens with === — not timing-safe (line 42)
        ⚠ the session cookie is missing a SameSite attribute
Claude: Good catches — applying both fixes to src/auth.ts.
```

One prompt. A second model reviews independently; your assistant applies the fix — no copy-paste between tools.

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

Replace `ask-llm-mcp` with `ask-codex-mcp`, `ask-antigravity-mcp`, `ask-ollama-mcp`, or `ask-gemini-mcp` for a single provider.

</details>

## Choose your reviewer

| Provider | Best for | Model (default → fallback) | Notes |
|----------|----------|----------------------------|-------|
| **Codex** | Code reasoning, targeted reviews, architecture critique | `gpt-5.5` → `gpt-5.5-mini` | Requires an OpenAI/Codex account |
| **Antigravity** | A subscription-backed second opinion; larger-context reads | `Gemini 3.5 Flash (High)` | Google AI Pro/Ultra plan; one-shot, experimental |
| **Ollama** | Private/local review, zero cost, offline | `qwen3.6:27b` (no auto-fallback) | Runs entirely on your machine |
| **Gemini** | Whole-codebase reads (1M+ tokens) | `gemini-3.1-pro-preview` → `gemini-3.5-flash` | ⚠️ Enterprise-gated from 2026-06-18 |
| **Unified (`ask-llm`)** | One install for all of the above; fan out in parallel | routes per call | **Recommended** |

## Claude Code Plugin

The **Ask LLM plugin** adds multi-provider code review, brainstorming, and automated hooks directly into Claude Code:

```
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

### What You Get

| Feature | Description |
|:---|:---|
| <nobr>`/multi-review`</nobr> | Parallel Antigravity + Codex review with 4-phase validation pipeline and consensus highlighting (gemini via `/gemini-review`) |
| <nobr>`/gemini-review`</nobr> | Gemini-only review with confidence filtering |
| <nobr>`/codex-review`</nobr> | Codex-only review with confidence filtering |
| <nobr>`/ollama-review`</nobr> | Local review — no data leaves your machine |
| <nobr>`/antigravity-review`</nobr> | Subscription-backed review via Google Antigravity (`agy`) — experimental |
| <nobr>`/brainstorm`</nobr> | Multi-LLM brainstorm: Claude Opus researches the topic against real files in parallel with external providers (Gemini/Codex/Ollama), then synthesizes all findings with verified findings weighted higher |
| <nobr>`/compare`</nobr> | Side-by-side raw responses from multiple providers, no synthesis — for when you want to see how each provider phrases the same answer |
| <nobr>**`codex-pair` hook**</nobr> | Opt-in continuous review — runs Codex against every Edit/Write/MultiEdit when a `.codex-pair/context.md` marker is present in the project |

The review agents use a 4-phase pipeline inspired by [Anthropic's code-review plugin](https://github.com/anthropics/claude-code/tree/main/plugins/code-review): context gathering, prompt construction with explicit false-positive exclusions, synthesis, and source-level validation of each finding.

See the [plugin docs](https://lykhoyda.github.io/ask-llm/plugin/overview) for details.

## Prerequisites

- **[Node.js](https://nodejs.org/)** v20.0.0 or higher (LTS)
- **At least one provider:**
  - [Codex CLI](https://github.com/openai/codex) — installed and authenticated
  - [Antigravity CLI](https://antigravity.google) (`agy`) — installed and logged in once (Google AI Pro/Ultra)
  - [Ollama](https://ollama.com) — running locally with a model pulled (`ollama pull qwen3.6:27b`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `npm install -g @google/gemini-cli && gemini login` (enterprise-gated from 2026-06-18)

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
ask codex to review the changes in src/auth.ts for security issues
ask antigravity to debate this architecture plan in docs/design.md
ask ollama to explain src/config.ts (runs locally, no data sent anywhere)
ask gemini to summarize @. the current directory (1M+ context, @ is Gemini-only)
use multi-llm to compare what codex and gemini think about this approach
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
| Ollama | `qwen3.6:27b` | — (local; errors if the model isn't pulled) |

Gemini and Codex automatically fall back to a lighter model on quota errors. Ollama runs locally and never substitutes a model — if the requested model isn't pulled, it returns a clear `ollama pull` error.

## Documentation

- **Docs site:** [lykhoyda.github.io/ask-llm](https://lykhoyda.github.io/ask-llm/)
- **AI-readable:** [llms.txt](https://lykhoyda.github.io/ask-llm/llms.txt) | [llms-full.txt](https://lykhoyda.github.io/ask-llm/llms-full.txt)

## Contributing

Contributions are welcome! See [open issues](https://github.com/Lykhoyda/ask-llm/issues) for things to work on.

## License

MIT License. See [LICENSE](LICENSE) for details.

**Disclaimer:** This is an unofficial, third-party tool and is not affiliated with, endorsed, or sponsored by Google or OpenAI.
