<div align="center">

# Ask LLM

**Give your AI coding assistant a second opinion — from a different model.**

Claude Code, Codex CLI, Cursor, Claude Desktop, or any of [40+ MCP clients](https://modelcontextprotocol.io/clients) can call Codex, Claude, Grok, Antigravity, Ollama, or Gemini to review a diff, debate a plan, or catch the bug the first model missed. Standard [MCP](https://modelcontextprotocol.io/); no prompt hacks.

[![CI](https://img.shields.io/github/actions/workflow/status/Lykhoyda/ask-llm/ci.yml?branch=main&label=CI&logo=github)](https://github.com/Lykhoyda/ask-llm/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/actions/workflow/status/Lykhoyda/ask-llm/release.yml?branch=main&label=release&logo=npm)](https://github.com/Lykhoyda/ask-llm/actions/workflows/release.yml)
[![GitHub Release](https://img.shields.io/github/v/release/Lykhoyda/ask-llm?logo=github&label=release)](https://github.com/Lykhoyda/ask-llm/releases)
[![npm](https://img.shields.io/npm/v/@ask-llm/mcp?label=%40ask-llm%2Fmcp&logo=npm)](https://www.npmjs.com/package/@ask-llm/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

[Quick Start](#quick-start) · [Choose a reviewer](#choose-your-reviewer) · [Claude Code plugin](#the-ask-llm-plugin-claude-code-cursor-agent-pi) · [Docs](https://lykhoyda.github.io/ask-llm/) · [Packages](#packages)

</div>

```text
You:    ask codex to review src/auth.ts for security issues
Codex:  ⚠ verifyToken() compares tokens with === — not timing-safe (line 42)
        ⚠ the session cookie is missing a SameSite attribute
Claude: Good catches — applying both fixes to src/auth.ts.
```

One prompt. A second model reviews independently; your assistant applies the fix. No copy-pasting between tools.

## Why a second opinion?

Your primary AI is confident, but confidence isn't correctness. A second model with no stake in the first answer catches what it glossed over.

| You want to… | Ask LLM does |
|---|---|
| **Review a diff** | A different model analyzes your changes and surfaces issues your primary AI missed |
| **Debate a plan** | Send an architecture proposal for critique, alternatives, and trade-off analysis |
| **Get a second opinion on code** | Have another model review an approach independently before you commit to it |
| **Read more than fits** | Gemini and Antigravity ingest whole codebases in one call (1M+ tokens) |
| **Keep it local** | Route reviews through Ollama when nothing can leave your machine |
| **Compare models side by side** | `multi-llm` fans one prompt out to several providers in parallel |

## Quick Start

**Prerequisites:** [Node.js](https://nodejs.org/) 20+ on Linux or macOS, and at least one provider CLI installed and authenticated (see [Provider setup](#provider-setup)).

### Claude Code

```bash
# One install, every provider — auto-detects what you have
claude mcp add --scope user ask-llm -- npx -y @ask-llm/mcp
# first-class alternative after `npm install -g @ask-llm/mcp`:
# claude mcp add --scope user ask-llm -- ask-llm-mcp
```

Then try: `ask codex to review my last commit`. Run `npx @ask-llm/mcp doctor` if anything looks off.

<details>
<summary>Advanced: install split provider packages instead</summary>

```bash
claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp
claude mcp add --scope user grok -e XAI_API_KEY="$XAI_API_KEY" -- npx -y @ask-llm/grok-mcp
claude mcp add --scope user antigravity -- npx -y @ask-llm/antigravity-mcp
claude mcp add --scope user ollama -- npx -y @ask-llm/ollama-mcp
claude mcp add --scope user gemini -- npx -y @ask-llm/gemini-mcp
```

</details>

### Cursor

Add to `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (user):

```json
{
  "mcpServers": {
    "ask-llm": { "command": "npx", "args": ["-y", "@ask-llm/mcp"] }
  }
}
```

### Codex CLI

```toml
# ~/.codex/config.toml
[mcp_servers.ask-llm]
command = "npx"
args = ["-y", "@ask-llm/mcp"]
```

Want Codex to consult Claude specifically? `codex mcp add claude -- npx -y @ask-llm/claude-mcp`

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ask-llm": { "command": "npx", "args": ["-y", "@ask-llm/mcp"] }
  }
}
```

### Pi

Pi has no built-in MCP client, so it installs the host package instead, which registers native `ask-*` tools plus the shared skills:

```bash
pi install npm:@ask-llm/plugin
```

Then use `/skill:codex-review`, `/skill:multi-review`, `/skill:compare`, `/skill:brainstorm`, or just describe what you want. See the [Pi host guide](https://lykhoyda.github.io/ask-llm/plugin/pi) for trust, data-transfer, and compatibility details.

<details>
<summary>Any other MCP client (STDIO)</summary>

```json
{ "command": "npx", "args": ["-y", "@ask-llm/mcp"] }
```

Swap `@ask-llm/mcp` for `@ask-llm/codex-mcp`, `@ask-llm/claude-mcp`, `@ask-llm/grok-mcp`, `@ask-llm/antigravity-mcp`, `@ask-llm/ollama-mcp`, or `@ask-llm/gemini-mcp` to install a single provider.

</details>

## Choose your reviewer

The unified `@ask-llm/mcp` server is the recommended install: one registration, every provider you have, and parallel fan-out via `multi-llm`. Each provider is also available standalone.

| Provider | Best for | Model (default → fallback) | Requires |
|----------|----------|----------------------------|----------|
| **Codex** | Code reasoning, targeted reviews, architecture critique | `gpt-6-astra` → `gpt-5.6-terra` | OpenAI/Codex account |
| **Claude** | An independent Claude opinion from Codex or another non-Claude host | `opus` → `sonnet` | Claude Code CLI; read-only workspace tools |
| **Grok** | Grok 4.6 critique via xAI API or the official Grok CLI | `grok-4.6`, reasoning `high` (no fallback) | `XAI_API_KEY` or Grok CLI; one explicit harness per call |
| **Antigravity** | Subscription-backed second opinion; large-context reads | `gemini-3.1-pro` → `gemini-3.5-flash` (`--effort high`) | Google AI Pro/Ultra; `agy` CLI. Experimental, one-shot |
| **Ollama** | Private, offline, zero-cost review | `qwen3.8:27b` (no auto-fallback) | Ollama running locally |
| **Gemini** | Whole-codebase reads (1M+ tokens) | `gemini-3.1-pro-preview` → `gemini-3.8-flash` | Enterprise Gemini seat (see note) |

> **Gemini CLI is enterprise-only since 2026-06-18.** Google restricted Gemini CLI to Gemini Code Assist Standard/Enterprise seats; free, Google AI Pro, and Ultra accounts lost access. `@ask-llm/gemini-mcp` still installs, but non-enterprise accounts get actionable guidance instead of output. On a subscription plan, use **Antigravity** (Google's sanctioned successor, covered by AI Pro/Ultra), **Codex**, **Claude**, or **Ollama**. [Announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)

Fallbacks fire only under each provider's documented conditions (quota for Gemini/Codex, overload for Claude, rate limit for Antigravity). Grok and Ollama never substitute a model: Grok sends the exact harness catalog ID unchanged, and Ollama returns a clear `ollama pull` error if the requested model isn't local. Full details in [Model Selection](https://lykhoyda.github.io/ask-llm/concepts/models).

## The Ask LLM plugin (Claude Code, Cursor Agent, Pi)

MCP gives your assistant the *tools*. The plugin, [`@ask-llm/plugin`](https://www.npmjs.com/package/@ask-llm/plugin), adds the *workflows*: slash-command reviews with a validation pipeline, multi-model brainstorming, and opt-in continuous pair review.

```
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

| Command | What it does |
|:---|:---|
| <nobr>`/multi-review`</nobr> | Parallel Antigravity + Codex review with a 4-phase validation pipeline and consensus highlighting |
| <nobr>`/codex-review`</nobr> · <nobr>`/gemini-review`</nobr> · <nobr>`/ollama-review`</nobr> · <nobr>`/antigravity-review`</nobr> | Single-provider reviews with confidence filtering |
| <nobr>`/sol-review`</nobr> | Model-pinned GPT-5.6 Sol review through Codex |
| <nobr>`/grok-review`</nobr> | Metered Grok review through xAI with exact model attribution and no fallback |
| <nobr>`/fable-review`</nobr> | Isolated, read-only review that requests the native Fable model and discloses runtime verification limits |
| <nobr>`/brainstorm`</nobr> | Claude Opus researches your real files in parallel with external providers, then synthesizes, weighting verified findings higher. Also supports an exact no-Gemini Grok + GPT-5.6 Sol panel routed through Cursor Agent |
| <nobr>`/compare`</nobr> | Raw side-by-side answers from multiple providers, no synthesis |
| <nobr>**`codex-pair`**</nobr> | Opt-in continuous review: Codex checks every Edit/Write/MultiEdit when a `.codex-pair/context.md` marker is present |

Review agents follow a 4-phase pipeline inspired by [Anthropic's code-review plugin](https://github.com/anthropics/claude-code/tree/main/plugins/code-review): context gathering, prompt construction with explicit false-positive exclusions, synthesis, and source-level validation of each finding.

<details>
<summary>Host support matrix</summary>

`@ask-llm/plugin` is one package, one version, one release lifecycle, and one canonical skill corpus. Claude Code loads its marketplace agents and hooks; Cursor Agent loads the adapted `/codex-pair` and `/grok-pair` skills through Agent Skills plus `mcp.json` (`agent --plugin-dir ./packages/claude-plugin`; see the [Cursor Agent host guide](https://lykhoyda.github.io/ask-llm/plugin/cursor)); Pi loads explicit native tools, portable skill adapters, and a thin lifecycle extension.

| Capability | Claude Code | Cursor Agent | Codex CLI host | Pi |
|---|---:|---:|---:|---:|
| Provider transport | MCP | MCP (`mcp.json`, unified `ask-llm` only) | MCP | native Ask LLM tools (no built-in MCP) |
| Review/compare/brainstorm skills | yes | Agent Skills | tools only | `/skill:<name>` + natural language |
| Isolated reviewer contexts / Fable | yes | no; `fable-review` excluded | no | no; `fable-review` excluded |
| codex-pair | hooks | on-demand persisted session | no | lifecycle extension |
| `/grok-pair` | yes (explicit Cursor/xAI/CLI route) | direct xAI/CLI routes via pinned unified `ask-llm` (or user-installed `ask-grok`) | no | excluded |
| Blocking HIGH Stop gate | opt-in | no | no | no; surfaced non-blockingly |
| Async pairing in one-shot print | n/a | on-demand skill | no | unsupported |

Pi specifics: codex-pair requires the repository marker, Pi project trust, **and** interactive user-owned consent via `/codex-pair`; a committed marker alone never authorizes source transfer or cost. Pi surfaces findings non-blockingly and does not claim Claude's blocking Stop gate or one-shot print parity. `fable-review` is Claude Code-only. Provider CLI authentication is separate from Pi's host-model login. Update or remove with `pi update npm:@ask-llm/plugin` / `pi remove npm:@ask-llm/plugin`.

</details>

See the [plugin docs](https://lykhoyda.github.io/ask-llm/plugin/overview) for hooks, agents, and configuration.

## MCP tools

| Tool | Package | Purpose |
|------|---------|---------|
| `ask-llm` | `@ask-llm/mcp` | Unified orchestrator: pick a provider per call, or fan out to every installed provider |
| `multi-llm` | `@ask-llm/mcp` | Send one prompt to multiple providers in parallel; returns per-provider responses and usage in one call |
| `ask-codex` | `@ask-llm/codex-mcp` | Codex CLI. GPT-6 Astra with Terra fallback. Omit `sessionId` for ephemeral use, or pass `sessionId: ""` first to persist and resume |
| `ask-claude` | `@ask-llm/claude-mcp` | Claude Code CLI. Opus with Sonnet fallback; native sessions; Read/Glob/Grep-only workspace access |
| `ask-grok` | `@ask-llm/grok-mcp` | One-shot Grok prompt through explicit `xai-api` (default) or `grok-cli`; exact harness model ID; no harness/model fallback |
| `ask-cursor-agent` | `@ask-llm/mcp` | Model-neutral Cursor Agent harness: separate provider (`claude`, `codex`, `gemini`, `grok`) + exact Cursor catalog model verified against that family; read-only ask mode; no force/trust/spend changes or fallback |
| `ask-antigravity` | `@ask-llm/antigravity-mcp` | Google Antigravity (`agy`) for a subscription-backed second opinion. Experimental; one-shot |
| `ask-ollama` | `@ask-llm/ollama-mcp` | Local Ollama. Fully private, zero cost. Server-side conversation replay via `sessionId` |
| `ask-gemini` | `@ask-llm/gemini-mcp` | Gemini CLI with `@` file syntax. 1M+ token context. Live progressive output via `stream-json` |
| `ask-gemini-edit` | `@ask-llm/gemini-mcp` | Structured OLD/NEW code edit blocks from Gemini |
| `fetch-chunk` | `@ask-llm/gemini-mcp` | Retrieve chunks from cached large responses |
| `get-usage-stats` | all | Per-session token totals, fallback counts, breakdowns by provider/model. In-memory only |
| `diagnose` | `@ask-llm/mcp` | Self-diagnosis: Node version, PATH resolution, provider CLI presence and versions. Read-only |
| `ping` | all | Connection test |

Session-capable `ask-*` tools accept an optional `sessionId` and return a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema` alongside the human-readable text. Codex requires `sessionId: ""` on the first call for a resumable thread. The orchestrator also exposes `usage://current-session` as an MCP Resource for live JSON snapshots.

### Things to say

```
ask codex to review the changes in src/auth.ts for security issues
ask claude for an independent opinion on this architecture        (from Codex or another non-Claude client)
ask antigravity to debate the plan in docs/design.md
ask ollama to explain src/config.ts                                 (runs locally, nothing leaves your machine)
ask gemini to summarize @. the current directory                    (1M+ context; @ syntax is Gemini-only)
use multi-llm to compare what codex and grok think about this approach
```

More patterns in [How to Ask](https://lykhoyda.github.io/ask-llm/usage/how-to-ask) and [Multi-Turn Sessions](https://lykhoyda.github.io/ask-llm/usage/multi-turn-sessions).

## CLI

The `@ask-llm/mcp` binary (`ask-llm-mcp`) starts the MCP server when run with no arguments. With arguments it's a CLI; `ask-llm-mcp --help` is the canonical reference.

```bash
# Diagnose your setup: Node version, PATH, provider CLI versions, env vars
npx @ask-llm/mcp doctor                       # human-readable
npx @ask-llm/mcp doctor --json                # full JSON, exit 1 on error
npx @ask-llm/mcp doctor --format toon         # bounded, versioned agent-facing TOON pilot
npx @ask-llm/mcp doctor --format toon --full  # full TOON escape hatch

# Interactive multi-provider REPL: switch providers, persist sessions, watch usage live
npx @ask-llm/mcp repl
```

The REPL keeps a session per provider (`/provider codex`, `/new`, `/sessions`, `/usage`) and inherits all executor behavior: quota fallback, `stream-json` output for Gemini, native session resume.

## Provider setup

Install and authenticate whichever providers you want to consult. The unified server detects what's present.

| Provider | Setup |
|---|---|
| [Codex CLI](https://github.com/openai/codex) | Install and sign in |
| [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/getting-started) | Install and sign in (for Codex or other clients consulting Claude) |
| [xAI API](https://docs.x.ai/) / Grok CLI | Set `XAI_API_KEY` for the default metered harness, or install and authenticate official Grok Build and pin `harness: "grok-cli"` per request (or set `ASK_GROK_HARNESS=grok-cli`). No failover between harnesses |
| [Cursor CLI](https://cursor.com/docs/cli) | Optional model-neutral harness. Authenticate and pick an exact ID from `agent --list-models` |
| [Antigravity CLI](https://antigravity.google) (`agy`) | Version >= 1.1.5, logged in once (Google AI Pro/Ultra). Verify with `agy --version` |
| [Ollama](https://ollama.com) | Running locally with a model pulled: `ollama pull qwen3.8:27b` |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `npm install -g @google/gemini-cli && gemini login`. Enterprise-gated since 2026-06-18 |

## Packages

| Package | What it is | Version | Downloads |
|---------|------------|---------|-----------|
| [`@ask-llm/mcp`](https://www.npmjs.com/package/@ask-llm/mcp) | **Unified MCP server** (recommended): all providers, `multi-llm`, `ask-cursor-agent`, `doctor`, REPL | [![npm](https://img.shields.io/npm/v/@ask-llm/mcp)](https://www.npmjs.com/package/@ask-llm/mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/mcp)](https://www.npmjs.com/package/@ask-llm/mcp) |
| [`@ask-llm/plugin`](https://www.npmjs.com/package/@ask-llm/plugin) | Claude Code + Cursor Agent + Pi host package (skills, agents, hooks) | [![npm](https://img.shields.io/npm/v/@ask-llm/plugin)](https://www.npmjs.com/package/@ask-llm/plugin) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/plugin)](https://www.npmjs.com/package/@ask-llm/plugin) |
| [`@ask-llm/codex-mcp`](https://www.npmjs.com/package/@ask-llm/codex-mcp) | Codex-only MCP server | [![npm](https://img.shields.io/npm/v/@ask-llm/codex-mcp)](https://www.npmjs.com/package/@ask-llm/codex-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/codex-mcp)](https://www.npmjs.com/package/@ask-llm/codex-mcp) |
| [`@ask-llm/claude-mcp`](https://www.npmjs.com/package/@ask-llm/claude-mcp) | Claude-only MCP server | [![npm](https://img.shields.io/npm/v/@ask-llm/claude-mcp)](https://www.npmjs.com/package/@ask-llm/claude-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/claude-mcp)](https://www.npmjs.com/package/@ask-llm/claude-mcp) |
| [`@ask-llm/grok-mcp`](https://www.npmjs.com/package/@ask-llm/grok-mcp) | Grok-only MCP server | [![npm](https://img.shields.io/npm/v/@ask-llm/grok-mcp)](https://www.npmjs.com/package/@ask-llm/grok-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/grok-mcp)](https://www.npmjs.com/package/@ask-llm/grok-mcp) |
| [`@ask-llm/antigravity-mcp`](https://www.npmjs.com/package/@ask-llm/antigravity-mcp) | Antigravity-only MCP server | [![npm](https://img.shields.io/npm/v/@ask-llm/antigravity-mcp)](https://www.npmjs.com/package/@ask-llm/antigravity-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/antigravity-mcp)](https://www.npmjs.com/package/@ask-llm/antigravity-mcp) |
| [`@ask-llm/ollama-mcp`](https://www.npmjs.com/package/@ask-llm/ollama-mcp) | Ollama-only MCP server | [![npm](https://img.shields.io/npm/v/@ask-llm/ollama-mcp)](https://www.npmjs.com/package/@ask-llm/ollama-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/ollama-mcp)](https://www.npmjs.com/package/@ask-llm/ollama-mcp) |
| [`@ask-llm/gemini-mcp`](https://www.npmjs.com/package/@ask-llm/gemini-mcp) | Gemini-only MCP server | [![npm](https://img.shields.io/npm/v/@ask-llm/gemini-mcp)](https://www.npmjs.com/package/@ask-llm/gemini-mcp) | [![downloads](https://img.shields.io/npm/dt/@ask-llm/gemini-mcp)](https://www.npmjs.com/package/@ask-llm/gemini-mcp) |

<details>
<summary>Migrating from the old package names</summary>

All public MCP packages now live in the `@ask-llm` npm organization. The old names are deprecated, but executable names are unchanged: update the package argument in your MCP config and commands such as `ask-codex-mcp` and `ask-llm-mcp doctor` keep working after a global install.

| Old package | Use instead |
|-------------|-------------|
| `ask-llm-mcp` | `@ask-llm/mcp` |
| `ask-codex-mcp` | `@ask-llm/codex-mcp` |
| `@anton-lykhoyda/ask-claude-mcp` | `@ask-llm/claude-mcp` |
| `ask-antigravity-mcp` | `@ask-llm/antigravity-mcp` |
| `ask-ollama-mcp` | `@ask-llm/ollama-mcp` |
| `ask-gemini-mcp` | `@ask-llm/gemini-mcp` |

The [installation guide](https://lykhoyda.github.io/ask-llm/installation) has the complete package-to-executable mapping.

</details>

## Documentation

- **Docs site:** [lykhoyda.github.io/ask-llm](https://lykhoyda.github.io/ask-llm/) — [Getting Started](https://lykhoyda.github.io/ask-llm/getting-started), [How It Works](https://lykhoyda.github.io/ask-llm/concepts/how-it-works), [Troubleshooting](https://lykhoyda.github.io/ask-llm/resources/troubleshooting)
- **For AI agents:** [llms.txt](https://lykhoyda.github.io/ask-llm/llms.txt) · [llms-full.txt](https://lykhoyda.github.io/ask-llm/llms-full.txt)

## Contributing

Contributions are welcome. Start with the [open issues](https://github.com/Lykhoyda/ask-llm/issues) and [CONTRIBUTING.md](docs/CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).

**Disclaimer:** Ask LLM is an unofficial, third-party tool and is not affiliated with, endorsed, or sponsored by Anthropic, Google, OpenAI, or xAI.
