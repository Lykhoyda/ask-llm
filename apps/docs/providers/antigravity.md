---
description: Bridge Claude with Google's Antigravity CLI (agy) for subscription-backed code review and second opinions. Experimental; reads agy's structured JSON output from stdout.
---

# Antigravity

<ProviderStatus provider="antigravity" />

Bridge Claude with Google's Antigravity CLI (`agy`), Google's successor to Gemini CLI. Get a subscription-backed second opinion or code review using your Google AI Pro/Ultra plan, without per-token API billing.

> **Best for:** a subscription-backed second opinion if you have a Google AI Pro/Ultra plan, and larger-context reads. The Google-sanctioned successor to Gemini CLI.
> **Not for:** fine-grained per-edit automation; it's experimental. For continuous review, use Codex via `codex-pair`.

::: warning Experimental
Requires a [supported agy version](#prerequisites). Unified discovery, `doctor --live`, and ping report older or unparseable installations as detected but unusable and exclude them from dispatch; the executor repeats the version check before every model invocation. For default doctor, see [Quota diagnostics](#quota-diagnostics). It reads the headless `-p` response from `agy`'s `--output-format json` stdout. Supports follow-ups via `sessionId`; defaults to the **gemini-4-argon** model at **high** reasoning effort, falling back to **gemini-3.8-flash** on a rate limit.
:::

## Installation

<InstallSnippet provider="antigravity" />

Setup registers the unified Ask LLM server, which consults Antigravity through the `ask-llm` tool with `provider: "antigravity"`. Execution stays off until you set `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1` for the server. The tools listed below belong to the standalone `@ask-llm/antigravity-mcp` server, kept for earlier installations; see [Migration](/reference/migration) to move to the setup registration.

## Prerequisites

1. **Node.js** v24.0.0 or higher
2. **[Antigravity CLI](https://antigravity.google)** (`agy`) version 1.5.9 or newer installed and **logged in once**: verify with `agy --version`, then run `agy` interactively to complete the Google Sign-In before using the MCP server

## Tools

| Tool | Purpose |
|------|---------|
| `ask-antigravity` | Send a prompt to `agy` for a second opinion / code review. Optional `sessionId` resumes a conversation; `includeDirs` maps to `agy --add-dir` for monorepo context |
| `get-usage-stats` | Per-session token totals (in-memory) |
| `ping` | Connection test; reports whether `agy` is supported, unsupported, unusable, or missing |

`ask-antigravity` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`. Token usage — including cached and thinking tokens when agy reports them — comes from the JSON envelope's `usage` object.

## Sessions

Both unified `ask-llm` with `provider: "antigravity"` and standalone `ask-antigravity` return the JSON envelope's top-level `conversation_id` as `sessionId`, also shown as `[Session ID: …]` in text. Omit `sessionId` (or pass `""`) for a fresh conversation, then pass the returned ID on follow-ups:

```json
{ "provider": "antigravity", "prompt": "Continue the review", "sessionId": "<returned sessionId>" }
```

Follow-ups pass `--conversation <sessionId>` with the same settings overlay, read-only preamble, model, effort, timeout and sandbox rules as fresh calls. The overlay is reapplied on every resumed attempt, including model recovery. The [isolation limits](#what-protects-opted-in-runs) still apply.

Fresh calls and follow-ups report an error if agy's JSON `finished_reason` indicates a print timeout, interruption, or failure, even when agy exits successfully. The executor also recognizes legacy timeout warnings on stderr. If a turn hits the print timeout, increase `ASK_ANTIGRAVITY_TIMEOUT_MS` or shorten the prompt.

If agy cannot find the ID (for example, a conversation it no longer retains), agy 1.5.10 warns and starts fresh. Ask LLM discloses that reset in the answer and returns the new conversation's ID; prior context is lost. Other conversation-load errors propagate without a fresh-call retry. An envelope without a usable top-level ID still returns its answer, but offers no resumable `sessionId`.

## Quota diagnostics

`ask-llm doctor --live` also reports Antigravity's remaining quota and reset times via the sandboxed `/quota` built-in on a [supported agy version](#prerequisites). The detected agy version appears next to the quota result. Older or unparseable versions skip the quota check with a plain minimum-version line; failures and a five-second timeout are warnings and leave other diagnostics running. The quota probe needs no unisolated-execution opt-in and always uses `--sandbox` and the [settings overlay](#what-protects-opted-in-runs). The flag still permits minimal model calls to ready, permitted providers, including Antigravity when opted in, which may spend quota. Without `--live`, doctor starts no agy process, including provider and host version probes; it locates the executable and reads local configuration, leaving the version unchecked.

## Models

<FallbackChain provider="antigravity" />

- **Default:** `gemini-4-argon`, passed to `agy` via `--model`, at `high` reasoning effort via `--effort`
- **Rate-limit fallback:** `gemini-3.8-flash`, retried once on a rate limit
- **Quota diagnostics:** when a rate limit exhausts the available model attempts, a successful sandboxed `/quota` probe adds remaining quota percentages and reset times to the error; a failed probe leaves the usual rate-limit error
- **Model-unavailable recovery:** if agy rejects a model whose value equals one of the built-in base slugs (upstream drift), the executor retries once **without** a model and lets agy pick its default; any other rejected model fails with an actionable error pointing at `agy models`
- **Overrides:** `ASK_ANTIGRAVITY_MODEL` and `ASK_ANTIGRAVITY_EFFORT` (run `agy models` for the full list of kebab-case slugs, e.g. `claude-sonnet-4-6`). Legacy effort-carrying display strings like `Gemini 4 Argon (High)` are compatibility-only pins that still resolve; the default effort is only sent when the model value equals one of the built-in base slugs, because agy rejects `--effort` next to an effort-carrying name

## What protects opted-in runs

Antigravity review/tool, machine, and raw `/brainstorm` execution requires `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1`. Without it, Ask LLM refuses those calls before probing agy. Discovery and [sandboxed quota diagnostics](#quota-diagnostics) do not require the opt-in.

Every headless agy call, including the sandboxed quota probe, passes this session-only setting:

```text
--settings '{"agentMode":"","permissions":{"deny":["write_file(*)","command(*)"]}}'
```

- `agentMode: ""` keeps agy in Default mode. agy 1.5.7 and newer otherwise start headless runs in Auto mode where agy's terminal sandbox is available (macOS and most Linux). Auto runs commands without asking.
- The deny rules make agy refuse file writes and every command, including network commands such as `curl`. Reads and the review answer still work.
- agy applies `--settings` to that session only, so your own agy `settings.json` is never changed.

The [minimum agy version](#prerequisites) is the oldest version verified to enforce the overlay. Older agy is refused with an update message rather than run without it. The overlay is enforced by agy, not by the operating system, so the opt-in and its warning remain.

Before Ask LLM added the overlay, opted-in review calls could write files in your project and in any `includeDirs` directory on every supported agy version. From agy 1.5.7, on hosts where agy's terminal sandbox works, they could also run commands. If you set `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1`, update Ask LLM and install a [supported agy version](#prerequisites).

## How it works

Provider discovery runs `agy --version` and only makes Antigravity available to default or multi-provider dispatch when a [supported version](#prerequisites) is confirmed. Older versions remain visible as detected but unsupported, while an unparseable output or failed version probe is reported as detected but unusable. Ping includes the actual version when known, the required minimum, and an upgrade action; doctor behavior is described in [Quota diagnostics](#quota-diagnostics). Execution is refused before the executor version probe unless `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1`. Under that explicit opt-in, the executor warns that read-only isolation is not guaranteed: agy may modify files, run shell commands, and access the network. The executor then repeats the support check and invokes `agy -p … --output-format json` and reads the answer from the terminal JSON object's `response` key on stdout (a source chain of structured JSON → plain stdout only when the output does not look like JSON → an actionable no-output error). `--print-timeout` is set 5s below `ASK_ANTIGRAVITY_TIMEOUT_MS` so agy expires first. That expiry is exit 0 with a truncated answer and a stderr warning; the executor fails closed and names the timeout env var instead of returning the partial as complete. It also passes `--disable-slash-commands` so prompt text cannot expand as a slash command or skill. If the JSON envelope includes `denied_actions`, a complete answer gets a notice naming the refused actions. Concurrent calls need no serialization — each process's answer arrives on its own stdout. Every headless agy call also carries the session-only settings overlay described in [What protects opted-in runs](#what-protects-opted-in-runs). Opted-in runs keep the read-only prompt preamble and never pass `--dangerously-skip-permissions`; see [Config](#config) for `--sandbox` overrides. `--mode plan` is no longer passed: agy ignores it next to `--disable-slash-commands`.

Claude Code's `/brainstorm` uses a separate raw `agy` call. Without the exact opt-in value `1`, it skips Antigravity and discloses the reason in its synthesis. With opt-in, it checks `agy --version` and skips the participant with a disclosed reason and nonzero result if agy is [unsupported](#prerequisites) or the version cannot be verified. A supported installation runs with the warning that read-only isolation is not guaranteed and without `--dangerously-skip-permissions`. Its raw path fixes the model, effort, `--sandbox` flag and the same settings overlay; it does not inherit the executor's timeout handling, model fallback, or the model, effort, and sandbox overrides below.

## Config

| Env var | Default | Purpose |
|---------|---------|---------|
| `ASK_ANTIGRAVITY_TIMEOUT_MS` | `300000` | Process timeout (5 minutes). At the default, `agy --print-timeout` expires 5s earlier. |
| `ASK_ANTIGRAVITY_ALLOW_UNISOLATED` | unset | Only the exact value `1` permits unisolated review/tool, read-only machine, and `/brainstorm` raw agy execution |
| `ASK_ANTIGRAVITY_SANDBOX` | on | Set `0` to drop `--sandbox` from review calls if it blocks `--add-dir` context reads; the `/quota` diagnostic probe always uses `--sandbox` |
| `ASK_ANTIGRAVITY_MODEL` | `gemini-4-argon` | agy model passed via `--model`; on a rate limit the executor retries once on `gemini-3.8-flash` (run `agy models` for the list of kebab-case slugs, e.g. `claude-sonnet-4-6`; legacy display strings like `Gemini 4 Argon (High)` still resolve as compatibility-only pins) |
| `ASK_ANTIGRAVITY_EFFORT` | `high` | agy reasoning effort passed via `--effort` (`low` \| `medium` \| `high`). The default is paired with the built-in base slugs and with model-less recovery attempts; an explicit value is always passed — note agy limits tiers per model (run `agy models` to see each model's tiers). Invalid values warn and fall back to the default behavior |

## Limitations

- **Experimental:** the structured-output contract tracks `agy`'s JSON envelope; JSON-looking output that is corrupt or lacks an answer fails with an actionable error instead of surfacing raw JSON fragments.
- **Minimum version:** see [Prerequisites](#prerequisites); older or unverifiable installations are reported but excluded from dispatch.
- **Session retention:** sessions live in agy's own storage; an unavailable ID can start a fresh conversation with a disclosed reset (see [Sessions](#sessions)).
- **Timeouts:** `--print-timeout` expiry exits 0 with a partial JSON answer; Ask LLM fails closed and asks you to raise `ASK_ANTIGRAVITY_TIMEOUT_MS` or shorten the prompt.

## npm

- **Package:** [@ask-llm/antigravity-mcp](https://www.npmjs.com/package/@ask-llm/antigravity-mcp)
- **Binary:** `ask-antigravity-mcp`
