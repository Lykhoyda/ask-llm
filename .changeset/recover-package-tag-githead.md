---
"@ask-llm/antigravity-mcp": patch
"@ask-llm/claude-mcp": patch
"@ask-llm/codex-mcp": patch
"@ask-llm/gemini-mcp": patch
"@ask-llm/grok-mcp": patch
"@ask-llm/ollama-mcp": patch
"@ask-llm/mcp": patch
"@ask-llm/plugin": patch
---

No functional change. Republish the eight public packages so each new tarball's npm gitHead matches the version-introducing commit and per-package source tags can be created. The versions currently on npm were published from a later SHA than the version bump, and gitHead is immutable.
