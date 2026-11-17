---
"@ask-llm/mcp": minor
"@ask-llm/codex-mcp": minor
"@ask-llm/gemini-mcp": patch
"@ask-llm/claude-mcp": patch
"@ask-llm/grok-mcp": patch
"@ask-llm/ollama-mcp": patch
"@ask-llm/antigravity-mcp": patch
"@ask-llm/shared": patch
---

Move the Codex file-writing path from `ask-codex({ sandbox: "workspace-write" })` to the separate `ask-codex-write` tool with write-access annotations. `ask-codex` now accepts only a read-only sandbox. Update image-generation skills and Pi's native writing tool accordingly; the unified `ask-llm` writing route remains available.

Provide concise MCP server instructions, structured responses on both edit-proposal tools, progress for token 0 and multi-provider dispatch, and Registry version metadata synchronized in the existing release version step.
