# Which Approach Should You Use?

This guide helps you choose the right way to consult external LLMs (Gemini, Codex) from your AI coding tool.

## Quick Decision Tree

```
Are you using Claude Code?
|-- No --> Orchestrator (@ask-llm/mcp) or Standalone MCP
|          Works with any MCP client: Cursor, Windsurf, Cline, etc.
|
+-- Yes
    |-- Want both Gemini AND Codex?
    |   --> Orchestrator (@ask-llm/mcp) — RECOMMENDED
    |       Lowest token overhead, one install, auto-detects CLIs
    |
    |-- Want a one-command review workflow?
    |   --> Skill: /gemini-review
    |       Gathers your diff automatically, delegates to Gemini
    |
    +-- Want provider-specific features (sandbox, changeMode)?
        --> Standalone MCP (@ask-llm/gemini-mcp)
            Full Gemini-specific parameter access
```

## Approach Comparison

| Approach | Install | Token Overhead | Works Outside Claude Code |
|----------|---------|---------------|--------------------------|
| **Orchestrator** | `npx -y @ask-llm/mcp` | **312 tokens (-68%)** | Yes |
| **Standalone Codex** | `npx -y @ask-llm/codex-mcp` | 411 tokens (-58%) | Yes |
| **Standalone Gemini** | `npx -y @ask-llm/gemini-mcp` | 973 tokens (baseline) | Yes |
| **Subagent** | Plugin install | 1274 tokens (+31%) | No |
| **Skill** | Plugin install | 1430 tokens (+47%, primary context) | No |

Token overhead = context window cost just from having the tools configured (idle cost per conversation turn).

The orchestrator uses a single unified `ask-llm` tool with a `provider` parameter instead of registering each provider's tools individually, making it the most token-efficient option.

## When to Use Each

### Orchestrator (@ask-llm/mcp) — Recommended Default
Best for: Most users. Lowest token overhead with access to all installed providers.
- Single `ask-llm` tool with `provider` parameter (gemini/codex)
- Auto-detects installed CLIs at startup
- 312 tokens total (68% less than standalone Gemini)
- Install: `claude mcp add ask-llm -- npx -y @ask-llm/mcp`

### Standalone MCP (@ask-llm/gemini-mcp / @ask-llm/codex-mcp)
Best for: Users who need provider-specific features (Gemini sandbox mode, changeMode, sessions).
- Full provider-specific parameters exposed
- Install: `claude mcp add gemini-cli -- npx -y @ask-llm/gemini-mcp`

### Skill (/gemini-review)
Best for: Claude Code users who want a one-command code review workflow.
- Automatically gathers your git diff
- Delegates to a subagent for isolated review context
- Note: imposes costs in two context windows (primary: 1430 tokens + subagent: 1274 tokens)

### Subagent (gemini-reviewer)
Best for: Claude Code users who want an isolated review in a separate context.
- Runs in its own context window (doesn't pollute main conversation)
- Structured output format with severity rankings
