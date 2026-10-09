---
title: Migrating from @ask-llm/*
description: Move an existing Ask LLM installation (split provider servers, npx registrations, the plugin bridge) to the one @ask-llm/mcp package with a single setup command.
---

# Migrating from @ask-llm/*

Ask LLM is now one package, `@ask-llm/mcp`, with one command, `ask-llm`. If you set Ask LLM up earlier with `npx -y @ask-llm/mcp`, with one of the split provider servers (`@ask-llm/codex-mcp`, `@ask-llm/claude-mcp`, `@ask-llm/grok-mcp`, `@ask-llm/antigravity-mcp`, `@ask-llm/ollama-mcp`, `@ask-llm/gemini-mcp`), or with the `@ask-llm/plugin` package in Pi, one command moves you over.

## What changed

- **One package.** `@ask-llm/mcp` carries the server, every provider, the skills, the Claude Code plugin assets and the Pi extension. It is not deprecated and its server bin, `ask-llm-mcp`, keeps its name.
- **The split provider packages and `@ask-llm/plugin` are deprecated.** npm shows a notice that points to this page when you install one. Their published versions stay installable; nothing is unpublished.
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
| An `ask-llm` entry that already runs this install, Pi's local package registration managed by setup, or the Claude Code plugin | Reuses it and changes nothing |
| An `ask-llm` entry started through an earlier route: `npx -y @ask-llm/mcp`, `npx -y ask-llm-mcp`, or a bare `ask-llm-mcp` | Previews the replacement, replaces it after you confirm, and reads it back to verify |
| A split provider entry (for example `codex` running `npx -y @ask-llm/codex-mcp`), a second Ask LLM server under another name | Removes it after you confirm, but only once Ask LLM is registered in that host, so you are never left without a working server |
| An Ask LLM entry with its own settings (environment variables such as `XAI_API_KEY`, a working directory, a disabled flag) or in a form setup cannot read | Leaves it in place and prints the exact removal command, so you can carry the settings over first |

Automatic migration requires a complete persisted user-scope record with a known unmodified shape. Codex CLI list output omits tool filters and can include project overrides, so setup prints guidance and leaves Codex registrations unchanged. Inspect the user and project configurations and preserve their filters before making any manual change.

Unverified executable paths and all Pi npm registrations receive guidance. This includes `npm:@ask-llm/mcp` and `npm:@ask-llm/plugin`, pinned or unpinned, as strings or source objects. Setup leaves those packages and the plugin bridge unchanged because their source names do not prove installed compatibility. Only the local installed-package registration managed by setup proves compatibility.

Entries that do not run an Ask LLM package are never reported or changed. Before a host's first change, setup copies its config file to `<file>.ask-llm-backup-<timestamp>` next to it. If a replacement fails in Claude Code, which removes the old entry before adding the new one, setup adds the earlier entry back through `claude mcp add`; the rest of the file, including edits made meanwhile, is left as it is. Re-running `ask-llm setup` changes nothing once a host is migrated.

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

`ask-llm remove` later deletes only `ask-llm` entries that run this install; it never restores or deletes anything else.

## What still works

- `npx -y @ask-llm/mcp` still starts the server, so an MCP config you never migrate keeps working.
- The last published versions of the split provider packages and `@ask-llm/plugin` stay installable and keep their bins (`ask-codex-mcp`, `ask-grok-mcp` and the others) and tool names; npm only prints the deprecation notice.
- The earlier unscoped names (`ask-llm-mcp`, `ask-codex-mcp`, `ask-gemini-mcp`, `ask-ollama-mcp`, `ask-antigravity-mcp`, `@anton-lykhoyda/ask-claude-mcp`) were deprecated before; setup recognises entries that use them too.
- The Claude Code plugin keeps working and keeps updating through its marketplace; setup installs it for you when it is missing.
- In Pi, `npm:@ask-llm/plugin` keeps loading until you migrate, and the earlier `ask-codex`, `ask-gemini`, `ask-grok`, `ask-ollama`, `ask-antigravity` and `ask-multi` tools remain as aliases.
- The unified server's tools (`ask-llm`, `multi-llm`, `ask-cursor-agent`, `diagnose`, `ping`, `get-usage-stats`) and their schemas are unchanged.
