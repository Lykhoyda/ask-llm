---
description: Register the installed server when automatic setup prints guidance or your host is not supported.
---

# Manual MCP configuration

MCP is the connection protocol used by most hosts. Pi uses a native extension instead; see [Pi host notes](/compatibility/pi). Primary onboarding uses [setup](/start/install), which registers a durable installed path.

Use manual configuration only when setup prints guidance (it always does for Codex), your host requires project scope, or your client is outside the supported host list. Start with the exact entry setup prints and keep unrelated servers intact. The installed executable is `ask-llm-mcp`; use `command -v ask-llm-mcp` to find its absolute path.

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

For a default global install, the path is `"$(npm prefix -g)/bin/ask-llm-mcp"`, which is what setup prints. Inspect both user and project configuration before adding or changing a Codex entry; preserve filters and custom options. Restart the host after registration. Run `ask-llm doctor`, then request a [first review](/start/first-review); a registration check alone is not a successful provider call.

Legacy cache-based registrations and marketplace commands are retained in [Migration](/reference/migration#earlier-installation-recipes). See [CLI](/reference/cli) and [authentication](/operation/authentication) for diagnostics and credentials.

## Codex tool timeout

After the manual `codex mcp add` command, edit the existing `ask-llm` server table in `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`). Preserve its command, arguments, environment and tool filters, and merge this setting into that table rather than appending a duplicate table:

```toml
[mcp_servers.ask-llm]
tool_timeout_sec = 2460
```

`ask-llm setup --host codex` prints this setting alongside the registration command; setup does not write Codex configuration. The 2,460-second allowance is derived from the largest shared default per-attempt limit (800 seconds) × the maximum three provider attempts + 60 seconds for probes and response overhead. Codex's longest ladder is the optional preferred model, the default model, then the quota fallback. Concurrent `multi-llm` participants share the same host deadline.

If you raise `GMCPT_TIMEOUT_MS` or a provider-specific limit (`ASK_CODEX_TIMEOUT_MS`, `ASK_CLAUDE_TIMEOUT_MS`, `ASK_GEMINI_TIMEOUT_MS`, `ASK_GROK_TIMEOUT_MS`, `ASK_CURSOR_TIMEOUT_MS`, `ASK_OLLAMA_TIMEOUT_MS` or `ASK_ANTIGRAVITY_TIMEOUT_MS`) in the server environment, raise the host setting too: `tool_timeout_sec >= ceil(largest configured per-attempt limit in ms * 3 / 1000) + 60`. For example, a 1,200,000 ms limit needs at least 3,660 seconds. Restart Codex after editing configuration, and inspect project overrides that may replace the user setting.

[Codex documents a 60-second default](https://developers.openai.com/codex/mcp). A 75-second ask-llm call on Codex CLI 0.167.0 completed with no explicit host timeout while receiving progress every 25 seconds. That observation does not establish the behavior of a silent call or other Codex versions; configure the full allowance explicitly.
