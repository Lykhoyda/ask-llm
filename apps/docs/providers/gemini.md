---
description: Consult Gemini CLI through Ask LLM with an existing eligible Gemini Code Assist Standard or Enterprise seat.
---

# Gemini

<ProviderStatus provider="gemini" />

Use the unified `ask-llm` tool with `provider: "gemini"` to consult Gemini CLI with an existing, eligible Gemini Code Assist Standard or Enterprise seat.

::: warning Individual access ended June 18, 2026
Google ended Gemini CLI access for individuals, including free, Google AI Pro, and Ultra accounts, on June 18, 2026. If you choose to use Google's successor CLI through Ask LLM, see [Antigravity setup, prerequisites, and Google's consumer-plan terms](/providers/antigravity). [Google's transition announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)

Google ended new purchases of Gemini Code Assist Standard and Enterprise subscriptions on October 9, 2026. Existing subscriptions auto-renew through the rest of 2026. Automatic renewal ends in 2027. [Gemini Code Assist release notes](https://docs.cloud.google.com/gemini/docs/codeassist/release-notes#October_09_2026)
:::

## 2026-06-18 tier change

- Ask LLM still calls the `gemini` binary. Reinstalling it cannot restore account access.
- After the cutoff, Ask LLM prepends an **advisory** tier notice to some authentication or quota errors. The original error follows the notice. The account tier is one possible cause.
- To choose another provider, use [Antigravity through Ask LLM](/providers/antigravity), [Codex](/providers/codex), or [Ollama](/providers/ollama).
- **Testing the guidance:** set `ASK_GEMINI_TIER_CUTOFF` to a past UTC instant (e.g. `2020-01-01T00:00:00Z`) to force the post-cutoff gate on; an auth/quota failure will then prepend the notice. The default cutoff is `2026-06-18T00:00:00Z`.

## Installation

<InstallSnippet provider="gemini" />

Setup registers the unified Ask LLM server, which consults Gemini through the `ask-llm` tool with `provider: "gemini"`. The tools listed below belong to the retired standalone `@ask-llm/gemini-mcp` server, which is no longer published; `ask-llm` with `provider: "gemini"` reaches the same provider. See [Migration](/reference/migration) to move an earlier installation to the setup registration.

## Prerequisites

1. **Node.js** v24.0.0 or higher
2. An existing, eligible **Gemini Code Assist Standard or Enterprise seat**. Install Gemini CLI, launch `gemini` interactively, and select **Sign in with Google** with the account assigned to that seat. [Gemini CLI sign-in instructions](https://geminicli.com/docs/get-started/authentication/#recommended-sign-in-with-google)

```bash
npm install -g @google/gemini-cli
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

- **Default:** `gemini-4-argon` (Gemini 4 Argon)
- **Quota fallback:** `gemini-3.8-flash`, automatic on `RESOURCE_EXHAUSTED`
- **Overrides:** `ASK_GEMINI_MODEL`, `ASK_GEMINI_FALLBACK_MODEL`, or the per-call `model` parameter

Access to these pinned models through existing Code Assist seats is unverified.

### Optional model override: Gemini 3.5 Flash-Lite {#flash-lite}

`gemini-3.5-flash-lite` can be requested as a model override. Access through an existing Code Assist seat is unverified. Confirm model availability for your seat before configuring it.

Set either variable in your MCP server environment.

```bash
# Use Flash-Lite for ordinary Gemini calls without a per-call model override:
ASK_GEMINI_MODEL=gemini-3.5-flash-lite
```

```bash
# Or keep the default and use Flash-Lite only for quota fallback:
ASK_GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite
```

Restart your host after changing the server environment. With neither override, the default remains `gemini-4-argon` and the quota fallback remains `gemini-3.8-flash`.

## Key Features

- **Multi-turn sessions** via `sessionId` with native `--resume <id>`
- **Include directories** for monorepo context (`includeDirs` parameter on `ask-gemini-edit`)
- **Live progressive output:** assistant message deltas stream to MCP progress notifications, no frozen waits on long calls
- **Structured AskResponse** via outputSchema for programmatic clients
- **Automatic quota fallback** on `RESOURCE_EXHAUSTED`

## npm

- **Package:** [@ask-llm/mcp](https://www.npmjs.com/package/@ask-llm/mcp), which bundles the Gemini provider
- **Binary:** `ask-llm` (setup and diagnostics) and `ask-llm-mcp` (the server)
- The standalone `@ask-llm/gemini-mcp` package and its `ask-gemini-mcp` binary are retired; see [Migration](/reference/migration).
