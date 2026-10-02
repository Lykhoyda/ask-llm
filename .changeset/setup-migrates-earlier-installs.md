---
"@ask-llm/mcp": minor
---

`ask-llm setup` now migrates earlier Ask LLM installations: it replaces an `ask-llm` entry started through `npx` or a bare `ask-llm-mcp` after a preview, removes split provider entries and Pi's `npm:@ask-llm/plugin` after confirmation once Ask LLM is registered in that host, and leaves entries with their own settings in place with the exact removal steps from the new migration guide.
