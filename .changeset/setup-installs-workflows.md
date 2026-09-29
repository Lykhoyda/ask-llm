---
"@ask-llm/mcp": minor
---

`ask-llm setup` now also installs the workflows, the plugin in Claude Code and the renamed `ask-llm-*` skills in Codex, Cursor, Grok Build, Gemini CLI, OpenCode and Pi through the pinned `skills` CLI (Antigravity gets a printed copy command), so on Pi run `ask-llm setup --host pi` to get `/skill:ask-llm-review`, `/skill:ask-llm-compare` and `/skill:ask-llm-brainstorm` in place of `/skill:codex-review`, `/skill:compare` and `/skill:brainstorm`.
