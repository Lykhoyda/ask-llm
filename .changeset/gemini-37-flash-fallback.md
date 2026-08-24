---
"@ask-llm/gemini-mcp": minor
"@ask-llm/plugin": patch
---

Adopt Google's GA `gemini-3.7-flash` as the Gemini quota-fallback default and mirror it through the plugin's Gemini runner, agent, skill, and Pi surfaces. The `gemini-3.1-pro-preview` primary default, `ASK_GEMINI_FALLBACK_MODEL` override, and Antigravity's independent `gemini-3.5-flash` fallback remain unchanged (#298).
