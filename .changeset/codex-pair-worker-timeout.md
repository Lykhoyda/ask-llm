---
"@ask-llm/mcp": patch
---

The codex-pair debounce worker now uses the project's frontmatter `timeoutMs` for its review spawn timeout and lock lifetime, falling back to `ASK_CODEX_TIMEOUT_MS`.
