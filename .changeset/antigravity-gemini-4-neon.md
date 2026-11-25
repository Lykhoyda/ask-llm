---
"@ask-llm/mcp": minor
---

Move the Antigravity default model to `gemini-4-neon` and its rate-limit fallback to `gemini-4-hydrogen`, both still sent with `--effort high`. Antigravity removes `gemini-4-argon` and `gemini-3.8-flash` on 2026-11-30. Without this change, every Antigravity call would fail once before retrying without a model, the rate-limit fallback would stop working, and the `/brainstorm` Antigravity participant would fail outright. `ASK_ANTIGRAVITY_MODEL` and `ASK_ANTIGRAVITY_EFFORT` still apply. The Gemini CLI provider's `gemini-4-argon` default and `gemini-3.8-flash` fallback are unchanged.
