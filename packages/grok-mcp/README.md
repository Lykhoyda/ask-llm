# @ask-llm/grok-mcp

MCP server for one-shot Grok consultations through either the supported xAI Responses API (`xai-api`, default) or official Grok Build headless CLI (`grok-cli`). Harness and model selection remain separate, with no automatic failover.

- Default exact model ID: `grok-4.6`
- Reasoning effort: `low`, `medium`, `high` (default), `xhigh` — xAI documents `xhigh` for `grok-4.6` and later and applies it as `high` on older models; Ask LLM sends the requested effort unchanged, discloses that coercion as a progress note, and classifies an effort-rejecting 4xx with the supported list
- Prompts above 16 KB reach the Grok CLI through a private `--prompt-file` (0600, removed after the run) instead of argv, but only after `grok --help` advertises the flag (present in official Grok Build 1.0.5); otherwise the call fails before spawn with an update-or-shorten diagnostic and no argv retry
- No model rewriting, substitution, or fallback
- Strict JSON Schema support for machine-mode callers
- Cancellation and timeout abort the underlying HTTP request
- Stable, redacted diagnostics for credentials, models, quota/rate limits, transport, malformed output, and safety refusals

## Setup

Create an API key at <https://console.x.ai/team/default/api-keys>, review <https://docs.x.ai/developers/pricing>, then configure it only in the MCP server environment:

```bash
export XAI_API_KEY="..."
claude mcp add --scope user grok -e XAI_API_KEY="$XAI_API_KEY" -- npx -y @ask-llm/grok-mcp
```

Codex CLI:

```bash
codex mcp add grok --env XAI_API_KEY="$XAI_API_KEY" -- npx -y @ask-llm/grok-mcp
```

To use the CLI harness instead, install official Grok Build, authenticate, then set the harness explicitly:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok login
export ASK_GROK_HARNESS=grok-cli
```

xAI API usage is metered separately from consumer subscriptions. This package never enables billing, buys credits, requests capacity, enables overage/priority processing, or retries another model. Requests set `store:false` and enable no xAI server-side tools.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` | required for API; optional for logged-in CLI | xAI credential |
| `ASK_GROK_HARNESS` | `xai-api` | `xai-api` or `grok-cli`; no failover |
| `ASK_GROK_MODEL` | API `grok-4.6`; CLI `grok-build` | Exact selected-harness model ID override, sent unchanged |
| `ASK_GROK_REASONING_EFFORT` | `high` | `low`, `medium`, `high`, or `xhigh` (`xhigh` is applied as `high` by xAI on models older than grok-4.6; disclosed, not masked) |
| `ASK_GROK_MAX_OUTPUT_TOKENS` | `16384` | API output ceiling to bound accidental spend |
| `ASK_GROK_TIMEOUT_MS` | `600000` | Request timeout in milliseconds |
| `GMCPT_TIMEOUT_MS` | — | Lower-precedence global timeout |

Discover exact model IDs from the selected harness without inference:

```bash
curl --fail https://api.x.ai/v1/models \
  -H "Authorization: Bearer $XAI_API_KEY"

grok models
```

## Tools

- `ask-grok` — explicit API or CLI Grok consultation; returns standard structured `AskResponse` including actual harness
- `ping` — validates credentials and lists available model IDs
- `get-usage-stats` — in-memory token usage by provider/model

## Tests

Normal tests use mocked transport and fake credentials. The real billed smoke is explicit opt-in:

```bash
GROK_LIVE_TEST=1 XAI_API_KEY="$XAI_API_KEY" \
  yarn test --project @ask-llm/grok-mcp

GROK_CLI_LIVE_TEST=1 GROK_CLI_LIVE_MODEL=grok-4.6 \
  yarn test --project @ask-llm/grok-mcp
```

For the model-neutral Cursor Agent harness, use `ask-cursor-agent` from `@ask-llm/mcp`; it requires a canonical provider family (`claude`, `codex`, `gemini`, `grok`) plus an exact `agent --list-models` ID, verifies that the requested and CLI-reported model belong to that family (refusing mismatches, Auto, and other noncanonical IDs), pipes prompts above 16 KB over stdin, and never changes Cursor spend/trust settings.

See the full provider guide: <https://lykhoyda.github.io/ask-llm/providers/grok>.
