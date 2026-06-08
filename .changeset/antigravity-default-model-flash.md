---
"ask-antigravity-mcp": minor
---

Add model selection to `ask-antigravity`, defaulting to **Gemini 3.5 Flash (High)**. Antigravity's `agy` supports model choice via the long `--model` flag (the short `-m` flag hangs under `-p`, which is why v1 shipped without it). Override with the `ASK_ANTIGRAVITY_MODEL` env var (run `agy models` for the list) or per-call via the executor's `model` option. The structured `AskResponse.model` now reports the actual model used instead of the `"antigravity"` placeholder.
