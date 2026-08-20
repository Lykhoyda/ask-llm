# Ask LLM MCP (Unified)

<div align="center">

[![npm version](https://img.shields.io/npm/v/@ask-llm/mcp)](https://www.npmjs.com/package/@ask-llm/mcp)
[![npm downloads](https://img.shields.io/npm/dt/@ask-llm/mcp)](https://www.npmjs.com/package/@ask-llm/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**All LLM providers in one MCP server — auto-detects what's installed**

</div>

A unified [MCP](https://modelcontextprotocol.io/) server that auto-detects installed LLM providers (Gemini, Codex, Claude, Ollama, Antigravity) and registers only the available tools. One install, all providers. Works with Claude Code, Codex CLI, Cursor, Warp, Copilot, and [40+ other MCP clients](https://modelcontextprotocol.io/clients).

Part of the [Ask LLM](https://github.com/Lykhoyda/ask-llm) monorepo.

## Quick Start

### Claude Code

```bash
claude mcp add ask-llm -- npx -y @ask-llm/mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ask-llm": {
      "command": "npx",
      "args": ["-y", "@ask-llm/mcp"]
    }
  }
}
```

## Prerequisites

- **[Node.js](https://nodejs.org/)** v20.0.0 or higher
- **At least one provider** installed:
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) for `ask-gemini` tools
  - [Codex CLI](https://github.com/openai/codex) for `ask-codex` tools
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/getting-started) for Codex and other non-Claude hosts to consult Claude
  - `XAI_API_KEY` for the default xAI Grok harness, or official Grok Build with `ASK_GROK_HARNESS=grok-cli`
  - Cursor CLI authentication for optional model-neutral `ask-cursor-agent`
  - [Ollama](https://ollama.com) running locally for `ask-ollama` tools

## How It Works

On startup, the unified server:

1. Checks CLI availability (Gemini, Codex, Claude, Antigravity)
2. Checks HTTP readiness for Ollama and the explicitly selected Grok API/CLI harness without billed inference
3. Keeps Cursor Agent model-neutral: a canonical provider family and exact `agent --list-models` ID are required separately and verified against each other
4. Dynamically imports and registers tools from available providers
5. Exposes only the tools for providers that are actually installed

## Tools

The orchestrator exposes a **single `ask-llm` tool** (not one tool per provider — ADR-029, for token efficiency); you pick the provider per call. When any provider is installed it registers:

| Tool | Purpose |
|------|---------|
| `ask-llm` | Route a prompt to a provider via the `provider` param (`gemini`, `codex`, `claude`, `grok`, `ollama`, `antigravity`); optional `harness` selects xai-api/grok-cli for Grok only; for Codex continuity, pass `sessionId: ""` first, then resume with the returned ID |
| `ask-cursor-agent` | Model-neutral Cursor harness with separate provider (`claude`, `codex`, `gemini`, `grok`) + exact model ID; the requested ID must belong to that provider family (Auto/noncanonical IDs are refused) and is echoed back as `model`, with Cursor's display label in optional `reportedModel` (cross-provider labels fail the call); prompts above 16 KB go over stdin; read-only ask mode, no fallback |
| `multi-llm` | Dispatch one prompt to multiple providers in parallel; structured per-provider report |
| `get-usage-stats` | Per-session token totals + per-provider/model breakdowns (in-memory) |
| `diagnose` | Environment diagnostics — provider CLI presence + versions |
| `ping` | Connection test |

Claude is intentionally suppressed when the MCP host is already Claude Code because Claude Code rejects nested Claude sessions. It is auto-detected normally from Codex and other clients.

Codex calls are ephemeral when `sessionId` is omitted. To create a resumable Codex conversation, pass `sessionId: ""` on the first call and pass its returned Thread ID on follow-ups.

## Doctor output formats

```bash
ask-llm-mcp doctor                       # human-readable (default)
ask-llm-mcp doctor --json                # established full DiagnosticReport JSON
ask-llm-mcp doctor --format toon         # bounded ask-llm.doctor TOON v1 pilot
ask-llm-mcp doctor --format toon --full  # include paths, pass checks, and full text
```

TOON is explicit opt-in. It changes only this CLI rendering; MCP tools/resources, JSON-RPC, machine JSON, and model prose are unchanged. Bounded output carries `completeness: complete | partial`, separates records filtered by design from actionable records dropped by the cap, and discloses withheld path fields and truncated text. `--full` is a no-op for text/JSON. Unknown `doctor` arguments exit 2 with a structured error. See the [TOON pilot evidence](https://github.com/Lykhoyda/ask-llm/blob/main/docs/TOON-PILOT.md) for the schema, measurements, and AXI audit.

## Machine Protocol

`machine` exposes a stdin-only JSON interface for factory controllers. It accepts one request of at most 2 MiB, with the prompt bounded to 150,000 characters by the schema, validates it before loading a provider, and writes exactly one typed result document to stdout. Prompts and issue content are never accepted through argv, and diagnostics go only to stderr.

Create a request file without putting its content in the command line:

```json
{
  "schemaVersion": 1,
  "requestId": "factory-review-0001",
  "role": "review",
  "provider": "codex",
  "prompt": "<redacted review input>",
  "readOnly": true,
  "writerProvider": "claude",
  "includeDirs": ["packages/example"]
}
```

Then dispatch it through stdin:

```bash
npx -y ask-llm-mcp machine < request.json
```

A valid dispatch returns a typed success or provider-failure envelope:

```json
{
  "schemaVersion": 1,
  "requestId": "factory-review-0001",
  "status": "success",
  "role": "review",
  "provider": "codex",
  "actualModel": "<redacted model>",
  "rawResponseSha256": "<redacted sha256>",
  "durationMs": 1200,
  "usage": { "inputTokens": 100, "outputTokens": 20, "totalTokens": 120 },
  "fallback": {
    "occurred": false,
    "requestedModel": "<redacted model>",
    "actualModel": "<redacted model>"
  },
  "session": { "sessionId": "<redacted session>", "transcriptPath": null },
  "payload": { "summary": "<redacted>", "findings": [] },
  "quotaSignal": { "kind": "runtime_proxy_required" },
  "failure": null
}
```

The complete envelope also records model, fallback, duration, token, response-hash, and session provenance. Provider-level failures use the same strict result contract and still exit successfully so controllers can parse and classify them.

All machine dispatches force `readOnly: true` and pass read-only sandbox options to the provider adapter. The interface supports Codex, Claude, and Antigravity; it does not provide a write path. Subscription usage percentages remain unknown unless the provider exposes them, and the dispatcher never infers a percentage from token counts.

| Exit code | Meaning | Stdout |
|-----------|---------|--------|
| `0` | Valid result envelope, including provider-level failure | One JSON document |
| `2` | Missing, oversized, malformed, or schema-invalid stdin request | Empty |
| `3` | Dispatcher infrastructure failure | Empty |

Use `machine-schema` to retrieve the stable canonical request/result schema bundle and its digest:

```bash
npx -y ask-llm-mcp machine-schema > machine-schema.json
```

```json
{
  "digest": "<redacted sha256>",
  "failure": { "<redacted>": true },
  "request": { "<redacted>": true },
  "refinements": { "version": 1, "rules": [] },
  "result": { "<redacted>": true },
  "rolePayloads": { "brainstorm": {}, "review": {}, "verify": {} }
}
```

The whole bundle is authoritative. Validate a document against its Draft 2020-12 `request`, `result`, or `failure` schema first, then run `validateMachineSchemaRefinements(target, document, bundle.refinements)`. The portable refinement descriptors cover sibling-field equality rules that standard JSON Schema cannot express, including self-review and fallback provenance checks. The digest covers every base schema, role payload schema, and refinement descriptor.

`machine-schema` is provider-independent: it neither detects nor loads a provider and does not require a provider CLI to be installed. The refinement interpreter and its `MachineSchemaRefinement`, `MachineSchemaRefinementSet`, `MachineSchemaRefinementViolation`, and `MachineSchemaTarget` types are exported from `ask-llm-mcp/machine` and the package root.

## Documentation

Full docs at [lykhoyda.github.io/ask-llm](https://lykhoyda.github.io/ask-llm/)

## License

MIT
