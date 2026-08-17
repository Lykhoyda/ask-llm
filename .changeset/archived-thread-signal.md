---
"@ask-llm/codex-mcp": patch
---

Fix archived-session detection on codex 0.147.0+ by matching the real `thread <id> is archived` error wording, restoring the actionable `codex unarchive` guidance on resume failures.
