---
description: Install and configure Ask LLM MCP servers for Claude Code, Claude Desktop, Cursor, and other MCP clients. Choose one provider to start, add more anytime.
---

# Getting Started

Three steps: install Node, install at least one provider, register the MCP server with your client. You can start with one provider (Codex, Claude, Antigravity, Ollama, or Gemini) and add the others anytime.

## Step 1: Install Prerequisites

1. **[Node.js](https://nodejs.org/) v20.0.0 or higher** (LTS 20 or 22).
2. **At least one provider** — pick whichever fits your use case:

::: tip Which provider should I install first?
- **Codex** — strong code reasoning (GPT-5.5). The default workhorse for targeted reviews and architecture critique.
- **Claude** — Opus with Sonnet fallback. Use from Codex or another non-Claude host for an independent Claude review.
- **Antigravity** — subscription-backed via Google AI Pro/Ultra (`agy`). The Gemini CLI successor; good for a second opinion and larger-context reads.
- **Ollama** — local, private, zero cost. Best when data can't leave your machine.
- **Gemini** — huge 1M+ token context, but [enterprise-gated from 2026-06-18](/providers/gemini).
:::

```bash
# Codex (requires OpenAI account)
npm install -g @openai/codex
# follow the codex CLI's auth instructions

# Claude (for Codex and other non-Claude MCP hosts)
npm install -g @anthropic-ai/claude-code
# run claude once and authenticate

# Antigravity (requires Google AI Pro/Ultra)
# install agy from https://antigravity.google, then log in once

# Ollama
# install from https://ollama.com, then:
ollama pull qwen3.6:27b

# Gemini (enterprise seats only from 2026-06-18)
npm install -g @google/gemini-cli && gemini login
```

You can install one or all of them. The MCP server auto-detects which providers are available and only registers tools for the ones it finds.

## Step 2: Configure Your MCP Client

The recommended package is **`@ask-llm/mcp`** — the unified orchestrator that auto-detects all installed providers and exposes them through a single `ask-llm` MCP tool plus `multi-llm`, `get-usage-stats`, `diagnose`, and `ping`.

If you only want one provider, you can also install the per-provider packages directly: `@ask-llm/codex-mcp`, `@ask-llm/claude-mcp`, `@ask-llm/antigravity-mcp`, `@ask-llm/ollama-mcp`, `@ask-llm/gemini-mcp`. They expose provider-specific tools (`ask-codex`, `ask-claude`, `ask-antigravity` (subscription-backed via `agy`), `ask-ollama`, and `ask-gemini` with `@` file syntax + sandbox + edit mode).

### Option A: Claude Code (Recommended)

```bash
# Unified — picks up all installed providers
claude mcp add --scope user ask-llm -- npx -y @ask-llm/mcp

# Or per-provider (longer tool names, more granular control)
claude mcp add --scope user codex       -- npx -y @ask-llm/codex-mcp
claude mcp add --scope user antigravity -- npx -y @ask-llm/antigravity-mcp
claude mcp add --scope user ollama      -- npx -y @ask-llm/ollama-mcp
claude mcp add --scope user gemini      -- npx -y @ask-llm/gemini-mcp
```

Claude is not listed as a Claude Code per-provider registration because nested Claude sessions are unsupported. From Codex, register it with `codex mcp add claude -- npx -y @ask-llm/claude-mcp`.

### Option B: Claude Desktop

Add to `claude_desktop_config.json`:

<details>
<summary><strong>Where is my config file located?</strong></summary>
<ul>
<li><strong>macOS</strong>: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
<li><strong>Windows</strong>: <code>%APPDATA%\Claude\claude_desktop_config.json</code></li>
<li><strong>Linux</strong>: <code>~/.config/claude/claude_desktop_config.json</code></li>
</ul>
</details>

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "npx",
      "args": ["-y", "@ask-llm/mcp"]
    }
  }
}
```

::: warning
You must restart Claude Desktop completely for changes to take effect.
:::

### Option C: Cursor / Warp / Copilot / generic STDIO

Ask LLM works with [40+ MCP-compatible clients](https://modelcontextprotocol.io/clients). Standard STDIO config:

```json
{
  "command": "npx",
  "args": ["-y", "@ask-llm/mcp"]
}
```

For Cursor specifically, this goes in `.cursor/mcp.json`. For Warp/Copilot, see your client's MCP integration docs.

---

## Step 3: Verify Your Setup

Two ways to verify, depending on whether the MCP server is running:

**From inside any MCP client** — ask the assistant to call `ping`:

```text
Use ask-llm ping to test the connection
```

**From the terminal directly** — run the doctor:

```bash
npx @ask-llm/mcp doctor
```

The doctor checks Node version, PATH resolution, every provider CLI's presence and version, and key env vars. Use it when MCP itself can't start (server not registered, broken auth, wrong Node version) — it works outside the MCP transport.

If everything looks good, head to [First Steps](/first-steps) to send your first prompt, or [How to Ask](/usage/how-to-ask) for usage patterns. Need every install method and per-client config? See [Installation](/installation).

---

## Optional: Interactive REPL

The orchestrator binary also exposes a multi-provider REPL — switch providers, persist sessions, see token usage live:

```bash
npx @ask-llm/mcp repl
```

Slash commands include `/provider <name>`, `/new` (fresh session), `/sessions`, `/usage`, `/help`, `/quit`. Useful for quick sanity checks and side-by-side provider comparison without setting up an MCP client.

---

## Advanced Configuration (Environment Variables)

You can configure the server with env vars in your MCP client's configuration block.

| Variable           | Default  | Description |
| ------------------ | -------- | ----------- |
| `GMCPT_LOG_LEVEL`  | `warn`   | Minimum log level: `debug`, `info`, `warn`, `error`. Bump to `debug` if troubleshooting. |
| `GMCPT_TIMEOUT_MS` | (none)   | **Global** wall-clock timeout override for subprocess-spawned providers. When set, lifts both per-provider defaults below. Kept for backward compatibility — prefer the per-provider knobs for finer control. |
| `ASK_CODEX_TIMEOUT_MS` | `800000` | Codex-specific timeout (13.3 min). Codex with reasoning models (`gpt-5.6` family) runs multi-turn tool-use loops where each turn includes reasoning, so substantive prompts routinely take 5–10 min. Default raised in [ADR-074](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md) (closes #45). |
| `ASK_CODEX_REASONING_EFFORT` | `medium` | Default Codex reasoning effort. Direct `ask-codex` calls can override it with `reasoningEffort`; `/codex-review` and `/brainstorm` use `high`. |
| `ASK_CLAUDE_TIMEOUT_MS` | `600000` | Claude-specific timeout (10 min) for Opus reviews with read-only workspace inspection. |
| `ASK_GEMINI_TIMEOUT_MS` | `210000` | Gemini-specific timeout (3.5 min). Gemini's stream-json mode emits tokens incrementally, so the existing default is usually adequate. Provided for symmetry with `ASK_CODEX_TIMEOUT_MS`. |
| `OLLAMA_HOST`      | `http://localhost:11434` | Ollama server URL. Override if running Ollama elsewhere. |
| `ASK_LLM_PATH`     | (auto)   | Override the resolved PATH used to find provider CLIs. Auto-resolved from your login shell on macOS GUI clients ([ADR-047](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) — only set explicitly if your shell setup is unusual. |
