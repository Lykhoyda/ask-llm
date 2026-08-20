---
"@ask-llm/shared": patch
"@ask-llm/gemini-mcp": patch
"@ask-llm/codex-mcp": patch
"@ask-llm/claude-mcp": patch
"@ask-llm/grok-mcp": patch
"@ask-llm/ollama-mcp": patch
"@ask-llm/antigravity-mcp": patch
"@ask-llm/mcp": minor
"@ask-llm/plugin": minor
---

Add first-class Grok consultations through explicit xAI API or official Grok CLI harnesses, with exact model selection, strict no-fallback diagnostics, redacted credentials, cancellation, telemetry, and opt-in live tests. Add a separate model-neutral Cursor Agent harness that requires provider and exact Cursor model attribution, runs read-only, and never changes trust or spend settings. The Cursor provider enum is `claude`, `codex`, `gemini`, `grok` in the unified server and Pi, and the requested and CLI-reported model must belong to that family (Auto and noncanonical IDs are refused). Prompts above 16 KB reach Grok CLI through a private `--prompt-file` and Cursor Agent over stdin. xAI effort coercion (`xhigh` applied as `high` on older models) and served-model alias resolution are disclosed, and an effort-rejecting 4xx is classified with the supported list.
