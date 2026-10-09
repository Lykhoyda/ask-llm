---
title: Migrating from @ask-llm/*
description: Use ask-llm setup to migrate supported registrations and get manual guidance for existing Pi npm installations, Codex and custom entries.
---

# Migrating from @ask-llm/*

Ask LLM is now one package, `@ask-llm/mcp`, with one command, `ask-llm`. Start migration with `ask-llm setup` if you previously used `npx -y @ask-llm/mcp`, a split provider server (`@ask-llm/codex-mcp`, `@ask-llm/claude-mcp`, `@ask-llm/grok-mcp`, `@ask-llm/antigravity-mcp`, `@ask-llm/ollama-mcp`, `@ask-llm/gemini-mcp`), or the `@ask-llm/plugin` package in Pi. Setup migrates registrations it can verify and prints manual guidance for the others. Existing Pi npm packages and their plugin bridge remain untouched.

## What changed

- **One package.** `@ask-llm/mcp` carries the server, every provider, the skills, the Claude Code plugin assets and the Pi extension. It is not deprecated and its server bin, `ask-llm-mcp`, keeps its name.
- **The split provider packages and `@ask-llm/plugin` are scheduled for deprecation.** The release owner applies the notices separately, after this page and the migration-capable release are available. A notice points to this page; published versions stay installable and nothing is unpublished.
- **Setup registers a durable path.** `ask-llm setup` registers the absolute path of the globally installed `ask-llm-mcp`, so hosts no longer start the server through an `npx` cache.
- **One server covers every provider.** The `ask-llm` tool takes a `provider` (`codex`, `claude`, `grok`, `antigravity`, `ollama`, `gemini`), so a separate server per provider is no longer needed.

## The one command

```bash
npm install -g @ask-llm/mcp
ask-llm setup
```

Preview first if you like; `--dry-run` writes nothing:

```bash
ask-llm setup --dry-run
```

Setup lists every coding agent it finds, then, for each one, shows the exact command or file change and asks before making it. For each earlier Ask LLM entry it finds, it does one of four things:

| What setup finds | What it does |
|---|---|
| An unmodified `ask-llm` entry that already runs this install, Pi's unmodified local package registration managed by setup, or the Claude Code plugin | Reuses it and changes nothing, subject to the Codex and Pi npm restrictions below |
| An unmodified `ask-llm` entry started through a recognised earlier route: `npx` with an Ask LLM package, or a bare Ask LLM server bin without arguments | Previews the replacement, replaces it after you confirm, and reads it back to verify |
| An unmodified split provider entry (for example `codex` running `npx -y @ask-llm/codex-mcp`), or a second Ask LLM server under another name | Removes it after you confirm, but only after re-reading this install's usable, unmodified `ask-llm` registration in that host; this verifies registration, not a live provider call |
| An Ask LLM entry with its own settings (environment variables such as `XAI_API_KEY`, a working directory, a disabled flag) or in a form setup cannot read | Leaves it in place with manual guidance, so you can inspect the entry and carry its settings over first |

Automatic migration requires a complete persisted user-scope record with a known unmodified shape. For command hosts, a failed or unrecognised version probe leaves registrations unchanged and prints manual commands, even when the canonical entry already runs this install; setup does not report that entry as up to date or retire its siblings. Codex CLI list output omits tool filters and can include project overrides, so setup prints guidance and leaves Codex registrations unchanged. Inspect the user and project configurations and preserve their filters before making any manual change.

Unverified executable paths and all Pi npm registrations receive guidance. This includes `npm:@ask-llm/mcp` and `npm:@ask-llm/plugin`, pinned or unpinned, as strings or source objects. Setup leaves those packages and the plugin bridge unchanged because their source names do not prove installed compatibility. Only the local installed-package registration managed by setup proves compatibility.

Unrelated entries are not migration findings and are never changed; an unrelated command occupying the `ask-llm` name is reported as a conflict. Before a host's first change, setup copies its config file to `<file>.ask-llm-backup-<timestamp>` next to it. If a replacement fails in Claude Code, which removes the old entry before adding the new one, setup attempts to restore the earlier entry through `claude mcp add` only while that name is still absent. A new entry or edits elsewhere in the file are preserved, and a failed restoration reports the backup path. Re-running `ask-llm setup` preserves migrated registrations and repeats outstanding guidance; it may still refresh changed skills.

`-y` answers yes to every question and `--host claude,codex` limits setup to the named hosts:

```bash
ask-llm setup -y --host claude,codex
```

## Before and after, per host

Setup works at user scope. In the examples, `<prefix>` is the output of `npm prefix -g`.

| Host | Before | After |
|---|---|---|
| Claude Code | `claude mcp add --scope user ask-llm -- npx -y @ask-llm/mcp`, and per-provider entries such as `claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp` | `claude mcp add --scope user ask-llm -- <prefix>/bin/ask-llm-mcp`; the per-provider entries are removed. The Claude Code plugin (`ask-llm@ask-llm-plugins`) stays installed |
| Codex CLI | `codex mcp add ask-llm -- npx -y @ask-llm/mcp`, `codex mcp add claude -- npx -y @ask-llm/claude-mcp` | Guidance only; inspect user and project configuration and preserve filters before manually changing either entry |
| Antigravity | Ask LLM entries in `~/.gemini/config/mcp_config.json`, such as `ask-llm` or `antigravity` running `npx -y @ask-llm/antigravity-mcp` | `agy mcp add ask-llm <prefix>/bin/ask-llm-mcp`; per-provider entries removed with `agy mcp remove` |
| Grok Build | `[mcp_servers.<name>]` tables in `~/.grok/config.toml` running an Ask LLM package | `grok mcp add --scope user ask-llm <prefix>/bin/ask-llm-mcp`; per-provider tables removed with `grok mcp remove --scope user` |
| Gemini CLI | `mcpServers` entries in `~/.gemini/settings.json` running an Ask LLM package | `gemini mcp add --scope user ask-llm <prefix>/bin/ask-llm-mcp`; per-provider entries removed with `gemini mcp remove --scope user` |
| Cursor | `"ask-llm": { "command": "npx", "args": ["-y", "@ask-llm/mcp"] }` in `~/.cursor/mcp.json` | `"ask-llm": { "command": "<prefix>/bin/ask-llm-mcp", "args": [] }`; other entries untouched |
| Claude Desktop | `"ask-llm": { "command": "npx", "args": ["-y", "ask-llm-mcp"] }` in `claude_desktop_config.json` | `"ask-llm": { "command": "<prefix>/bin/ask-llm-mcp", "args": [] }`; restart Claude Desktop |
| OpenCode | `"mcp": { "ask-llm": { "type": "local", "command": ["npx", "-y", "@ask-llm/mcp"] } }` in `~/.config/opencode/opencode.json` | `"command": ["<prefix>/bin/ask-llm-mcp"]` |
| Pi | `pi install npm:@ask-llm/plugin` or `pi install npm:@ask-llm/mcp` | Guidance only; preserve filters and settings, manually register `<prefix>/lib/node_modules/@ask-llm/mcp` and verify the extension before removing the bridge |

Claude Code, Antigravity, Grok Build and Gemini CLI are changed through their own `mcp` commands; setup edits the JSON file only for Cursor, Claude Desktop and OpenCode, which have no such command. Start a new session (or restart Cursor and Claude Desktop) to load the change.

## Removing old entries by hand

Use these when setup printed guidance, or for entries outside user scope, which setup does not touch (project `.mcp.json` files, Claude Code's `--scope project` and `--scope local` entries, a project's `.cursor/mcp.json`).

| Host | Command |
|---|---|
| Claude Code | `claude mcp remove --scope user <name>` (or `--scope project`, `--scope local`) |
| Codex CLI | `codex mcp remove <name>` |
| Antigravity | `agy mcp remove <name>` |
| Grok Build | `grok mcp remove --scope user <name>` |
| Gemini CLI | `gemini mcp remove --scope user <name>` |
| Cursor, Claude Desktop, OpenCode | Delete the entry from the JSON file |
| Pi | `pi remove npm:@ask-llm/plugin` |

To keep a setting from a removed entry, such as `XAI_API_KEY` for Grok, set it in your shell profile or add it to the `ask-llm` entry. The unified server reads the same environment variables as the split servers did. For Claude Code, re-create the entry with the variable:

```bash
claude mcp remove --scope user ask-llm
claude mcp add --scope user ask-llm -e XAI_API_KEY="$XAI_API_KEY" -- "$(npm prefix -g)/bin/ask-llm-mcp"
```

For later removal of this installation, see the [command compatibility reference](https://github.com/Lykhoyda/ask-llm/blob/main/packages/llm-mcp/README.md#command-compatibility). Removal does not restore replaced or retired entries.

## What still works

- `npx -y @ask-llm/mcp` still starts the server, so an MCP config you never migrate keeps working.
- The last published versions of the split provider packages and `@ask-llm/plugin` stay installable and keep their bins (`ask-codex-mcp`, `ask-grok-mcp` and the others) and tool names; once deprecation is applied, npm adds a notice.
- The earlier unscoped names (`ask-llm-mcp`, `ask-codex-mcp`, `ask-gemini-mcp`, `ask-ollama-mcp`, `ask-antigravity-mcp`, `@anton-lykhoyda/ask-claude-mcp`) were deprecated before; setup recognises entries that use them too.
- The Claude Code plugin keeps working and keeps updating through its marketplace; setup installs it for you when it is missing.
- In Pi, `npm:@ask-llm/plugin` keeps loading until you migrate, and the earlier `ask-codex`, `ask-gemini`, `ask-grok`, `ask-ollama`, `ask-antigravity` and `ask-multi` tools remain as aliases.
- The unified server's tools (`ask-llm`, `multi-llm`, `ask-cursor-agent`, `diagnose`, `ping`, `get-usage-stats`) and their schemas are unchanged.
