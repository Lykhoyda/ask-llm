---
"@ask-llm/mcp": minor
---

`ask-llm setup` now also installs the workflows, the plugin in Claude Code and the renamed `ask-llm-*` skills everywhere else through the pinned `skills` CLI, so on Pi run `ask-llm setup --host pi` to get `/skill:ask-llm-review`, `/skill:ask-llm-compare` and `/skill:ask-llm-brainstorm` in place of `/skill:codex-review`, `/skill:compare` and `/skill:brainstorm`.
