---
"@ask-llm/mcp": minor
---

`ask-llm setup` and `ask-llm remove` now register and unregister Ask LLM in Cursor, Claude Desktop and OpenCode by merging one entry into their JSON config files, keeping unrelated entries and refusing anything that is not plain JSON.
