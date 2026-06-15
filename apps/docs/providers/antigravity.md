---
description: Bridge Claude with Google's Antigravity CLI (agy) for subscription-backed code review and second opinions. Experimental — uses agy stdout with a transcript-file fallback.
---

# Antigravity

Bridge Claude with Google's Antigravity CLI (`agy`) — Google's successor to Gemini CLI. Get a subscription-backed second opinion or code review using your Google AI Pro/Ultra plan, without per-token API billing.

> **Best for:** a subscription-backed second opinion if you have a Google AI Pro/Ultra plan, and larger-context reads. The Google-sanctioned successor to Gemini CLI.
> **Not for:** fine-grained per-edit automation — it's one-shot and experimental. For continuous review, use Codex via `codex-pair`.

::: warning Experimental
On `agy` ≥ 1.0.6 the headless `-p` mode prints the response to stdout (used directly); older versions / edge cases fall back to reading `agy`'s transcript files, which is sensitive to `agy`'s on-disk layout. Single-turn only (no multi-turn); defaults to the **Gemini 3.5 Flash (High)** model. Validated end-to-end against `agy` 1.0.6.
:::

## Installation

<SetupTabs provider="antigravity" />

Or install globally:

```bash
npm install -g ask-antigravity-mcp
```

## Prerequisites

1. **Node.js** v20.0.0 or higher
2. **[Antigravity CLI](https://antigravity.google)** (`agy`) installed and **logged in once** — run `agy` interactively to complete the Google Sign-In before using the MCP server

## Tools

| Tool | Purpose |
|------|---------|
| `ask-antigravity` | Send a prompt to `agy` for a second opinion / code review. Optional `includeDirs` maps to `agy --add-dir` for monorepo context |
| `get-usage-stats` | Per-session token totals (in-memory) |
| `ping` | Connection test; also reports whether `agy` is installed |

`ask-antigravity` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`.

## How it works

`agy` ≥ 1.0.6 prints the response to stdout (gemini-cli #27466, the empty-stdout bug, is fixed there), so the executor uses a **stdout-first source chain** — structured JSON → plain stdout → transcript file. The transcript fallback reads the complete `transcript_full.jsonl` under `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/`. Calls are serialized in-process (concurrent `agy` runs race on shared state files). It runs with a read-only prompt preamble plus `--dangerously-skip-permissions` + `--sandbox` so `agy` never hangs on approval prompts.

## Config

| Env var | Default | Purpose |
|---------|---------|---------|
| `ASK_ANTIGRAVITY_TIMEOUT_MS` | `300000` | Process timeout (5 minutes) |
| `ASK_ANTIGRAVITY_SANDBOX` | on | Set `0` to drop `agy`'s `--sandbox` flag if it blocks `--add-dir` context reads |
| `ASK_ANTIGRAVITY_MODEL` | `Gemini 3.5 Flash (High)` | agy model passed via `--model` (run `agy models` for the list — e.g. `Gemini 3.1 Pro (High)`, `Claude Sonnet 4.6 (Thinking)`) |

## Limitations

- **Experimental** — the transcript fallback is sensitive to changes in `agy`'s on-disk format.
- **Single-turn** — no multi-turn sessions (no capturable conversation id, antigravity-cli #7). Model selection *is* supported via `--model` (defaults to Gemini 3.5 Flash (High); see [Config](#config)) — only the short `-m` flag hangs under `-p`.
- **Interactive auth** — requires an `agy` login, so it isn't suited to headless CI.

## npm

- **Package:** [ask-antigravity-mcp](https://www.npmjs.com/package/ask-antigravity-mcp)
- **Binary:** `ask-antigravity-mcp`
