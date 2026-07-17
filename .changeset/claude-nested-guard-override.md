---
"@ask-llm/claude-mcp": patch
---

Add an escape hatch to the nested-session guard. `ask-claude` hard-fails whenever
`CLAUDECODE` is set, but IDE extensions set that variable in their integrated
terminals, where a human may legitimately run Codex or another non-Claude-Code MCP
host. The guard now throws only when `CLAUDECODE` is set AND the new
`ASK_CLAUDE_ALLOW_NESTED` override is not truthy (`1`/`true`). The blocked-session
error message now points IDE-terminal users at the override.
