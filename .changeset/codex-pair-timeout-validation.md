---
"@ask-llm/mcp": patch
---

codex-pair reviews no longer time out at once when `ASK_CODEX_TIMEOUT_MS` is empty, non-numeric, zero, negative or infinite (they use the 800s default), and a debounced review keeps the timeout it was scheduled with when the frontmatter `timeoutMs` changes during the settle window.
