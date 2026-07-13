---
"ask-codex-mcp": patch
"ask-llm-mcp": patch
"@ask-llm/plugin": patch
---

Update Codex defaults to the GPT-5.6 family: GPT-5.6 Sol is now the
quality-first model for MCP calls, reviews, brainstorming, image orchestration,
and codex-pair, with GPT-5.6 Terra as the balanced quota fallback. The legacy
preferred-model escape hatch remains available, but no longer adds a redundant
attempt when it resolves to the Sol default. `ask-codex` now accepts an optional
`reasoningEffort`; general calls preserve `medium`, while `/codex-review` and
`/brainstorm` use `high`.
