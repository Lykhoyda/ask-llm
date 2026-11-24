---
"@ask-llm/mcp": minor
---

Add an optional `outputSchema` argument to `ask-codex` for validated JSON replies. Successful calls include parsed JSON alongside the raw reply, and parsing or validation failures return the raw reply with a diagnostic.
