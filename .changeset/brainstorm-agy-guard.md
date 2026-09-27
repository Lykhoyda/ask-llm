---
"@ask-llm/plugin": patch
---

`/brainstorm` now skips its Antigravity participant with a disclosed reason unless `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1`, and under that opt-in runs agy with an isolation warning and without `--dangerously-skip-permissions`.
