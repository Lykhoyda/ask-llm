# Ask LLM

See the [Ask LLM README](https://github.com/Lykhoyda/ask-llm#ask-llm) for the product introduction, supported hosts and providers, and your first review.

## Quick Start

Follow [Install](https://lykhoyda.github.io/ask-llm/start/install) for prerequisites and the setup command. Ask LLM connects your coding assistant to providers you have installed and signed in to. For an earlier installation, follow [Migration](https://lykhoyda.github.io/ask-llm/reference/migration).

## How It Works

See [Data flow](https://lykhoyda.github.io/ask-llm/operation/data-flow) for review boundaries and session storage, and [Tools and schemas](https://lykhoyda.github.io/ask-llm/reference/tools) for provider routing.

## What it runs, installs and sends

Ask LLM sends no telemetry; provider and host data policies still apply.

### What it runs

- **Bundled MCP server.** The Claude Code plugin's `.mcp.json` runs `node scripts/plugin-mcp-server.mjs codex <version>`, which starts the Codex server. The Cursor plugin's `mcp.json` runs `node scripts/plugin-mcp-server.mjs ask-llm <version>`, which starts the unified `ask-llm` server. `<version>` is the plugin's own release. The launcher starts that exact `@ask-llm/mcp` release in its own process and never runs a different version.
- **Provider CLIs.** For each request, the server runs the CLI of the provider you selected: `codex`, `claude`, `gemini`, `agy` (Antigravity, refused unless `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1`), `grok` or Cursor's `agent`. The Claude Code plugin's bundled server runs only `codex`. At startup the unified server checks which providers are ready, including version and support checks of installed CLIs. To find these commands, the server reads your `PATH` once by running your login shell (`$SHELL -ilc`), unless `ASK_LLM_PATH` is set.
- **Claude Code hooks.** `hooks/hooks.json` runs a Node script on `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PostToolUse` (`Edit`, `Write`, `MultiEdit`) and `Stop`. Each script looks for a `.codex-pair/context.md` pairing marker, searching upward from the working directory or the edited file and stopping at your home directory, plus any markers the same session registered. When pairing is not enabled, it exits without running anything; `SessionEnd` only removes that session's entry from the pairing registry in the system temporary directory. With [pairing](https://lykhoyda.github.io/ask-llm/advanced/codex-pair) enabled, an edit runs `git diff` on the edited file and then `codex exec` (the default) or `claude --print` (`reviewer: claude`) to review it. With `ASK_CODEX_BROKER=1`, `SessionStart` also starts a `codex app-server` broker. The Cursor plugin registers no hooks.
- **Skills and agents.** Workflows call the MCP tools. Some fall back to the packaged `dist/*-run.js` runners, which run the same provider CLIs, or to `codex exec`, and say when they do.

### What it installs

- On first start, if the plugin folder does not contain the pinned build (a marketplace install from Git does not), the launcher installs `@ask-llm/mcp` at the plugin's exact version with `npm install --ignore-scripts`. It installs into `~/.cache/ask-llm/servers/mcp@<version>`; `XDG_CACHE_HOME` or `ASK_LLM_SERVER_CACHE` changes the location and `ASK_LLM_SERVER_NPM` selects the npm command. npm also installs the package's dependencies (`@modelcontextprotocol/server`, `@toon-format/toon` and `zod`), resolved from their declared version ranges without a lockfile. Later starts reuse that copy.
- The plugin installs no provider CLIs and does not sign you in to any provider.
- `ask-llm setup` is a separate command from a global npm install. It previews every change and asks before registering hosts or installing workflows through the pinned `skills` CLI; see [Command compatibility](#command-compatibility).

### What it sends and fetches

- **npm registry.** The first-start install downloads packages from your configured npm registry.
- **Your selected provider.** The prompt and the material your assistant includes, such as diffs, files and project context, go to the provider you select. CLI providers send it through that CLI, its account and its network connection. Grok's `xai-api` harness sends it to `https://api.x.ai` with your `XAI_API_KEY`.
- **Ollama.** Requests go to `OLLAMA_HOST` (default `http://localhost:11434`). At startup the unified server also requests the model list there to check availability. A remote `OLLAMA_HOST` receives your material.
- **Pairing (opt-in).** Edited file contents or diffs go to the pair reviewer (Codex or Claude) through its CLI. Logs and state stay in the project's `.codex-pair/` folder.
- **Live diagnostics (opt-in).** `ask-llm doctor --live` sends one minimal prompt to each ready provider.

## Tools

The orchestrator exposes a **single `ask-llm` tool** (not one tool per provider — ADR-029, for token efficiency); you pick the provider per call. When any provider is installed it registers:

| Tool | Purpose |
|------|---------|
| `ask-llm` | Route a prompt to a provider via `provider`; optional `harness` selects xai-api/grok-cli for Grok only. Supported `includeDirs` (Codex/Claude/Antigravity), `reasoningEffort` (Codex/Grok), and Codex-only `preferred`/`sandbox` are forwarded; unsupported combinations fail validation instead of being stripped. For Codex continuity, pass `sessionId: ""` first, then resume with the returned ID; resumed Codex calls reject `includeDirs` (no `--add-dir` on `codex exec resume`) instead of dropping them. |
| `ask-cursor-agent` | Model-neutral Cursor harness with separate provider (`claude`, `codex`, `gemini`, `grok`) + exact model ID; Auto/noncanonical IDs are refused and the ID is echoed as `model`, with Cursor's display label in optional `reportedModel` (cross-provider labels fail). Safe relative `includeDirs` map to repeated `--add-dir`; omit `sessionId` first and reuse the returned Cursor conversation ID with `--resume`. Prompts above 16 KB go over stdin; read-only ask mode, no fallback. |
| `multi-llm` | Dispatch one prompt to multiple providers in parallel; structured per-provider report |
| `get-usage-stats` | Per-session token totals + per-provider/model breakdowns (in-memory) |
| `diagnose` | Environment diagnostics — provider CLI presence + versions |
| `ping` | Connection test |

Claude is intentionally suppressed when the MCP host is already Claude Code because Claude Code rejects nested Claude sessions. It is auto-detected normally from Codex and other clients.

Codex calls are ephemeral when `sessionId` is omitted. To create a resumable Codex conversation, pass `sessionId: ""` on the first call and pass its returned Thread ID on follow-ups.

## Doctor output formats

```bash
ask-llm-mcp doctor                       # human-readable (default)
ask-llm-mcp doctor --json                # established full DiagnosticReport JSON
ask-llm-mcp doctor --format toon         # bounded ask-llm.doctor TOON v1 pilot
ask-llm-mcp doctor --format toon --full  # include paths, pass checks, and full text
```

TOON is explicit opt-in. It changes only this CLI rendering; MCP tools/resources, JSON-RPC, machine JSON, and model prose are unchanged. Bounded output carries `completeness: complete | partial`, separates records filtered by design from actionable records dropped by the cap, and discloses withheld path fields and truncated text. `--full` is a no-op for text/JSON. Unknown `doctor` arguments exit 2 with a structured error. See the [TOON pilot evidence](https://github.com/Lykhoyda/ask-llm/blob/main/docs/TOON-PILOT.md) for the schema, measurements, and AXI audit.

After a global install, `ask-llm doctor` adds host installation, registration and restart guidance to text and JSON output; unreadable registrations are unknown, and unrecognized versions show a manual step. Each installed host also gets the rows from the [host parity matrix](https://github.com/Lykhoyda/ask-llm/blob/main/docs/HOST-PARITY.md), printed beneath its text entry and included in its JSON `parity` object; hosts that are not installed omit these rows. TOON remains provider-only. Each provider reports `installed`, `authenticated` and `permitted` from local signals (`unknown` means the signal is inconclusive; `permitted` is `no` only when Ask LLM gates the provider, currently Antigravity). By default, `exercised` is `not-run` and no model call is made. Explicit `ask-llm doctor --live` (text or `--json`, not TOON) sends one minimal real prompt to each ready provider, may spend provider quota, and reports `exercised` as `yes` or `no` with the failure in the checks.

`--live` also checks Antigravity quota. See [Antigravity quota diagnostics](https://lykhoyda.github.io/ask-llm/providers/antigravity#quota-diagnostics) for the required agy version, sandboxing, version reporting, skipped checks, warnings, and default doctor's process boundary.

## Machine Protocol

The [CLI reference](https://lykhoyda.github.io/ask-llm/reference/cli#machine-protocol) owns the stdin request/result contract, schema bundle, module exports and exit codes.

## Documentation

Full docs at [lykhoyda.github.io/ask-llm](https://lykhoyda.github.io/ask-llm/)

## License

MIT

## Host plugins

Setup installs the workflows for your host. See the [host matrix](https://lykhoyda.github.io/ask-llm/compatibility/hosts) for supported features and limits.

## Installation

Follow [Install](https://lykhoyda.github.io/ask-llm/start/install). Earlier marketplace and split-provider recipes live in [Migration](https://lykhoyda.github.io/ask-llm/reference/migration#earlier-installation-recipes). [Command compatibility](#command-compatibility) documents setup mechanics and backups.

### Claude Code

See [Claude Code host notes](https://lykhoyda.github.io/ask-llm/compatibility/claude-code) for connection details, restart requirements, hooks and isolated reviewers.

### Cursor Agent

See [Cursor host notes](https://lykhoyda.github.io/ask-llm/compatibility/cursor) for portable workflows and on-demand pairing. To load the adapter from a source checkout:

```bash
agent --plugin-dir ./packages/llm-mcp
```

### Pi

See [Pi host notes](https://lykhoyda.github.io/ask-llm/compatibility/pi) for installation, native tools, supported workflows, project trust and user-owned pairing consent.

The plugin's `ask-gemini-run`, Gemini reviewer agent/skill, and Pi `ask-gemini` tool all delegate to the canonical Gemini executor: `gemini-4-argon` remains primary and quota errors fall back to `gemini-3.8-flash` unless `ASK_GEMINI_FALLBACK_MODEL` overrides it.

## Skills

See the [workflow catalogue](https://lykhoyda.github.io/ask-llm/reference/skills) for portable names and retained Claude Code aliases, and [Brainstorm](https://lykhoyda.github.io/ask-llm/workflows/brainstorm) for exact-model panels and partial-result rules.

## Agents

See [Claude Code host notes](https://lykhoyda.github.io/ask-llm/compatibility/claude-code#agents) for isolated reviewer agents.

## Hooks

See [Claude Code host notes](https://lykhoyda.github.io/ask-llm/compatibility/claude-code#hooks) for the registered hooks and removed-hook history.

## Enabling codex-pair mode

Grok CLI can use the same per-edit reviewer with Codex Sol by default or opt-in Claude Opus 5.5 (`reviewer: claude` in `.codex-pair/context.md`). Register `scripts/grok-pair-watch.mjs` manually as a Grok `PostToolUse` hook; setup leaves real hook and trust files alone. Reviews run before the hook exits; shell calls provide command text only. See the [Grok setup steps](https://lykhoyda.github.io/ask-llm/advanced/codex-pair#grok-cli).

Follow [Codex pair](https://lykhoyda.github.io/ask-llm/advanced/codex-pair) for opt-in, configuration, cost, Stop-gate behavior and troubleshooting. Pi's additional trust and consent requirements are in [Pi host notes](https://lykhoyda.github.io/ask-llm/compatibility/pi#pi-codex-pair-consent).

## Requirements

See [Install](https://lykhoyda.github.io/ask-llm/start/install#before-you-start) for platform prerequisites and [Authentication](https://lykhoyda.github.io/ask-llm/operation/authentication) for provider requirements.

## Command compatibility

`ask-llm --help` and `ask-llm --version` use the canonical package. After a global install (`npm i -g @ask-llm/mcp`), `ask-llm setup --dry-run [--json]` previews the exact command or file for every listed host, including hosts that are not installed, and writes nothing. `ask-llm setup` shows the same preview, asks before each registration and workflow installation, and registers the absolute `ask-llm-mcp` path at user scope through the host's own command for Claude Code (`claude mcp add`), Grok Build (`grok mcp add`) and Gemini CLI (`gemini mcp add`). Cursor (`~/.cursor/mcp.json`), Claude Desktop (`claude_desktop_config.json`) and OpenCode (`~/.config/opencode/opencode.json`) have no add command, and Antigravity's `agy mcp add` rewrites the whole `~/.gemini/config/mcp_config.json` and can drop other servers' settings, so setup merges the one `ask-llm` entry into that file itself: unrelated entries and the file's indentation are kept, and the file is replaced atomically, so a failed or interrupted write leaves the original intact. A file that is not plain JSON (comments, invalid UTF-8, a sibling `opencode.jsonc`, or numbers that would change when rewritten) is left untouched and the exact entry is printed instead. OpenCode is verified against fixture files only, not yet on a real OpenCode install. Pi uses a local package registration, described below. Codex registrations receive guidance only: its list output omits persisted settings and can include project overrides. Inspect user and project configuration and preserve tool filters before making manual changes. `-y` skips the questions and `--host claude,codex` limits the hosts. For existing registrations, the [migration guide](https://lykhoyda.github.io/ask-llm/reference/migration.html) defines when setup reuses, replaces or retires entries and when it leaves them unchanged with guidance. A second run preserves that registration, and each change is verified by reading the host's registration back. A host's own command may reformat its config file, while unrelated entries keep their meaning. Before each registration, replacement, retirement or removal, the existing config file is copied to `<file>.ask-llm-backup-<UTC timestamp>` and the path is printed. If that name already exists, setup or remove tries numeric suffixes (`-1`, `-2`, …) with exclusive creation, so even changes within the same millisecond get distinct backups and never overwrite an existing one. Each backup contains the bytes before that operation, may contain credentials, is never uploaded or logged in full, and keeps the original file's permissions (or 0600 if those cannot be read). Symlinked config files and directories resolve to their real location; backups remain beside the resolved file until you delete them. No backup is made for a dry run or an absent file; a non-regular config or failed copy prevents the operation. Grok configurations whose `ask-llm` entry or `mcp_servers` table uses syntax other than what `grok mcp add` writes require manual setup and removal; the commands leave them untouched. Gemini CLI loads user servers only in trusted folders. `ask-llm setup` requires a global install, because an npx cache is not a durable server path. For the host and provider diagnostics, see [Doctor output formats](#doctor-output-formats). The existing `ask-llm-mcp doctor` remains provider-only, and `ask-llm-mcp` still starts the stdio MCP server without arguments and keeps its machine and REPL commands.

For Codex, setup also prints `tool_timeout_sec = 2460` to merge into the existing `[mcp_servers.ask-llm]` table in `~/.codex/config.toml` (or `$CODEX_HOME/config.toml`), preserving its other settings. This derives from the largest shared per-attempt default (800 seconds) × three attempts + 60 seconds of overhead. If timeout environment variables raise those limits, raise the host timeout to at least `ceil(largest configured per-attempt limit in ms * 3 / 1000) + 60`; see [Codex tool timeout](https://lykhoyda.github.io/ask-llm/advanced/manual-configuration#codex-tool-timeout). Codex registration remains manual.

Setup also previews and installs workflows for selected, installed hosts: the Claude Code marketplace plugin, or portable skills through the pinned skills CLI for Codex, Cursor Agent, Grok Build, Gemini CLI, OpenCode and Pi. Claude Desktop has no skills installation. The plugin installation has its own confirmation; all missing or changed skills share one CLI invocation and confirmation. Existing user-scoped Claude plugins are left as installed. Setup compares the complete contents of each packaged portable `ask-llm-*` folder with its installed copy and refreshes differences, including supporting files and obsolete files. Identical contents are a no-op, and skills outside the packaged names are left untouched. The same comparison verifies the installation before setup reports success. The skills CLI installs from the installed `@ask-llm/mcp` package folder. When Pi is detected without a local Ask LLM registration or any Ask LLM npm entry, setup runs `pi install <that folder>` through the registration apply path, including with `-y --host pi`, so new skills and the Pi extension come from the installed version. Setup honors `PI_CODING_AGENT_DIR` for Pi's settings backup, installation and package-list verification, defaulting to `~/.pi/agent`; it reports success only after re-reading that package list; failed installs retain the manual command as a fallback. Antigravity gets a manual command that replaces only missing or changed packaged skill folders because the pinned CLI cannot write its skills directory; rerunning setup checks those complete contents too. A failed installation or outstanding manual step makes setup exit 1, including with `-y`; a dry run only previews these steps. Non-Claude marketplaces are not installed by setup because they would also import Claude hooks and a second Codex server.

For `ask-llm remove`, Pi package cleanup, and separate workflow cleanup, follow [Upgrade and remove](https://lykhoyda.github.io/ask-llm/start/upgrade-remove).

The package-name alias `mcp` points to the same server entrypoint so `npx -y @ask-llm/mcp` can still select it automatically. A global installation also exposes a generic `mcp` command, which may collide with another installed command; use the namespaced `ask-llm-mcp` command when invoking the server directly.
