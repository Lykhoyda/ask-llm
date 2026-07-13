# @anton-lykhoyda/ask-claude-mcp

## 0.1.0

### Minor Changes

- [#222](https://github.com/Lykhoyda/ask-llm/pull/222) [`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a first-class Claude Code CLI provider so Codex and other MCP clients can
  ask Claude for a read-only second opinion. The new `@anton-lykhoyda/ask-claude-mcp` package
  supports native sessions, Opus-to-Sonnet fallback, usage reporting, relative
  context directories, and a hard Read/Glob/Grep-only tool boundary. The unified
  orchestrator now auto-detects Claude and can include it in `ask-llm`,
  `multi-llm`, diagnostics, and the REPL.
