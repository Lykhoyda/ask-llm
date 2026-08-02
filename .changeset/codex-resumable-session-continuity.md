---
"@ask-llm/codex-mcp": patch
---

Restore persisted Codex session continuity while keeping omitted sessions ephemeral by default. Empty `sessionId` now starts a persisted thread, resume calls use the supported sandbox config grammar, and missing rollouts fail with actionable guidance.
