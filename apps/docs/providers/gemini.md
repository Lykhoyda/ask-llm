---
description: Bridge Claude with Google Gemini via the official CLI. 1M+ token context window for large codebase analysis, structured edits, and quota-aware model fallback.
---

# Gemini

<ProviderStatus provider="gemini" />

Bridge Claude with Google's Gemini via the official Gemini CLI. Leverages Gemini's massive 1M+ token context window for large file and codebase analysis while Claude handles interaction and code editing.

::: danger Discontinued on consumer tiers: migrate to Antigravity
**From 2026-06-18**, Google restricts Gemini CLI access to **Gemini Code Assist Standard/Enterprise** seats; **free, Google AI Pro, and Ultra** accounts lose access. Ask LLM's Gemini provider still launches `gemini`; the failure is a runtime auth/quota error from Google's backend, not a missing binary.

**On a subscription tier?** Migrate to **[Antigravity (`agy`)](/providers/antigravity)**, Google's successor CLI, covered by the same AI Pro/Ultra subscription with no per-token billing. Ask LLM reaches [Antigravity](/providers/antigravity) through the same installation, or switch to [`ask-codex`](/providers/codex) / [`ask-ollama`](/providers/ollama). The **2026-06-18 tier change** section below covers what happens at runtime.
:::

## 2026-06-18 tier change

From **2026-06-18**, Google serves Gemini CLI requests only for **Gemini Code Assist Standard/Enterprise** accounts; free, Google AI Pro, and Ultra accounts lose access. The surviving tiers keep working with the same `gemini` binary and backend.

What this means for Ask LLM's Gemini provider:

- The provider **still launches** the unchanged `gemini` binary. The failure for non-enterprise accounts is a **runtime auth/quota error**, not a missing binary, so reinstalling will not help.
- On or after the cutoff, an auth/quota-class failure now surfaces an actionable notice (cutoff date + options) instead of a raw error. The note is **advisory** ("likely caused by the tier change"); a genuine auth, billing, or quota error can also trigger it.
- Google's successor is the **Antigravity CLI (`agy`)**, a separate, closed-source binary that the Gemini provider does **not** wrap. Use the **[Antigravity provider](/providers/antigravity)** through the same Ask LLM installation (covered by the same Google AI Pro/Ultra subscription, no per-token billing), run `agy` directly, or switch to [`ask-codex`](/providers/codex) / [`ask-ollama`](/providers/ollama).
- **Testing the guidance:** set `ASK_GEMINI_TIER_CUTOFF` to a past UTC instant (e.g. `2020-01-01T00:00:00Z`) to force the post-cutoff gate on; an auth/quota failure will then prepend the notice. The default cutoff is `2026-06-18T00:00:00Z`.

[Google's announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/).

> **Best for:** whole-codebase reads using the 1M+ token context window, if you have an eligible Gemini Code Assist Standard/Enterprise seat.
> **Not for:** most users from 2026-06-18 (see the notice above). For large-context reads without an enterprise seat, use [Antigravity](/providers/antigravity).

## Installation

<InstallSnippet provider="gemini" />

Setup registers the unified Ask LLM server, which consults Gemini through the `ask-llm` tool with `provider: "gemini"`. The tools listed below belong to the retired standalone `@ask-llm/gemini-mcp` server, which is no longer published; `ask-llm` with `provider: "gemini"` reaches the same provider. See [Migration](/reference/migration) to move an earlier installation to the setup registration.

## Prerequisites

1. **Node.js** v24.0.0 or higher
2. **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** installed and authenticated:

```bash
npm install -g @google/gemini-cli
gemini login
```

## Tools

| Tool | Purpose |
|------|---------|
| `ask-gemini` | Send prompts to Gemini CLI with `@` file syntax. Optional `sessionId` for multi-turn; live progressive output via `--output-format stream-json` |
| `ask-gemini-edit` | Structured code edits via Gemini changeMode. Returns OLD/NEW edit blocks. Supports `includeDirs` for monorepo context |
| `fetch-chunk` | Retrieve subsequent chunks from cached large responses |
| `get-usage-stats` | Per-session token totals + breakdowns by provider/model. In-memory |
| `ping` | Fast connection test to verify MCP setup |

`ask-gemini` returns both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`; programmatic clients can extract the sessionId and usage fields directly without parsing the response footer.

## Models

<FallbackChain provider="gemini" />

- **Default:** `gemini-4-argon` (Gemini 4 Argon; Gemini CLI passes the id to the API, though Google notes the CLI is not tuned for Gemini 4)
- **Quota fallback:** `gemini-3.8-flash`, automatic on `RESOURCE_EXHAUSTED`
- **Overrides:** `ASK_GEMINI_MODEL`, `ASK_GEMINI_FALLBACK_MODEL`, or the per-call `model` parameter

### Cheap opt-in: Gemini 3.5 Flash-Lite {#flash-lite}

`gemini-3.5-flash-lite` is an optional lower-cost model with a 1M-token input context. Choose it for cost, not as a quality upgrade; evaluate its answers for your workload before using it for code review. Google's [model catalog](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) lists it as stable, and its [deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations) lists no shutdown date or replacement (checked 2026-11-17).

Set either variable in your MCP server environment:

```bash
# Use Flash-Lite for ordinary Gemini calls without a per-call model override:
ASK_GEMINI_MODEL=gemini-3.5-flash-lite
```

```bash
# Or keep the Pro default and use Flash-Lite only for quota fallback:
ASK_GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite
```

Restart your host after changing the server environment. With neither override, the default remains `gemini-4-argon` and the quota fallback remains `gemini-3.8-flash`.

Gemini CLI subscription restrictions, quotas, and free-tier limits apply as for other models. Selecting Flash-Lite does not bypass the [enterprise-only access rules](#_2026-06-18-tier-change) above. API token prices are separate from your CLI plan; consult Google's [current pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite).

## Key Features

- **1M+ token context** for analyzing entire codebases
- **Multi-turn sessions** via `sessionId`: native `--resume <id>` (zero replay cost)
- **Include directories** for monorepo context (`includeDirs` parameter on `ask-gemini-edit`)
- **Live progressive output:** assistant message deltas stream to MCP progress notifications, no frozen waits on long calls
- **Structured AskResponse** via outputSchema for programmatic clients
- **Automatic quota fallback** from Pro to Flash on `RESOURCE_EXHAUSTED`

## npm

- **Package:** [@ask-llm/mcp](https://www.npmjs.com/package/@ask-llm/mcp), which bundles the Gemini provider
- **Binary:** `ask-llm` (setup and diagnostics) and `ask-llm-mcp` (the server)
- The standalone `@ask-llm/gemini-mcp` package and its `ask-gemini-mcp` binary are retired; see [Migration](/reference/migration).
