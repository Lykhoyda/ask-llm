---
description: Install a provider CLI, register the MCP server, and verify with ping. One page from zero to a working second opinion.
---

# Quick Start

Three steps: install at least one provider CLI, register the MCP server with your client, verify with ping. Start with one provider and add others anytime.

## 1. Install a provider

**Node.js v20+** is required. Then pick a provider. Codex and Claude are the recommended pair: each can review the other.

::: code-group

```bash [Codex]
npm install -g @openai/codex
# follow the codex CLI's auth instructions
```

```bash [Claude]
npm install -g @anthropic-ai/claude-code
# run claude once and authenticate
# (use this provider FROM Codex or another non-Claude host)
```

```bash [Antigravity]
# install agy >=1.1.5 from https://antigravity.google, then:
agy --version
# run agy once and authenticate
```

```bash [Ollama]
# install from https://ollama.com, then:
ollama pull qwen3.6:27b
```

```bash [Gemini]
npm install -g @google/gemini-cli && gemini login
# enterprise seats only since 2026-06-18
```

:::

Not sure which? See each provider's page: [Codex](/providers/codex), [Claude](/providers/claude), [Antigravity](/providers/antigravity), [Ollama](/providers/ollama), [Gemini](/providers/gemini).

## 2. Register the MCP server

The recommended package is `@ask-llm/mcp`, the unified orchestrator: it auto-detects every provider CLI you installed and exposes one `ask-llm` tool plus `multi-llm`, `get-usage-stats`, `diagnose`, and `ping`.

<SetupTabs provider="unified" />

Prefer a single provider with its richer tool surface (`ask-codex-edit`, `fetch-chunk`, native session tools)? Install the per-provider package instead: swap `@ask-llm/mcp` for `@ask-llm/codex-mcp`, `@ask-llm/claude-mcp`, `@ask-llm/antigravity-mcp`, `@ask-llm/ollama-mcp`, or `@ask-llm/gemini-mcp` in any tab above.

## 3. Verify

Ask your agent:

```text
Use ask-llm ping to test the connection
```

A `Pong!` reply lists the providers your server detected. If something is off, run the doctor from your terminal; it works even when the MCP server cannot start:

```bash
npx @ask-llm/mcp doctor
```

## First calls

```text
Use ask-llm to ask Codex to review the staged changes
Use ask-llm to ask Claude to critique this plan
Use multi-llm to ask Codex and Claude whether this approach is thread-safe
```

`multi-llm` returns per-provider responses plus token usage in one structured payload, and one provider hitting quota does not fail the others.

## Next steps

- [How to Ask](/usage/how-to-ask): prompt patterns that work
- [Multi-Turn Sessions](/usage/multi-turn-sessions): continue a conversation across calls
- [Claude Code Plugin](/plugin/overview): slash commands, reviewer agents, hooks
