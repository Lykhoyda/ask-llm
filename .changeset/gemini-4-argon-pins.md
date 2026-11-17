---
"@ask-llm/mcp": minor
---

Move the Gemini and Antigravity default models to `gemini-4-argon`. Gemini CLI runs now default to `gemini-4-argon` instead of `gemini-3.1-pro-preview`. Antigravity runs now default to `gemini-4-argon` at `--effort high`, because agy 1.5.9 rejects the old `gemini-3.1-pro` default. Under the old default every Antigravity call failed once before retrying without a model, and the `/brainstorm` Antigravity participant failed outright. `ASK_GEMINI_MODEL`, `ASK_ANTIGRAVITY_MODEL`, `ASK_ANTIGRAVITY_EFFORT`, and both `gemini-3.8-flash` fallbacks are unchanged.
