---
"@ask-llm/mcp": patch
---

Plugin MCP servers now start with `node`, pinned to the plugin's own release, instead of through an unpinned `npx`. Each Claude Code and Cursor session runs one server process instead of an `npm exec` wrapper plus the server, and no longer checks the registry for `latest` on every start. The Claude Code plugin's Codex server now comes from `@ask-llm/mcp` itself (same `ask-codex` tools), not the frozen split `@ask-llm/codex-mcp` package. A plugin installed from the repository installs its pinned release once into `~/.cache/ask-llm/servers` (or `ASK_LLM_SERVER_CACHE`) on first start. The release version step keeps the pins in sync.
