---
description: Setup, removal, diagnostics and existing server modes.
---

# CLI

`ask-llm` is the user command. Run it without arguments or with `--help` to print usage; `--version` prints the installed version. No provider detection or mutation is needed for these modes.

| Command | Behavior |
|---|---|
| `ask-llm setup` | Preview user-scope connection and workflows, confirm each change, then verify registrations |
| `ask-llm setup --dry-run --json` | Preview only; JSON is available only with `--dry-run` |
| `ask-llm setup --host claude,cursor` | Limit changes to the named hosts |
| `ask-llm setup -y --host claude` | Answer confirmations for scripted setup |
| `ask-llm remove` | Follow [Upgrade and remove](/start/upgrade-remove) for registration removal and separate workflow cleanup |
| `ask-llm doctor` | Host, provider and environment diagnostics without inference |
| `ask-llm doctor --json` | Full structured report |
| `ask-llm doctor --live` | Optional quota-consuming provider exercise |

## Host IDs

`claude`, `codex`, `cursor`, `agy`, `grok`, `gemini`, `pi`, `claude-desktop`, `opencode`. Use `--host` with a comma-separated list. `-h` / `--help` is available on setup, remove and doctor. Setup and remove exit nonzero if a step fails or manual guidance remains outstanding.

Backups are made before mutations. Setup does not install or sign in to providers, enable pairing, or alter billing. See [Migration](/reference/migration) for ownership, rollback and customised entries.

## Existing server command

`ask-llm-mcp` starts the stdio MCP server with no arguments and retains provider-only doctor, REPL and machine modes. It is the durable executable that setup registers. The generic `mcp` alias can collide with other tools; use the namespaced server command directly.

```bash
ask-llm-mcp --help
ask-llm-mcp repl
```

The REPL supports provider switching, session continuity and `/usage` for token totals. `ask-llm` itself accepts setup, remove and doctor; REPL and machine belong to the server command.

## Machine protocol

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
ask-llm-mcp machine < request.json
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

All machine dispatches request `readOnly: true` and pass read-only options to the provider adapter. The interface supports Codex, Claude, and Antigravity; it does not provide a write path. Antigravity refuses execution by default because its read-only options do not guarantee isolation; see the [provider guide](/providers/antigravity). Subscription usage percentages remain unknown unless the provider exposes them, and the dispatcher never infers a percentage from token counts.

| Exit code | Meaning | Stdout |
|-----------|---------|--------|
| `0` | Valid result envelope, including provider-level failure | One JSON document |
| `2` | Missing, oversized, malformed, or schema-invalid stdin request | Empty |
| `3` | Dispatcher infrastructure failure | Empty |

Use `machine-schema` to retrieve the stable canonical request/result schema bundle and its digest:

```bash
ask-llm-mcp machine-schema > machine-schema.json
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

`machine-schema` is provider-independent: it neither detects nor loads a provider and does not require a provider CLI to be installed. The refinement interpreter and its `MachineSchemaRefinement`, `MachineSchemaRefinementSet`, `MachineSchemaRefinementViolation`, and `MachineSchemaTarget` types are exported from `@ask-llm/mcp/machine` and the package root.
