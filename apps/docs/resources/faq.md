---
description: Frequently asked questions about Ask LLM MCP servers, covering setup, multi-provider usage, sessions, the Claude Code plugin, and troubleshooting.
---

# Frequently Asked Questions

## General

### What is Ask LLM?

A set of MCP servers that bridge your AI client (Claude Code, Codex CLI, Cursor, Warp, Copilot, any of [40+ MCP-compatible clients](https://modelcontextprotocol.io/clients)) with up to five LLM providers through their local CLIs: OpenAI Codex, Anthropic Claude, Google Antigravity (`agy`), Ollama (fully local), and Google Gemini. Plus a Claude Code plugin layer with slash commands, reviewer subagents, and the opt-in continuous `codex-pair` review hook.

### Why use this instead of the providers directly?

- **One interface for every provider**: you don't switch between separate CLIs
- **Multi-provider parallel dispatch**: `multi-llm` and `/compare` send the same prompt to multiple providers in one call
- **Verified code review**: `/multi-review` cross-checks each finding against source before presenting (catches false positives)
- **Session continuity across providers**: `sessionId` works across four session-capable providers (Claude, Gemini, Codex, Ollama); Antigravity is single-turn
- **Built-in operational hardening**: quota fallback, PATH resolution, stdin handling, stream-json output for live progressive content
- **Diagnostic surface**: `npx ask-llm-mcp doctor` and the `diagnose` MCP tool tell you what's wrong before you have to investigate

### Is it free?

The MCP servers are MIT-licensed and free. Provider costs depend on which provider you use:
- **Codex**: per OpenAI billing
- **Claude**: covered by your Claude subscription or Anthropic billing, depending on Claude Code authentication
- **Antigravity**: covered by your Google AI Pro/Ultra subscription (no per-token billing)
- **Ollama**: free (runs locally on your machine)
- **Gemini**: requires a Gemini Code Assist Standard/Enterprise seat ([enterprise-gated from 2026-06-18](/providers/gemini))

### Why is Gemini enterprise-gated, and what should I use instead?

From 2026-06-18, Google restricts Gemini CLI to Gemini Code Assist Standard/Enterprise seats, and free, Google AI Pro, and Ultra accounts lose access. `ask-gemini-mcp` still installs, but a non-enterprise account will then see actionable guidance instead of output. Use **Codex** (`ask-codex`), **Claude** (`ask-claude` from a non-Claude host), **Antigravity** (`ask-antigravity`, the Google-sanctioned successor, subscription-backed via Google AI Pro/Ultra), or **Ollama** (`ask-ollama`) instead. See [Antigravity](/providers/antigravity).

### Does it work on Windows?

Yes for the per-provider packages. The orchestrator (`ask-llm-mcp`) and plugin should work too but get less Windows testing. Open an issue if you hit a Windows-specific bug.

---

## Setup

### Do I need every provider?

No. The orchestrator (`ask-llm-mcp`) auto-detects which CLIs are installed and only registers tools for available providers. Install one and add others anytime.

### What Node.js version do I need?

Node v20.0.0 or higher (LTS 20 or 22). The doctor command (`npx ask-llm-mcp doctor`) will warn if you're on an older version; Gemini CLI 0.36+ uses ES2024 regex features that crash on Node 18 ([ADR-046](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)).

### Should I use the orchestrator or per-provider packages?

| Choose orchestrator (`ask-llm-mcp`) when | Choose per-provider when |
|---|---|
| You want one MCP server, all providers | You only use one provider |
| You want `multi-llm` parallel dispatch | You need provider-specific tools (`ask-gemini-edit`, `fetch-chunk`) |
| You want the doctor + REPL CLI subcommands | You want shorter tool names without a `provider` parameter |

Both can coexist; install whatever fits your workflow.

### Can I use this with Claude Code?

Yes, that's the primary client. Use `claude mcp add --scope user ask-llm -- npx -y ask-llm-mcp`. The Claude Code plugin (`/plugin marketplace add Lykhoyda/ask-llm`) adds slash commands, subagents, and hooks on top.

### Can I use this with Claude Desktop, Cursor, Warp, etc.?

Yes, any STDIO MCP client works. See the [Quick Start](/getting-started#2-register-the-mcp-server) for client-specific config.

### Can Codex ask Claude for a second opinion?

Yes. Register the dedicated provider with `codex mcp add claude -- npx -y ask-claude-mcp`, then ask Codex to call `ask-claude`. The Claude subprocess is restricted to Read, Glob, and Grep; Codex applies any resulting changes. The provider is not exposed when Claude Code itself is the host because Claude Code rejects nested sessions.

---

## Usage

### What's the `@` syntax?

A Gemini CLI feature for including files in prompts:
- `@file.js`: single file
- `@src/*.js`: multiple files
- `@**/*.ts`: all TypeScript files
- `@.`: current directory

It works with the `ask-gemini` tool (and the underlying Gemini CLI). Codex and Ollama don't have direct equivalents; quote or paste relevant code into the prompt instead.

### How do multi-turn sessions work?

Every session-capable `ask-*` tool returns a session ID. Pass it back via the `sessionId` parameter to continue. Claude, Gemini, and Codex use native CLI resume; Ollama uses server-side message replay. See [Multi-Turn Sessions](/usage/multi-turn-sessions) for details.

### How do I send a prompt to multiple providers at once?

Use the `multi-llm` MCP tool:

```text
Use multi-llm to send "is this thread-safe?" to Gemini and Codex
```

Or the `/compare` skill (Claude Code plugin) for the same thing with a nicer interactive surface. Or `/multi-review` if you want verified code review findings rather than raw responses.

### Which model should I use?

Defaults are tuned per provider with auto-fallback. Don't override unless you have a specific reason. See [Model Selection](/concepts/models) for the full breakdown.

### Can I track my token spending?

Yes, every `ask-*` response includes `result.structuredContent.usage` with token counts, duration, and fallback flag. For per-session totals, call the `get-usage-stats` MCP tool, read the `usage://current-session` MCP Resource, or type `/usage` in the REPL.

### Can I use this in CI/CD?

The MCP server is designed for interactive development. For CI workflows, you can call the executor packages directly via Node:

```js
import { executeGeminiCLI } from "ask-gemini-mcp/executor";
const result = await executeGeminiCLI({ prompt: "review this diff" });
```

A dedicated GitHub Action was built and then withdrawn ([ADR-061](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)); focus shifted to MCP/plugin usage for CLI workflows. CI integration may return as a future feature.

---

## Privacy & Security

### Is my code sent to Google / OpenAI?

Only when you explicitly use `ask-codex` (OpenAI), `ask-claude` (Anthropic), or `ask-gemini` / `ask-antigravity` (Google). For private code, use `ask-ollama`; it runs entirely locally and never makes external network calls.

### Where do session files live?

- **Gemini sessions**: managed by the Gemini CLI in its own storage (`~/.gemini/`)
- **Codex sessions**: managed by Codex CLI in `~/.codex/`
- **Claude sessions**: managed by Claude Code CLI in its own local session storage
- **Ollama sessions**: server-side replay store at `/tmp/ask-llm-sessions/<id>.json`, owner-only permissions (0o600 file / 0o700 dir), 24-hour TTL, atomic temp+rename writes ([ADR-063](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md))

The Ollama session permissions specifically prevent other users on shared systems from reading your prompts.

### Are my API keys exposed?

Auth is delegated entirely to the provider CLIs (`gemini login`, Codex auth, Ollama doesn't need keys). The MCP server never reads, stores, or transmits your credentials; it just spawns the CLIs and the CLIs handle auth themselves.

---

## Troubleshooting

### Why is it slow?

Large-context Gemini calls are inherently slow (the model is reading a lot). The Gemini executor uses `--output-format stream-json` so you see progressive output rather than a frozen wait; incoming text is forwarded to MCP progress notifications ([ADR-057](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)). Codex at high reasoning effort can take several minutes; this is normal for the model, not a server issue.

### Where do I get logs?

Set `GMCPT_LOG_LEVEL=debug` in your MCP client's env config to see verbose server logs. They go to stderr; Claude Desktop captures them at `~/Library/Logs/Claude/mcp-server-*.log` (macOS).

### My setup isn't working: what do I check first?

Run the doctor:

```bash
npx ask-llm-mcp doctor
```

It checks Node version, PATH, every provider CLI's presence and version, and key env vars. It works even when MCP itself can't start. 90%+ of setup issues show up here as a clear failed-check line.

If the doctor says everything's fine but tool calls still fail, check the Troubleshooting page for specific error patterns.

---

## More Questions?

- [Documentation](/): start here for general usage
- [GitHub Issues](https://github.com/Lykhoyda/ask-llm/issues): known bugs and feature requests
- [GitHub Discussions](https://github.com/Lykhoyda/ask-llm/discussions): Q&A and ideas
- [DECISIONS.md](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md): every architectural decision documented as an ADR
