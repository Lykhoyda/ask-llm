---
description: Bridge Claude with OpenAI Codex CLI for GPT-6.2 Sol code review and analysis. Automatic fallback to GPT-6.1 Terra on quota limits.
---

# Codex

<ProviderStatus provider="codex" />

OpenAI's Codex CLI is the workhorse reviewer of the pair: code reasoning for targeted reviews, architecture critique, and diff analysis. Claude asks Codex; Codex asks [Claude](/providers/claude) back through the same Ask LLM installation.

> **Best for:** targeted code reasoning, architecture critique, and security review of specific files, the default workhorse reviewer.
> **Not for:** whole-repository reads beyond its context window (use Gemini or Antigravity), or fully offline/air-gapped use (it's a hosted model; use Ollama).

## Installation

<InstallSnippet provider="codex" />

Setup registers the unified Ask LLM server, which consults Codex through the `ask-llm` tool with `provider: "codex"`. In Claude Code, the plugin that setup installs also connects the `ask-codex` tool. In Codex itself, setup installs the workflows and prints the `codex mcp add` command for you to run; see [Install](/start/install). The tools listed below belong to the standalone `@ask-llm/codex-mcp` server, kept for earlier installations; see [Migration](/reference/migration) to move to the setup registration.

## Prerequisites

1. **Node.js** v24.0.0 or higher
2. **[Codex CLI](https://github.com/openai/codex)** installed and authenticated. Both GPT-6.2 models were verified on 0.167.0 with a ChatGPT subscription.

## Tools

| Tool | Purpose |
|------|---------|
| `ask-codex` | Send prompts to Codex CLI. Optional `reasoningEffort` and `noFallback`; omit `sessionId` for an ephemeral call, pass `sessionId: ""` to start a persisted thread, or pass a returned thread ID to resume it |
| `ask-codex-edit` | Propose structured code edits via a read-only `codex exec --output-schema` pass. Returns edit blocks for the calling client to apply |
| `get-usage-stats` | Per-session token totals + breakdowns. In-memory |
| `ask-codex-write` | Run explicit file-writing tasks, including image generation, with workspace-write permission. Replaces `ask-codex({ sandbox: "workspace-write" })` |
| `ping` | Fast connection test to verify MCP setup |

`ask-codex`, `ask-codex-write`, and `ask-codex-edit` return both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`. Calls are ephemeral by default for privacy: a Thread ID from a call that omitted `sessionId` is not resumable. To opt into continuity, pass `sessionId: ""` on the first call; its returned Thread ID is the same value as `structuredContent.sessionId`, and can be passed back on later calls.

`ask-codex` and unified `ask-llm` with Codex show an attribution line before the answer, for example **Codex CLI · selected gpt-6.2-astra · reasoning effort configured high**. The structured `model` and `reasoningEffort` fields reflect the configuration of the successful attempt, including a successful fallback. A cached answer is labelled **cached** and carries its original configuration with no fresh usage stats. These fields describe Ask LLM's selection and configuration. Independent backend model and reasoning effort are unverified.

For read-only Codex calls, set `noFallback: true` to bypass the response cache and make one model attempt with the exact `model` or the normal default. This also bypasses any preferred model even if `preferred: true` was supplied. The attempt must exit successfully with a completed turn and a nonempty answer. This option is available on `ask-codex` and on unified `ask-llm` with `provider: "codex"`.

## Models

<FallbackChain provider="codex" />

- **Default:** `gpt-6.2-sol`
- **codex-pair:** `gpt-6.2-sol` (GPT-6.2 Sol) at `high` effort. Quota fallback stays Terra
- **Explicit Astra:** `gpt-6.2-astra`, also used by `/astra-review` at `high` effort
- **Quota fallback:** `gpt-6.1-terra`, the cheaper, faster GPT-6.1 tier
- **Overrides:** `ASK_CODEX_MODEL`, `ASK_CODEX_FALLBACK_MODEL`, or the per-call `model` parameter

## Key Features

- **GPT-6.2 Sol access** via the official Codex CLI
- **Reasoning control:** ordinary calls default to `medium`; `/codex-review` and `/brainstorm` use `high`; direct calls can request `low`, `medium`, `high`, `xhigh`, `max`, or `ultra`. `ultra` is opt-in only (maximum reasoning with automatic task delegation) and is not a review default
- **Native session continuity:** omit `sessionId` for an ephemeral one-off call; pass `sessionId: ""` on turn one to persist a thread, then pass its returned `thread_id` on later turns. Follow-ups use `codex exec resume <id>` with the stable `-c sandbox_mode="<mode>"` grammar (zero replay cost, Codex retains state).
- **Read-only, non-interactive sandbox:** fresh calls use `codex exec --sandbox read-only`; resumed calls use the equivalent supported config override `-c sandbox_mode="read-only"`. Both keep second-opinion, review, and edit-proposal calls from modifying the workspace. Codex `exec` is non-interactive by definition, so no approval prompt can hang the MCP subprocess. `ask-codex` accepts only `sandbox: "read-only"`. Use the separate `ask-codex-write` tool for file creation (e.g. `/codex-image`); it uses `workspace-write` and advertises write access. The unified `ask-llm` tool also accepts explicit `sandbox: "workspace-write"` and is marked writable.
- **JSONL output parsing** for structured responses + token usage
- **Automatic quota fallback** from GPT-6.2 Sol to Terra
- **Structured AskResponse** via outputSchema for programmatic clients
- **Standard MCP transport** works with 40+ clients

## npm

- **Package:** [@ask-llm/codex-mcp](https://www.npmjs.com/package/@ask-llm/codex-mcp)
- **Binary:** `ask-codex-mcp`
