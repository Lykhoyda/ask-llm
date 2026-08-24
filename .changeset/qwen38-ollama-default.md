---
"@ask-llm/ollama-mcp": minor
"@ask-llm/mcp": minor
"@ask-llm/plugin": minor
---

Bump the factory-default Ollama model from `qwen3.6:27b` to same-size-class `qwen3.8:27b` (official library `latest` / 27b tag, ~18 GB Q4_K_M). `ASK_OLLAMA_MODEL` overrides are unchanged; a missing local model still fails with an actionable `ollama pull` error and no silent substitution.
