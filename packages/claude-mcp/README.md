# @ask-llm/claude-mcp

MCP server for consulting Anthropic Claude Code CLI from Codex CLI, Cursor,
OpenCode, and other MCP clients. It fills the reverse collaboration path:
Claude can ask Codex through `@ask-llm/codex-mcp`, and Codex can ask Claude through
`@ask-llm/claude-mcp`.

## Install for Codex CLI

```bash
codex mcp add claude -- npx -y @ask-llm/claude-mcp
```

Then ask Codex to use `ask-claude` for an independent review or second opinion.

> This provider is for Codex and other non-Claude hosts. Claude Code rejects
> nested Claude Code sessions; the unified orchestrator automatically suppresses
> the Claude provider when Claude Code is already the host.

## Prerequisites

- Node.js 20 or newer.
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/getting-started)
  installed, on `PATH`, and authenticated. The implementation is validated
  against Claude Code 2.1.206 and requires a version that supports `--safe-mode`.

## Tools

- `ask-claude` — ask Claude for analysis, with optional native `sessionId`,
  model override, and relative `includeDirs`.
- `get-usage-stats` — in-memory token and duration totals.
- `ping` — verify the MCP server and Claude CLI installation.

## Safety boundary

Every consultation runs Claude Code with `--safe-mode` and an explicit
`Read,Glob,Grep` tool list. Claude can inspect the current workspace and allowed
relative directories, but cannot run shell commands or modify files. Prompts are
sent through stdin rather than command-line arguments.

## Models and configuration

- Default: `opus` (override with `ASK_CLAUDE_MODEL`).
- Fallback: `sonnet` (override with `ASK_CLAUDE_FALLBACK_MODEL`). Claude Code's
  native `--fallback-model` handles overload or availability failures.
- Timeout: 600000 ms (override with `ASK_CLAUDE_TIMEOUT_MS`, then
  `GMCPT_TIMEOUT_MS`).

The tool returns both human-readable text and a structured `AskResponse` with
the actual model, native Claude session ID, and token usage when the CLI reports
it.
