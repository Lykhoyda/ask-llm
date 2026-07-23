---
description: Bridge Claude with Google's Antigravity CLI (agy) for subscription-backed code review and second opinions. Experimental; uses agy stdout with a transcript-file fallback.
---

# Antigravity

<ProviderStatus provider="antigravity" />

Bridge Claude with Google's Antigravity CLI (`agy`), Google's successor to Gemini CLI. Get a subscription-backed second opinion or code review using your Google AI Pro/Ultra plan, without per-token API billing.

> **Best for:** a subscription-backed second opinion if you have a Google AI Pro/Ultra plan, and larger-context reads. The Google-sanctioned successor to Gemini CLI.
> **Not for:** fine-grained per-edit automation; it's one-shot and experimental. For continuous review, use Codex via `codex-pair`.

::: warning Experimental
On `agy` ≥ 1.0.6 the headless `-p` mode prints the response to stdout (used directly); older versions / edge cases fall back to reading `agy`'s transcript files, which is sensitive to `agy`'s on-disk layout. Single-turn only (no multi-turn); defaults to the **gemini-3.1-pro** model at **high** reasoning effort, falling back to **gemini-3.5-flash** on a rate limit. Validated end-to-end against `agy` 1.1.5.
:::

## Installation

<InstallSnippet provider="antigravity" />

Or install globally: `npm install -g @ask-llm/antigravity-mcp`

## Prerequisites

1. **Node.js** v20.0.0 or higher
2. **[Antigravity CLI](https://antigravity.google)** (`agy`) installed and **logged in once**: run `agy` interactively to complete the Google Sign-In before using the MCP server

## Tools

| Tool | Purpose |
|------|---------|
| `ask-antigravity` | Send a prompt to `agy` for a second opinion / code review. Optional `includeDirs` maps to `agy --add-dir` for monorepo context |
| `get-usage-stats` | Per-session token totals (in-memory) |
| `ping` | Connection test; also reports whether `agy` is installed |

`ask-antigravity` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`.

## Models

<FallbackChain provider="antigravity" />

- **Default:** `gemini-3.1-pro`, passed to `agy` via `--model`, at `high` reasoning effort via `--effort` (agy ≥ 1.1.5 splits the effort tier out of the model name)
- **Rate-limit fallback:** `gemini-3.5-flash`, retried once on a rate limit
- **Model-unavailable recovery:** if agy rejects a model whose value equals one of the built-in base slugs (upstream drift), the executor retries once **without** a model and lets agy pick its default; any other rejected model fails with an actionable error pointing at `agy models`
- **Overrides:** `ASK_ANTIGRAVITY_MODEL` and `ASK_ANTIGRAVITY_EFFORT` (run `agy models` for the full list of kebab-case slugs, e.g. `claude-sonnet-4-6`). Legacy effort-carrying display strings like `Gemini 3.1 Pro (High)` are compatibility-only pins that still resolve; the default effort is only sent when the model value equals one of the built-in base slugs, because agy rejects `--effort` next to an effort-carrying name

## How it works

`agy` ≥ 1.0.6 prints the response to stdout (gemini-cli #27466, the empty-stdout bug, is fixed there), so the executor uses a **stdout-first source chain**: structured JSON → plain stdout → transcript file. The transcript fallback reads the complete `transcript_full.jsonl` under `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/`. Calls are serialized in-process (concurrent `agy` runs race on shared state files). It runs with a read-only prompt preamble plus `--dangerously-skip-permissions` + `--sandbox` so `agy` never hangs on approval prompts.

## Config

| Env var | Default | Purpose |
|---------|---------|---------|
| `ASK_ANTIGRAVITY_TIMEOUT_MS` | `300000` | Process timeout (5 minutes) |
| `ASK_ANTIGRAVITY_SANDBOX` | on | Set `0` to drop `agy`'s `--sandbox` flag if it blocks `--add-dir` context reads |
| `ASK_ANTIGRAVITY_MODEL` | `gemini-3.1-pro` | agy model passed via `--model`; on a rate limit the executor retries once on `gemini-3.5-flash` (run `agy models` for the list of kebab-case slugs, e.g. `claude-sonnet-4-6`; legacy display strings like `Gemini 3.1 Pro (High)` still resolve as compatibility-only pins) |
| `ASK_ANTIGRAVITY_EFFORT` | `high` | agy reasoning effort passed via `--effort` (`low` \| `medium` \| `high`, agy ≥ 1.1.5). The default is paired with the built-in base slugs and with model-less recovery attempts; an explicit value is always passed — note agy limits tiers per model (e.g. `gemini-3.1-pro` has no `medium`). Invalid values warn and fall back to the default behavior |

## Limitations

- **Experimental:** the transcript fallback is sensitive to changes in `agy`'s on-disk format.
- **Single-turn:** no multi-turn sessions (no capturable conversation id, antigravity-cli #7). Model selection *is* supported via `--model` (defaults to gemini-3.1-pro at high effort, with a gemini-3.5-flash rate-limit fallback; see [Config](#config)); only the short `-m` flag hangs under `-p`.
- **Interactive auth:** requires an `agy` login, so it isn't suited to headless CI.

## npm

- **Package:** [@ask-llm/antigravity-mcp](https://www.npmjs.com/package/@ask-llm/antigravity-mcp)
- **Binary:** `ask-antigravity-mcp`
