---
"@ask-llm/mcp": minor
---

`ask-llm setup` now migrates earlier Ask LLM installations: it replaces an `ask-llm` entry started through `npx` or a bare `ask-llm-mcp` after a preview, removes proven owned split provider entries after confirmation once Ask LLM is registered in that host, and leaves custom or unverified entries in place with guidance. Codex list projections and all Pi npm registrations receive guidance only; their settings and Pi's plugin bridge remain unchanged.
