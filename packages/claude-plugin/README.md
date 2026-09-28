# Ask LLM plugin bridge

`@ask-llm/plugin` depends on `@ask-llm/mcp`, which now owns the provider runners, skills, hooks, agents and Pi extension.

Existing `ask-*-run` commands and `pi install npm:@ask-llm/plugin` remain supported through this bridge; new installations can use `npm install -g @ask-llm/mcp` or `pi install npm:@ask-llm/mcp`.

Claude Code and Cursor marketplace installations load the canonical package assets from this repository.
