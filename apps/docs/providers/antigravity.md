---
description: Bridge Claude with Google's Antigravity CLI (agy) for subscription-backed code review and second opinions. Experimental; reads agy's structured JSON output from stdout.
---

# Antigravity

<ProviderStatus provider="antigravity" />

Bridge Claude with Google's Antigravity CLI (`agy`), Google's successor to Gemini CLI. Get a subscription-backed second opinion or code review using your Google AI Pro/Ultra plan, without per-token API billing.

> **Best for:** a subscription-backed second opinion if you have a Google AI Pro/Ultra plan, and larger-context reads. The Google-sanctioned successor to Gemini CLI.
> **Not for:** fine-grained per-edit automation; it's one-shot and experimental. For continuous review, use Codex via `codex-pair`.

::: warning Experimental
Requires `agy` ≥ 1.1.5. Unified discovery, doctor, and ping report older or unparseable installations as detected but unusable and exclude them from dispatch; the executor repeats the version check before every model invocation. It reads the headless `-p` response from `agy`'s `--output-format json` stdout (supported across the whole ≥ 1.1.5 range). Single-turn only (no multi-turn); defaults to the **gemini-3.1-pro** model at **high** reasoning effort, falling back to **gemini-3.5-flash** on a rate limit.
:::

## Installation

<InstallSnippet provider="antigravity" />

Or install globally: `npm install -g @ask-llm/antigravity-mcp`

## Prerequisites

1. **Node.js** v20.0.0 or higher
2. **[Antigravity CLI](https://antigravity.google)** (`agy`) version 1.1.5 or newer installed and **logged in once**: verify with `agy --version`, then run `agy` interactively to complete the Google Sign-In before using the MCP server

## Tools

| Tool | Purpose |
|------|---------|
| `ask-antigravity` | Send a prompt to `agy` for a second opinion / code review. Optional `includeDirs` maps to `agy --add-dir` for monorepo context |
| `get-usage-stats` | Per-session token totals (in-memory) |
| `ping` | Connection test; reports whether `agy` is supported, unsupported, unusable, or missing |

`ask-antigravity` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`. Token usage — including cached and thinking tokens when agy reports them — comes from the JSON envelope's `usage` object (`cache_read_tokens` requires agy ≥ 1.1.7).

## Models

<FallbackChain provider="antigravity" />

- **Default:** `gemini-3.1-pro`, passed to `agy` via `--model`, at `high` reasoning effort via `--effort` (agy ≥ 1.1.5 splits the effort tier out of the model name)
- **Rate-limit fallback:** `gemini-3.5-flash`, retried once on a rate limit
- **Model-unavailable recovery:** if agy rejects a model whose value equals one of the built-in base slugs (upstream drift), the executor retries once **without** a model and lets agy pick its default; any other rejected model fails with an actionable error pointing at `agy models`
- **Overrides:** `ASK_ANTIGRAVITY_MODEL` and `ASK_ANTIGRAVITY_EFFORT` (run `agy models` for the full list of kebab-case slugs, e.g. `claude-sonnet-4-6`). Legacy effort-carrying display strings like `Gemini 3.1 Pro (High)` are compatibility-only pins that still resolve; the default effort is only sent when the model value equals one of the built-in base slugs, because agy rejects `--effort` next to an effort-carrying name

## How it works

Provider discovery runs `agy --version` and only makes Antigravity available to default or multi-provider dispatch when version 1.1.5 or newer is confirmed. Older versions remain visible as detected but unsupported, while an unparseable output or failed version probe is reported as detected but unusable; doctor and ping include the actual version when known, the required minimum, and an upgrade action. The executor repeats the same support check before each request, then invokes `agy -p … --output-format json` and reads the answer from the terminal JSON object's `response` key on stdout (a source chain of structured JSON → plain stdout only when the output does not look like JSON → an actionable no-output error). On agy ≥ 1.1.9 it also passes `--disable-slash-commands` so prompt text can never expand as a slash command or skill (older versions reject the flag, so it is version-gated). Concurrent calls need no serialization — each process's answer arrives on its own stdout. It runs with a read-only prompt preamble plus `--dangerously-skip-permissions` + `--sandbox` so `agy` never hangs on approval prompts.

## Config

| Env var | Default | Purpose |
|---------|---------|---------|
| `ASK_ANTIGRAVITY_TIMEOUT_MS` | `300000` | Process timeout (5 minutes) |
| `ASK_ANTIGRAVITY_SANDBOX` | on | Set `0` to drop `agy`'s `--sandbox` flag if it blocks `--add-dir` context reads |
| `ASK_ANTIGRAVITY_MODEL` | `gemini-3.1-pro` | agy model passed via `--model`; on a rate limit the executor retries once on `gemini-3.5-flash` (run `agy models` for the list of kebab-case slugs, e.g. `claude-sonnet-4-6`; legacy display strings like `Gemini 3.1 Pro (High)` still resolve as compatibility-only pins) |
| `ASK_ANTIGRAVITY_EFFORT` | `high` | agy reasoning effort passed via `--effort` (`low` \| `medium` \| `high`). The default is paired with the built-in base slugs and with model-less recovery attempts; an explicit value is always passed — note agy limits tiers per model (e.g. `gemini-3.1-pro` has no `medium`). Invalid values warn and fall back to the default behavior |

## Limitations

- **Experimental:** the structured-output contract tracks `agy`'s JSON envelope; JSON-looking output that is corrupt or lacks an answer fails with an actionable error instead of surfacing raw JSON fragments.
- **Minimum version:** `agy` 1.1.5; older or unverifiable installations are reported but excluded from dispatch.
- **Single-turn:** no multi-turn sessions yet; the executor accepts and ignores `sessionId` (headless resume via agy's JSON `conversation_id` is tracked as follow-up work). Model selection *is* supported via `--model` (defaults to gemini-3.1-pro at high effort, with a gemini-3.5-flash rate-limit fallback; see [Config](#config)); only the short `-m` flag hangs under `-p`.
- **Interactive auth:** requires an `agy` login, so it isn't suited to headless CI.

## npm

- **Package:** [@ask-llm/antigravity-mcp](https://www.npmjs.com/package/@ask-llm/antigravity-mcp)
- **Binary:** `ask-antigravity-mcp`
