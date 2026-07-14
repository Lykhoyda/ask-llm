---
description: Let Codex and other MCP clients consult Anthropic Claude Code CLI for read-only reviews, analysis, and native multi-turn sessions.
---

# Claude

<ProviderStatus provider="claude" />

Bridge Codex CLI, Cursor, OpenCode, or another MCP client with Anthropic's Claude Code CLI. This is the reverse collaboration path of the hero pair: Codex asks Claude here, and Claude asks Codex back through [`ask-codex-mcp`](/providers/codex).

> **Best for:** getting an independent Claude review while Codex or another model is your primary agent.
> **Not for:** use from inside Claude Code itself. Claude Code rejects nested Claude sessions, so the unified orchestrator suppresses this provider when Claude Code is the MCP host.

## Installation

<InstallSnippet provider="claude" />

Or install globally: `npm install -g ask-claude-mcp`

## Prerequisites

1. **Node.js** v20.0.0 or higher
2. **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/getting-started)** installed, on `PATH`, and authenticated

## Tools

| Tool | Purpose |
|------|---------|
| `ask-claude` | Send a review or analysis prompt to Claude. Supports `model`, native `sessionId`, and validated relative `includeDirs` |
| `get-usage-stats` | Per-session token totals, durations, and model breakdowns. In-memory |
| `ping` | Verify the MCP server and Claude Code CLI installation |

`ask-claude` returns human-readable text plus a structured `AskResponse` containing the response, actual model, native Claude session ID, and token usage when reported by the CLI.

## Models

<FallbackChain provider="claude" />

- **Default:** `opus`, a stable Claude Code alias for the latest Opus model
- **Fallback:** `sonnet`, passed through Claude Code's native `--fallback-model` behavior
- **Overrides:** `ASK_CLAUDE_MODEL`, `ASK_CLAUDE_FALLBACK_MODEL`, or the optional per-call `model` parameter

## Read-only boundary

The provider invokes Claude with:

- `--safe-mode`, disabling project customizations, hooks, plugins, MCP servers, and auto-memory
- `--tools Read,Glob,Grep`, excluding Bash, Edit, Write, and external tools
- `--permission-mode dontAsk`, preventing a headless permission prompt from hanging the MCP call
- stdin prompt delivery, avoiding command-line length limits and keeping prompt content out of process arguments

Claude can inspect the current workspace and validated relative `includeDirs`, but the calling MCP client remains responsible for edits.

## Native sessions

The JSON response includes Claude's `session_id`. Pass it back as `sessionId` on a later call to continue the same conversation through `claude --resume` without replaying the transcript.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ASK_CLAUDE_MODEL` | `opus` | Default Claude alias or full model name |
| `ASK_CLAUDE_FALLBACK_MODEL` | `sonnet` | Native fallback model |
| `ASK_CLAUDE_TIMEOUT_MS` | `600000` | Provider process timeout in milliseconds |
| `GMCPT_TIMEOUT_MS` | `(none)` | Global timeout fallback |

## npm

- **Package:** [ask-claude-mcp](https://www.npmjs.com/package/ask-claude-mcp)
- **Binary:** `ask-claude-mcp`
