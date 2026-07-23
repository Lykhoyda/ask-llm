---
"@ask-llm/antigravity-mcp": minor
---

Adopt agy 1.1.5's model contract — default to the stable base slug `gemini-3.1-pro` (fallback `gemini-3.5-flash`) with the reasoning tier passed separately via `--effort` (new `ASK_ANTIGRAVITY_EFFORT` env var, default `high`), and recover gracefully when agy rejects a model: a rejected model whose value equals the shipped default or fallback slug retries once model-less while any other rejected model fails with an actionable error naming `agy models` (#243).
