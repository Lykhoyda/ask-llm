---
"@ask-llm/codex-mcp": patch
"@ask-llm/plugin": patch
---

Switch the Codex quota fallback default from `gpt-5.6-terra` to `gpt-5.6-luna`, the role-preserving successor to the former mini-tier fallback. `ASK_CODEX_FALLBACK_MODEL` remains the override.
