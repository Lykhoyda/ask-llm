---
"ask-llm-mcp": patch
---

Include Antigravity in the `ask-llm` and `multi-llm` tool descriptions. The unified orchestrator has supported Antigravity as a fourth provider for a while (it's in the `PROVIDERS` registry and the `provider` enum), but the two top-level tool-description strings still enumerated only "Gemini, Codex, Ollama" — so MCP clients listing the tools saw a stale, incomplete provider list. Both descriptions now read "Codex, Antigravity, Ollama, Gemini" (the canonical order). The runtime `provider` enum was already dynamic and unaffected.
