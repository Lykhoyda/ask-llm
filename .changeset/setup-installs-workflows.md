---
"@ask-llm/mcp": minor
---

`ask-llm setup` now also installs the workflows, the plugin in Claude Code and the renamed `ask-llm-*` skills in Codex, Cursor, Grok Build, Gemini CLI, OpenCode and Pi through the pinned `skills` CLI (Antigravity gets a printed copy command). Setup installs missing skills and the Pi package from the installed `@ask-llm/mcp` package folder, so new installations match the installed version. For a detected Pi without an Ask LLM package registration, setup runs `pi install <package directory>` (also with `-y --host pi`), backs up its settings, and verifies the package list before reporting success; failed installs print the manual command. On Pi, run `ask-llm setup --host pi` to get `/skill:ask-llm-review`, `/skill:ask-llm-compare` and `/skill:ask-llm-brainstorm` in place of `/skill:codex-review`, `/skill:compare` and `/skill:brainstorm`.
