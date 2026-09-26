---
"@ask-llm/plugin": patch
---

Keep a codex-pair broker running and tracked when `ps` cannot verify it, and give a stalled broker review half the review timeout so its direct fallback still finishes within one timeout.
