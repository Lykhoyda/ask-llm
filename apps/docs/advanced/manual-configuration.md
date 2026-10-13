---
description: Register the installed server when automatic setup prints guidance or your host is not supported.
---

# Manual MCP configuration

MCP is the connection protocol used by most hosts. Pi uses a native extension instead; see [Pi host notes](/compatibility/pi). Primary onboarding uses [setup](/start/install), which registers a durable installed path.

Use manual configuration only when setup prints guidance, your host requires project scope, or your client is outside the supported host list. Start with the exact entry setup prints and keep unrelated servers intact. The installed executable is `ask-llm-mcp`; use `command -v ask-llm-mcp` to find its absolute path.

## JSON clients

For a client that accepts `mcpServers`, replace the placeholder with that absolute path:

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "/absolute/path/to/ask-llm-mcp",
      "args": []
    }
  }
}
```

Cursor uses `~/.cursor/mcp.json` at user scope or `.cursor/mcp.json` in a project; Claude Desktop uses its `claude_desktop_config.json`. Other hosts have different schemas: do not copy this JSON into Pi, OpenCode or a TOML client. Setup prints the host-specific form and manual steps.

## Command hosts

Pass the absolute executable path to the host's registration command:

```bash
claude mcp add --scope user ask-llm -- /absolute/path/to/ask-llm-mcp
codex mcp add ask-llm -- /absolute/path/to/ask-llm-mcp
```

Inspect both user and project configuration before manually changing an existing Codex entry; preserve filters and custom options. Restart the host after registration. Run `ask-llm doctor`, then request a [first review](/start/first-review); a registration check alone is not a successful provider call.

Legacy cache-based registrations and marketplace commands are retained in [Migration](/reference/migration#earlier-installation-recipes). See [CLI](/reference/cli) and [authentication](/operation/authentication) for diagnostics and credentials.
