---
"ask-claude-mcp": minor
"ask-llm-mcp": minor
"ask-gemini-mcp": patch
"ask-codex-mcp": patch
"ask-ollama-mcp": patch
"ask-antigravity-mcp": patch
---

Add a first-class Claude Code CLI provider so Codex and other MCP clients can
ask Claude for a read-only second opinion. The new `ask-claude-mcp` package
supports native sessions, Opus-to-Sonnet fallback, usage reporting, relative
context directories, and a hard Read/Glob/Grep-only tool boundary. The unified
orchestrator now auto-detects Claude and can include it in `ask-llm`,
`multi-llm`, diagnostics, and the REPL.
