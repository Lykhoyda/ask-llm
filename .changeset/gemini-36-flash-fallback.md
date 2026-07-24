---
"@ask-llm/gemini-mcp": minor
---

Adopt the newer, cheaper `gemini-3.6-flash` (GA 2026-07-21) as the quota-fallback default in place of `gemini-3.5-flash`, updating the quota hint to match while leaving the `gemini-3.1-pro-preview` primary default and the `ASK_GEMINI_FALLBACK_MODEL` override semantics unchanged (#244).
