# Ask LLM

<div align="center">

[![CI](https://img.shields.io/github/actions/workflow/status/Lykhoyda/ask-llm/ci.yml?branch=main&label=CI&logo=github)](https://github.com/Lykhoyda/ask-llm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/Lykhoyda/ask-llm/release.yml?branch=main&label=release&logo=npm)](https://github.com/Lykhoyda/ask-llm/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/Lykhoyda/ask-llm?logo=github&label=release)](https://github.com/Lykhoyda/ask-llm/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

| Package | Type | Version | Downloads |
|---------|------|---------|-----------|
| [`@ask-llm/gemini-mcp`](https://www.npmjs.com/package/@ask-llm/gemini-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/@ask-llm/gemini-mcp)](https://www.npmjs.com/package/@ask-llm/gemini-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/gemini-mcp)](https://www.npmjs.com/package/@ask-llm/gemini-mcp) |
| [`@ask-llm/codex-mcp`](https://www.npmjs.com/package/@ask-llm/codex-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/@ask-llm/codex-mcp)](https://www.npmjs.com/package/@ask-llm/codex-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/codex-mcp)](https://www.npmjs.com/package/@ask-llm/codex-mcp) |
| [`@ask-llm/claude-mcp`](https://www.npmjs.com/package/@ask-llm/claude-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/@ask-llm/claude-mcp)](https://www.npmjs.com/package/@ask-llm/claude-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/claude-mcp)](https://www.npmjs.com/package/@ask-llm/claude-mcp) |
| [`@ask-llm/grok-mcp`](https://www.npmjs.com/package/@ask-llm/grok-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/@ask-llm/grok-mcp)](https://www.npmjs.com/package/@ask-llm/grok-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/grok-mcp)](https://www.npmjs.com/package/@ask-llm/grok-mcp) |
| [`@ask-llm/ollama-mcp`](https://www.npmjs.com/package/@ask-llm/ollama-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/@ask-llm/ollama-mcp)](https://www.npmjs.com/package/@ask-llm/ollama-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/ollama-mcp)](https://www.npmjs.com/package/@ask-llm/ollama-mcp) |
| [`@ask-llm/antigravity-mcp`](https://www.npmjs.com/package/@ask-llm/antigravity-mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/@ask-llm/antigravity-mcp)](https://www.npmjs.com/package/@ask-llm/antigravity-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/antigravity-mcp)](https://www.npmjs.com/package/@ask-llm/antigravity-mcp) |
| [`@ask-llm/mcp`](https://www.npmjs.com/package/@ask-llm/mcp) | MCP Server | [![npm](https://img.shields.io/npm/v/@ask-llm/mcp)](https://www.npmjs.com/package/@ask-llm/mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/mcp)](https://www.npmjs.com/package/@ask-llm/mcp) |
| [`@ask-llm/plugin`](https://www.npmjs.com/package/@ask-llm/plugin) | Claude Code + Cursor Agent + Pi Host Package | [![npm](https://img.shields.io/npm/v/@ask-llm/plugin)](https://www.npmjs.com/package/@ask-llm/plugin) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/plugin)](https://www.npmjs.com/package/@ask-llm/plugin) |

**MCP servers + Claude Code/Cursor Agent/Pi host package for AI-to-AI collaboration**

</div>

**Get a second opinion before you ship.** Ask LLM lets your AI assistant — Claude Code, Codex CLI, Cursor, Claude Desktop, or any of [40+ MCP clients](https://modelcontextprotocol.io/clients) — consult a _second_ model to review your code, debate a plan, or catch a bug it might have missed. Pick the reviewer that fits: OpenAI **Codex** (GPT-5.6 Sol → Terra), Anthropic **Claude** (Opus → Sonnet), xAI **Grok** 4.6 via API or Grok CLI (no fallback), Google **Antigravity** (`agy`), a local **Ollama** model, or **Gemini** (1M+ token context). Standard [MCP](https://modelcontextprotocol.io/), no prompt hacks.

> **⚠️ Gemini CLI goes enterprise-only on 2026-06-18:** From that date Google restricts Gemini CLI to **Gemini Code Assist Standard/Enterprise** seats, and free, Google AI Pro, and Ultra accounts lose access. `@ask-llm/gemini-mcp` still installs, but a non-enterprise account then surfaces actionable guidance instead of output. Free/Pro users: switch to **`ask-antigravity`** (the Google-sanctioned successor, subscription-backed via Google AI Pro/Ultra), **`ask-codex`**, **`ask-claude`**, or **`ask-ollama`**. [Announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)

## Why a second opinion?

Your primary AI is confident — but confidence isn't correctness. A second model, with no stake in the first one's answer, catches what it missed.

- **Second opinion on code** — before you commit to an approach, have another model review it independently.
- **Debate a plan** — send an architecture proposal for critique, alternatives, and trade-off analysis.
- **Review a diff** — have a different model analyze your changes to surface issues your primary AI glossed over.
- **Read more than fits** — Gemini and Antigravity's large context windows ingest whole codebases at once.
- **Keep it local** — run reviews through Ollama when nothing can leave your machine.

## In action

```text
You:    ask codex to review src/auth.ts for security issues
Codex:  ⚠ verifyToken() compares tokens with === — not timing-safe (line 42)
        ⚠ the session cookie is missing a SameSite attribute
Claude: Good catches — applying both fixes to src/auth.ts.
```

One prompt. A second model reviews independently; your assistant applies the fix — no copy-paste between tools.

## Quick Start

### Claude Code

```bash
# All-in-one — auto-detects installed providers
claude mcp add --scope user ask-llm -- npx -y @ask-llm/mcp
```

<details>
<summary>Or install providers individually</summary>

```bash
claude mcp add --scope user gemini -- npx -y @ask-llm/gemini-mcp
claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp
claude mcp add --scope user grok -e XAI_API_KEY="$XAI_API_KEY" -- npx -y @ask-llm/grok-mcp
claude mcp add --scope user ollama -- npx -y @ask-llm/ollama-mcp
claude mcp add --scope user antigravity -- npx -y @ask-llm/antigravity-mcp
```

</details>

### Pi

Pi is a host harness, not another consulted provider. Install the canonical multi-host package; it exposes the shared skills plus native provider tools because Pi intentionally has no built-in MCP client:

```bash
pi install npm:@ask-llm/plugin
pi list
```

Invoke `/skill:codex-review`, `/skill:multi-review`, `/skill:compare`, `/skill:brainstorm`, or describe the workflow naturally. The package registers `ask-codex`, `ask-gemini`, `ask-grok`, `ask-ollama`, `ask-antigravity`, model-neutral `ask-cursor-agent`, and deterministic concurrent `ask-multi` tools. Provider CLI authentication is unchanged and separate from Pi's host-model login.

Pi codex-pair requires the repository marker, Pi project trust, **and** interactive user-owned consent via `/codex-pair`; a committed marker alone never authorizes source transfer or cost. Pi surfaces findings non-blockingly and does not claim Claude's blocking Stop-gate or one-shot print parity. Independent `fable-review` remains Claude Code-only and is excluded from Pi.

Update/remove with `pi update npm:@ask-llm/plugin` and `pi remove npm:@ask-llm/plugin`. See the [Pi host guide](https://lykhoyda.github.io/ask-llm/plugin/pi) for temporary/project-local installs, trust, data transfer, troubleshooting, and the full compatibility matrix.

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "npx",
      "args": ["-y", "@ask-llm/mcp"]
    }
  }
}
```

<details>
<summary>Or install providers individually</summary>

```json
{
  "mcpServers": {
    "gemini": {
      "command": "npx",
      "args": ["-y", "@ask-llm/gemini-mcp"]
    },
    "codex": {
      "command": "npx",
      "args": ["-y", "@ask-llm/codex-mcp"]
    },
    "ollama": {
      "command": "npx",
      "args": ["-y", "@ask-llm/ollama-mcp"]
    }
  }
}
```

</details>

<details>
<summary>Cursor, Codex CLI, OpenCode, and other clients</summary>

**Cursor** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "ask-llm": { "command": "npx", "args": ["-y", "@ask-llm/mcp"] }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`):
```toml
[mcp_servers.ask-llm]
command = "npx"
args = ["-y", "@ask-llm/mcp"]
```

For the focused Codex → Claude second-opinion path:

```bash
codex mcp add claude -- npx -y @ask-llm/claude-mcp
```

**Any MCP Client** (STDIO transport):
```json
{ "command": "npx", "args": ["-y", "@ask-llm/mcp"] }
```

Replace `@ask-llm/mcp` with `@ask-llm/codex-mcp`, `@ask-llm/claude-mcp`, `@ask-llm/grok-mcp`, `@ask-llm/antigravity-mcp`, `@ask-llm/ollama-mcp`, or `@ask-llm/gemini-mcp` for a single provider.

</details>

### Migrating from the old package names

All public MCP packages now live in the `@ask-llm` npm organization. The old
package names are deprecated, but their executable names are unchanged. Update
the package argument in your MCP config; commands such as `ask-codex-mcp` and
`ask-llm-mcp doctor` keep working after a global install.

| Old package | Use instead |
|-------------|-------------|
| `ask-gemini-mcp` | `@ask-llm/gemini-mcp` |
| `ask-codex-mcp` | `@ask-llm/codex-mcp` |
| `@anton-lykhoyda/ask-claude-mcp` | `@ask-llm/claude-mcp` |
| `ask-ollama-mcp` | `@ask-llm/ollama-mcp` |
| `ask-antigravity-mcp` | `@ask-llm/antigravity-mcp` |
| `ask-llm-mcp` | `@ask-llm/mcp` |

See the [installation guide](https://lykhoyda.github.io/ask-llm/installation) for
the complete package-to-executable mapping.

## Choose your reviewer

| Provider | Best for | Model (default → fallback) | Notes |
|----------|----------|----------------------------|-------|
| **Codex** | Code reasoning, targeted reviews, architecture critique | `gpt-5.6-sol` → `gpt-5.6-terra` | Requires an OpenAI/Codex account |
| **Claude** | Independent review from Codex or another non-Claude host | `opus` → `sonnet` | Claude Code CLI; native sessions; read-only tools |
| **Grok** | Grok 4.6 critique through xAI API or official Grok CLI | API `grok-4.6`, reasoning `high` (no fallback) | Harness selected separately; exact harness catalog ID sent unchanged |
| **Antigravity** | A subscription-backed second opinion; larger-context reads | `gemini-3.1-pro` → `gemini-3.5-flash` (both at `--effort high`) | Google AI Pro/Ultra plan; one-shot, experimental |
| **Ollama** | Private/local review, zero cost, offline | `qwen3.6:27b` (no auto-fallback) | Runs entirely on your machine |
| **Gemini** | Whole-codebase reads (1M+ tokens) | `gemini-3.1-pro-preview` → `gemini-3.6-flash` | ⚠️ Enterprise-gated from 2026-06-18 |
| **Unified (`ask-llm`)** | One install for all of the above; fan out in parallel | routes per call | **Recommended** |

## Host Package: Claude Code, Cursor Agent, and Pi

`@ask-llm/plugin` is one package, version, release lifecycle, and canonical skill corpus. Claude Code loads its existing marketplace agents/hooks; Cursor Agent loads the adapted `/codex-pair` and `/grok-pair` skills through its Agent Skills surface plus `mcp.json` (`agent --plugin-dir ./packages/claude-plugin`; see the [Cursor Agent host guide](https://lykhoyda.github.io/ask-llm/plugin/cursor)); Pi loads explicit native tools, portable skill adapters, and a thin lifecycle extension.

| Capability | Claude Code | Cursor Agent | Codex CLI host | Pi |
|---|---:|---:|---:|---:|
| Provider transport | MCP | MCP (`mcp.json`, unified `ask-llm` only) | MCP | native Ask LLM tools (no built-in MCP) |
| Review/compare/brainstorm skills | yes | Agent Skills | tools only | `/skill:<name>` + natural language |
| Isolated reviewer contexts / Fable | yes | no; `fable-review` excluded | no | no; `fable-review` excluded |
| codex-pair | hooks | on-demand persisted session | no | lifecycle extension |
| `/grok-pair` | yes (explicit Cursor/xAI/CLI route) | direct xAI/CLI routes via pinned unified `ask-llm` (or user-installed `ask-grok`) | no | excluded |
| Blocking HIGH Stop gate | opt-in | no | no | no; surfaced non-blockingly |
| Async pairing in one-shot print | n/a | on-demand skill | no | unsupported |

### Claude Code Plugin

The **Ask LLM plugin** adds multi-provider code review, brainstorming, and automated hooks directly into Claude Code:

```
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

### What You Get

| Feature | Description |
|:---|:---|
| <nobr>`/multi-review`</nobr> | Parallel Antigravity + Codex review with 4-phase validation pipeline and consensus highlighting (gemini via `/gemini-review`) |
| <nobr>`/gemini-review`</nobr> | Gemini-only review with confidence filtering |
| <nobr>`/codex-review`</nobr> | Codex-only review with confidence filtering |
| <nobr>`/fable-review`</nobr> | Isolated, read-only review that requests the native Fable model and discloses runtime verification limits |
| <nobr>`/sol-review`</nobr> | Model-pinned GPT-5.6 Sol review through Codex |
| <nobr>`/grok-review`</nobr> | Metered Grok review through xAI with exact model attribution and no fallback |
| <nobr>`/ollama-review`</nobr> | Local review — no data leaves your machine |
| <nobr>`/antigravity-review`</nobr> | Subscription-backed review via Google Antigravity (`agy`) — experimental |
| <nobr>`/brainstorm`</nobr> | Multi-LLM brainstorm: Claude Opus researches the topic against real files in parallel with external providers (Gemini/Codex/Grok/Ollama/Antigravity), then synthesizes all findings with verified findings weighted higher |
| <nobr>`/compare`</nobr> | Side-by-side raw responses from multiple providers, no synthesis — for when you want to see how each provider phrases the same answer |
| <nobr>**`codex-pair` hook**</nobr> | Opt-in continuous review — runs Codex against every Edit/Write/MultiEdit when a `.codex-pair/context.md` marker is present in the project |

The review agents use a 4-phase pipeline inspired by [Anthropic's code-review plugin](https://github.com/anthropics/claude-code/tree/main/plugins/code-review): context gathering, prompt construction with explicit false-positive exclusions, synthesis, and source-level validation of each finding.

See the [plugin docs](https://lykhoyda.github.io/ask-llm/plugin/overview) for details.

## Prerequisites

- **[Node.js](https://nodejs.org/)** v20.0.0 or higher (LTS)
- **At least one provider:**
  - [Codex CLI](https://github.com/openai/codex) — installed and authenticated
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/getting-started) — installed and authenticated (for Codex/other clients consulting Claude)
  - [xAI API](https://docs.x.ai/) — set `XAI_API_KEY` for the default metered Grok harness; or install/authenticate official Grok Build and set `ASK_GROK_HARNESS=grok-cli`
  - [Cursor CLI](https://cursor.com/docs/cli) — optional model-neutral harness; authenticate and choose an exact ID from `agent --list-models`
  - [Antigravity CLI](https://antigravity.google) (`agy`) >=1.1.5 — installed and logged in once (Google AI Pro/Ultra); verify with `agy --version`
  - [Ollama](https://ollama.com) — running locally with a model pulled (`ollama pull qwen3.6:27b`)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) — `npm install -g @google/gemini-cli && gemini login` (enterprise-gated from 2026-06-18)

## MCP Tools

| Tool | Package | Purpose |
|------|---------|---------|
| `ask-gemini` | @ask-llm/gemini-mcp | Send prompts to Gemini CLI with `@` file syntax. 1M+ token context. Live progressive output via `stream-json` |
| `ask-gemini-edit` | @ask-llm/gemini-mcp | Get structured OLD/NEW code edit blocks from Gemini |
| `fetch-chunk` | @ask-llm/gemini-mcp | Retrieve chunks from cached large responses |
| `ask-codex` | @ask-llm/codex-mcp | Send prompts to Codex CLI. GPT-5.6 Sol with Terra fallback; omit `sessionId` for ephemeral use, or pass `sessionId: ""` first to persist and resume |
| `ask-claude` | @ask-llm/claude-mcp | Send prompts to Claude Code CLI. Opus with Sonnet fallback; native sessions; Read/Glob/Grep-only workspace access |
| `ask-grok` | @ask-llm/grok-mcp | Send a one-shot Grok prompt through explicit `xai-api` (default) or `grok-cli`; exact harness model ID; no harness/model fallback |
| `ask-cursor-agent` | @ask-llm/mcp | Model-neutral Cursor Agent harness: separate provider (`claude`, `codex`, `gemini`, `grok`) + exact Cursor catalog model verified against that family, read-only ask mode, no force/trust/spend changes/fallback |
| `ask-ollama` | @ask-llm/ollama-mcp | Send prompts to local Ollama. Fully private, zero cost. Server-side conversation replay via `sessionId` |
| `ask-antigravity` | @ask-llm/antigravity-mcp | Send a prompt to Google Antigravity (`agy`) for a subscription-backed second opinion. Experimental; one-shot |
| `ask-llm` | @ask-llm/mcp | Unified orchestrator — pick provider per call. Fan out to all installed providers |
| `multi-llm` | @ask-llm/mcp | Dispatch the same prompt to multiple providers in parallel; returns per-provider responses + usage in one call |
| `get-usage-stats` | all | Per-session token totals, fallback counts, breakdowns by provider/model — all in-memory, no persistence |
| `diagnose` | @ask-llm/mcp | Self-diagnosis: Node version, PATH resolution, provider CLI presence + versions. Read-only |
| `ping` | all | Connection test — verify MCP setup |

Session-capable `ask-*` tools accept an optional `sessionId` parameter and return a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema` alongside the human-readable text. Codex requires `sessionId: ""` on the first call for a resumable thread; omitting it makes that call ephemeral. The orchestrator (`@ask-llm/mcp`) also exposes `usage://current-session` as an MCP Resource for live JSON snapshots.

### Usage Examples

```
ask codex to review the changes in src/auth.ts for security issues
ask claude for an independent opinion on this architecture (from Codex or another MCP client)
ask antigravity to debate this architecture plan in docs/design.md
ask ollama to explain src/config.ts (runs locally, no data sent anywhere)
ask gemini to summarize @. the current directory (1M+ context, @ is Gemini-only)
use multi-llm to compare what codex and gemini think about this approach
```

## CLI Subcommands

The orchestrator binary (`@ask-llm/mcp`) supports two CLI modes alongside the default MCP server:

```bash
# Interactive multi-provider REPL — switch providers, persist sessions, see usage live
npx @ask-llm/mcp repl

# Diagnose your setup — Node version, PATH, provider CLI versions, env vars
npx @ask-llm/mcp doctor                       # human-readable
npx @ask-llm/mcp doctor --json                # established full JSON, exit 1 on error
npx @ask-llm/mcp doctor --format toon         # bounded, versioned agent-facing TOON pilot
npx @ask-llm/mcp doctor --format toon --full  # full TOON escape hatch
```

The REPL ships sessions per provider (`/provider gemini`, `/provider codex`, `/new`, `/sessions`, `/usage`) and inherits all the executor behavior (quota fallback, stream-json output for Gemini, native session resume).

## Models

| Provider | Default | Fallback |
|----------|---------|----------|
| Gemini | `gemini-3.1-pro-preview` | `gemini-3.6-flash` (on quota) |
| Codex | `gpt-5.6-sol` | `gpt-5.6-terra` (on quota) |
| Claude | `opus` | `sonnet` (on overload/unavailability) |
| Grok | API: `grok-4.6`; CLI: exact `grok models` ID (effort `high`) | — (explicit harness/model selection; no fallback) |
| Antigravity | `gemini-3.1-pro` (`--effort high`) | `gemini-3.5-flash` (on rate limit); model-less recovery if a shipped slug is rejected |
| Ollama | `qwen3.6:27b` | — (local; errors if the model isn't pulled) |

Gemini, Codex, Claude, and Antigravity automatically fall back under their documented provider-specific conditions. Grok and Ollama never substitute a model: Grok preserves the explicit API/CLI harness catalog selection, while Ollama preserves the locally pulled model — if the requested model isn't pulled, it returns a clear `ollama pull` error.

## Documentation

- **Docs site:** [lykhoyda.github.io/ask-llm](https://lykhoyda.github.io/ask-llm/)
- **AI-readable:** [llms.txt](https://lykhoyda.github.io/ask-llm/llms.txt) | [llms-full.txt](https://lykhoyda.github.io/ask-llm/llms-full.txt)

## Contributing

Contributions are welcome! See [open issues](https://github.com/Lykhoyda/ask-llm/issues) for things to work on.

## License

MIT License. See [LICENSE](LICENSE) for details.

**Disclaimer:** This is an unofficial, third-party tool and is not affiliated with, endorsed, or sponsored by Anthropic, Google, OpenAI, or xAI.
