---
description: Consult Grok 4.6 through the supported xAI Responses API with exact model selection, structured output, cancellation, and no fallback.
---

# Grok

<ProviderStatus provider="grok" />

Consult Grok through one of two explicit harnesses: xAI's supported **Responses API** (`xai-api`, the default) or Grok Build's supported headless CLI (`grok-cli`). The unified package also exposes the model-neutral `ask-cursor-agent` harness, where provider and Cursor catalog model ID are separate inputs. Ask LLM never silently moves between harnesses.

> **Best for:** an independent Grok 4.6 critique, long-context reasoning, and a metered API path that works from any MCP client.
> **Not for:** free or subscription-included review. xAI API usage is billed separately; use Ollama when data must remain local or no per-token charge is acceptable.

## Setup

1. Create an xAI API key at [console.x.ai](https://console.x.ai/team/default/api-keys).
2. Review current [xAI pricing](https://docs.x.ai/developers/pricing) and fund/configure the xAI team yourself if you choose to use it. Ask LLM never enables billing, buys credits, requests paid capacity, enables overage, or selects priority processing.
3. Export the key only in the MCP server environment:

```bash
export XAI_API_KEY="..."
claude mcp add --scope user grok -e XAI_API_KEY="$XAI_API_KEY" -- npx -y @ask-llm/grok-mcp
```

For Codex CLI:

```bash
codex mcp add grok --env XAI_API_KEY="$XAI_API_KEY" -- npx -y @ask-llm/grok-mcp
```

Generic JSON MCP configuration:

```json
{
  "mcpServers": {
    "grok": {
      "command": "npx",
      "args": ["-y", "@ask-llm/grok-mcp"],
      "env": { "XAI_API_KEY": "${XAI_API_KEY}" }
    }
  }
}
```

Keep the key in user-owned environment/secret configuration, not project files. It is never returned in `AskResponse`, usage metadata, logs, or errors.

For the Grok CLI harness, install the official Grok Build CLI, authenticate once, verify the required headless flags, then select the harness explicitly:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok login
grok --help                 # must list --output-format, --model, and headless -p/--single
grok models
export ASK_GROK_HARNESS=grok-cli
```

For Cursor Agent, install/authenticate Cursor CLI and list your account's exact model IDs:

```bash
agent login
agent --list-models
```

## Tools

| Tool | Purpose |
|---|---|
| `ask-grok` | Send a one-shot prompt through `xai-api` or `grok-cli`. Optional exact `model`, `harness`, and `reasoningEffort` (`low`, `medium`, `high`, `xhigh`) |
| `get-usage-stats` | In-memory input/output/cached/reasoning token totals by model |
| `ping` | Validate the key through `GET /v1/models` and list exact IDs without a billed inference call |

`ask-grok` returns the standard human-readable result plus structured `AskResponse` fields: `provider: "grok"`, the actual model, normalized usage, the selected `harness`, and `fellBack: false`. Machine-mode role schemas use strict xAI JSON Schema on `xai-api` and a prompt constraint carrying the same schema on `grok-cli`; the shared machine boundary validates the returned JSON payload locally exactly once for both transports, so a non-conforming reply is reported as `schema_invalid` with the actual model.

## Harnesses stay separate from models

| Harness | Select it with | Authentication | Model discovery | Read-only control |
|---|---|---|---|---|
| xAI Responses API | `harness: "xai-api"` or default | `XAI_API_KEY` | authenticated `GET /v1/models` | no local tools; `store:false`; no server-side tools |
| Grok Build CLI | `harness: "grok-cli"` or `ASK_GROK_HARNESS=grok-cli` | `grok login` or `XAI_API_KEY` | `grok models` | `--sandbox read-only`, one turn, no subagents/memory/web search |
| Cursor Agent | unified `ask-cursor-agent` tool | `agent login` or `CURSOR_API_KEY` | `agent --list-models` | `--mode ask`; Ask LLM never passes `--force` or `--trust` |

The documented xAI API identifier is **`grok-4.6`**. Reasoning variants are not separate model IDs: use the `reasoning.effort` request parameter (`low`, `medium`, `high`, or `xhigh`), default `high`.

Ask LLM sends the selected model string unchanged. It never rewrites aliases, substitutes a model, or retries on another model. If xAI rejects the ID, the error names the requested model and points to discovery:

```bash
curl --fail https://api.x.ai/v1/models \
  -H "Authorization: Bearer $XAI_API_KEY"
```

Grok Build's documented default catalog alias is `grok-build` (the coding agent is powered by Grok 4.6). Grok CLI model IDs come from `grok models` and Cursor IDs come from `agent --list-models`; these are harness-specific catalogs and are not interchangeable. For example, Cursor may expose Grok as `cursor-grok-4.6-high` while xAI's API ID is `grok-4.6`. Pass the exact ID from the selected catalog. For consistency-sensitive API workflows, choose an exact dated ID returned for your xAI team. `grok-4.6` is xAI's stable alias and may resolve to a dated deployment; Ask LLM reports the actual `model` returned by the API.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `XAI_API_KEY` | required for xai-api; optional for CLI if logged in | Provider-scoped xAI credential |
| `ASK_GROK_HARNESS` | `xai-api` | `xai-api` or `grok-cli`; never auto-falls back |
| `ASK_GROK_MODEL` | API: `grok-4.6`; CLI: `grok-build` | Exact selected-harness model ID override; no fallback |
| `ASK_GROK_REASONING_EFFORT` | `high` | `low`, `medium`, `high`, or `xhigh` |
| `ASK_GROK_MAX_OUTPUT_TOKENS` | `16384` | API output ceiling (1–100000) to bound accidental spend |
| `ASK_GROK_TIMEOUT_MS` | `600000` | API/CLI timeout; aborts HTTP or terminates the CLI process |
| `GMCPT_TIMEOUT_MS` | — | Lower-precedence global timeout override |

API responses use `store: false`, so this integration does not opt into xAI's default 30-day response storage. It caps API output at 16,384 tokens by default and does not enable server-side tools, priority processing, background mode, or conversation persistence.

## Cursor Agent model-neutral path

The unified server and Pi host expose `ask-cursor-agent` separately from `ask-grok`. It requires both `provider` and an exact Cursor `model`; this prevents the Cursor transport from masquerading as a model provider:

```json
{
  "provider": "grok",
  "model": "cursor-grok-4.6-high",
  "prompt": "Review this design for correctness"
}
```

The model list is account-specific and can change; always run `agent --list-models`. Cursor may consume included usage or on-demand spend according to the user's Cursor plan. Ask LLM does not enable on-demand spend, alter limits, select Auto, trust a workspace, or retry another model.

## Pricing and cost safety

The xAI API and API-key-backed Grok CLI can incur xAI charges. Browser-authenticated Grok Build and Cursor Agent follow their own plan/usage terms. At the time this support was added, xAI documented these Grok 4.6 prices per 1M tokens:

| Prompt size | Input | Cached input | Output |
|---|---:|---:|---:|
| below 200k tokens | $2.00 | $0.50 | $6.00 |
| 200k tokens or more | $4.00 | $1.00 | $12.00 |

Once a prompt reaches 200k tokens, xAI applies long-context rates to all tokens in the request. Prices and account availability can change; check the [official pricing page](https://docs.x.ai/developers/pricing) before use. Plain identical one-shot requests use Ask LLM's response cache and report no new usage when served from it; strict structured requests always make a fresh API call.

## Errors and refusals

The API and CLI harnesses return stable Grok-specific diagnostics for missing/invalid `XAI_API_KEY`, unsupported model IDs, HTTP 402/429 credits or rate limits, transport/5xx failures, malformed or incomplete responses, and safety refusals. None of these paths falls back. Error details are bounded and the configured key is redacted before any diagnostic is created.

## Live tests

All normal tests use mocked HTTP transport and fake keys. A real, billed smoke test is **off by default** and runs only when both opt-ins are explicit:

```bash
GROK_LIVE_TEST=1 XAI_API_KEY="$XAI_API_KEY" \
  yarn workspace @ask-llm/grok-mcp test src/__tests__/integration.test.ts
```

The API command sends one small low-effort inference after model discovery. Grok CLI and Cursor Agent live runs are also off by default and require an exact model opt-in:

```bash
GROK_CLI_LIVE_TEST=1 GROK_CLI_LIVE_MODEL="$(grok models | head -1 | awk '{print $1}')" \
  yarn test --project @ask-llm/grok-mcp

CURSOR_LIVE_TEST=1 CURSOR_LIVE_MODEL=cursor-grok-4.6-high \
  yarn test --project @ask-llm/mcp
```

All three may consume metered or plan usage. Their mandatory unit/contract suites mock the HTTP or command boundary. Do not enable it in shared CI unless the owner explicitly accepts the cost.

## References

- [Grok 4.6 model](https://docs.x.ai/developers/models/grok-4.6)
- [Responses API text generation](https://docs.x.ai/developers/model-capabilities/text/generate-text)
- [Reasoning effort](https://docs.x.ai/developers/model-capabilities/text/reasoning)
- [Structured outputs](https://docs.x.ai/developers/model-capabilities/text/structured-outputs)
- [Rate limits](https://docs.x.ai/developers/rate-limits)
