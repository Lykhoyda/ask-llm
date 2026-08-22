---
"@ask-llm/mcp": minor
"@ask-llm/plugin": minor
"@ask-llm/grok-mcp": patch
---

Add a first-class Claude Code `/grok-pair` workflow with explicit Cursor Agent, xAI API, or Grok CLI routes and no silent fallback. Add Cursor Plugin/Agent Skills support for `/codex-pair` with consent, bounded context, exact Codex model/effort/include options, persisted session reuse, cancellation, and actionable diagnostics. Unified Ask LLM now forwards supported reasoning/include options, rejects `includeDirs` on resumed Codex threads instead of dropping them, and Cursor Agent consultations support validated include directories plus structured session resume. The Claude plugin keeps bundling only Codex; `@ask-llm/mcp` and `@ask-llm/grok-mcp` are user-scoped installs for the Grok routes. Unified startup now detects authenticated Grok CLI-only installations without requiring an API key or server-wide harness override, while execution remains pinned to the request's explicit harness with no fallback.
