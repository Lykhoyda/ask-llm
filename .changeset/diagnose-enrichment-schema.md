---
"@ask-llm/shared": patch
"@ask-llm/gemini-mcp": patch
"@ask-llm/grok-mcp": patch
"@ask-llm/codex-mcp": patch
"@ask-llm/claude-mcp": patch
"@ask-llm/ollama-mcp": patch
"@ask-llm/antigravity-mcp": patch
"@ask-llm/mcp": patch
---

Allow unified MCP clients to receive the full nested provider diagnostic enrichment without output-schema validation masking it as `-32602`. The diagnostic report schema now lives beside its canonical types and remains strict for genuinely invalid enrichment.
