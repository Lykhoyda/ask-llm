---
"ask-ollama-mcp": minor
"ask-llm-mcp": patch
---

Bump the default Ollama model to `qwen3.6:27b` (was `qwen2.5-coder:7b`) and remove the automatic model fallback.

Ollama runs locally, where you explicitly pull the model you want — so silently substituting a *different* model on "model not found" was a footgun. The executor now surfaces a clear, actionable error (`Ollama model "<model>" is not available locally. Pull it first: ollama pull <model>`) instead of falling back to another model. The `ASK_OLLAMA_FALLBACK_MODEL` env var and the `FALLBACK` constant are removed; `ASK_OLLAMA_MODEL` still overrides the default, and `usage.fellBack` is now always `false` for Ollama.

Note: qwen3.6's smallest Ollama variant is ~17 GB and needs a capable GPU / plenty of RAM — set `ASK_OLLAMA_MODEL` to a lighter tag (e.g. a `qwen2.5-coder` size) if your machine can't run it.
