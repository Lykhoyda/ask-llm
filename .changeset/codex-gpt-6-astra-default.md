---
"@ask-llm/codex-mcp": minor
"@ask-llm/mcp": minor
"@ask-llm/plugin": minor
---

Adopt Codex's bundled `gpt-6-astra` as the factory default, keep Terra as the quota fallback, and fail closed when Astra is selected on Codex CLI older than 0.153.0. `/sol-review` and the Cursor brainstorm Sol catalog IDs stay explicit Sol pins.
