---
description: Verify your Ask LLM setup, send your first prompt to any provider, and explore multi-provider parallel dispatch.
---

# First Steps

Once installed, here's how to confirm everything works and start using Ask LLM.

## Test the Connection

```text
Use ask-llm ping to test the connection
```

You should see a `Pong!` reply listing the providers your server detected.

If something's off, run the doctor from your terminal — it works even when the MCP server can't start:

```bash
npx ask-llm-mcp doctor
```

## Single-Provider Calls

The unified `ask-llm` tool takes a `provider` parameter. In natural language:

```text
Use ask-llm to ask Codex to refactor src/auth.ts
Use ask-llm to ask Antigravity to debate this approach
Use ask-llm to ask Ollama to summarize this file (runs locally, no data sent anywhere)
```

If you installed the per-provider packages instead of the orchestrator, the tools are named explicitly:

```text
ask codex to review the staged changes
ask ollama to explain this auth flow
ask gemini to summarize @README.md
```

## Multi-Provider Dispatch

Send the same prompt to multiple providers in one call and compare:

```text
Use multi-llm to ask Codex and Gemini whether this approach is thread-safe
```

Returns per-provider responses + token usage in one structured payload. Per-provider failures are isolated (one provider hitting quota doesn't fail the whole call).

## Multi-Turn Conversations

Every response includes a session ID. Pass it back to continue:

```text
Use ask-llm to ask Codex to review src/auth.ts for security issues
# → Response includes [Session ID: abc-123-...]

Use ask-llm to ask Codex to fix the issue you found, sessionId abc-123-...
# → Codex remembers the prior review
```

Gemini, Codex, and Ollama support sessions — Gemini and Codex use native CLI resume, Ollama uses server-side conversation replay (Antigravity is single-turn). See [Multi-Turn Sessions](/usage/multi-turn-sessions) for details.

## Interactive REPL

For quick sanity checks without setting up an MCP client:

```bash
npx ask-llm-mcp repl
```

Multi-provider shell with `/provider <name>`, `/new`, `/usage`, `/sessions`, `/help`, `/quit` slash commands. Streams Gemini responses live.

## Next Steps

- [How to Ask](/usage/how-to-ask) — natural language patterns and the `@` file syntax
- [Strategies & Examples](/usage/strategies-and-examples) — proven workflows for code review, debugging, and architecture analysis
- [Multi-Turn Sessions](/usage/multi-turn-sessions) — continue conversations across calls
- [Plugin Overview](/plugin/overview) — slash commands and subagents for Claude Code users
- [Model Selection](/concepts/models) — Pro vs Flash, GPT-5.5 vs mini, Ollama model choices
