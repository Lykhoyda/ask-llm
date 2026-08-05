---
description: Install Ask LLM as a first-class Pi package with native provider tools, portable skills, deterministic multi-provider dispatch, and opt-in codex-pair lifecycle support.
---

# Pi Host Support

Pi is the **host harness**: it owns the conversation, host model, skills, tools, and lifecycle. Codex, Gemini, Ollama, and Antigravity remain the independent Ask LLM **providers**. Pi has no built-in MCP client, so `@ask-llm/plugin` registers native Pi tools backed by the provider packages' canonical execution contracts; do not add MCP configuration to Pi.

> Pi packages run with your full user permissions and npm installs their runtime dependencies. Review package source before installation. Provider tools can transmit project material to their provider. Ollama remains local; Codex, Gemini, and Antigravity use their existing CLI credentials/accounts and may consume subscription quota or incur provider cost. Pi host-model authentication and billing are separate.

## Prerequisites

- Node.js 20+
- Pi 0.83.0 or newer
- one or more provider runtimes:
  - authenticated `codex` CLI for Codex reviews, images, verification, and codex-pair
  - authenticated enterprise `gemini` CLI for Gemini
  - local Ollama server with the requested model pulled
  - authenticated `agy` 1.1.5+ for Antigravity

The extension reads provider credentials only indirectly by invoking the provider package/CLI. It never copies keys or Pi credentials.

## Install

Recommended user-scoped install:

```bash
pi install npm:@ask-llm/plugin
pi list
```

Project-local install (loaded only after Pi project trust):

```bash
pi install -l --approve npm:@ask-llm/plugin
```

Temporary evaluation without changing settings:

```bash
pi -e npm:@ask-llm/plugin
```

For a built source checkout:

```bash
yarn install --immutable
yarn build
pi -e ./packages/claude-plugin
```

After changing resources in a running Pi session, use `/reload`.

## Skills and tools

Invoke a skill explicitly with `/skill:<name>` or describe the workflow naturally. Pi progressively loads the same canonical `SKILL.md` files used by Claude Code, then follows their Pi adapter.

Representative commands:

```text
/skill:codex-review
/skill:multi-review
/skill:compare gemini,codex explain this API design
/skill:brainstorm antigravity,codex review this architecture
/skill:codex-image create a monochrome architecture diagram
/skill:codex-verify
/skill:codex-pair
```

Pi loads 15 skills. `fable-review` is intentionally Claude Code-only and is neither loaded nor advertised in Pi: independent Fable review would require a nested Pi session or a new provider bridge, both outside this package's bounded design.

Native tools:

| Tool | Contract |
|---|---|
| `ask-codex` | complete prompt/model/reasoning/session/includeDirs/preferred/sandbox schema; read-only default |
| `ask-gemini` | prompt/model/session schema and canonical quota fallback |
| `ask-ollama` | prompt/model/session schema; local-only, no silent model substitution |
| `ask-antigravity` | prompt/includeDirs schema and supported-`agy` checks |
| `ask-multi` | same prompt to 2–4 unique providers via bounded `Promise.allSettled`; stable input-order records and explicit failures |

Tool output is bounded to Pi's 50KB/2000-line policy. Provider failures throw, so Pi records `isError: true`; Ask LLM usage remains raw metadata in `details` and is not misreported as Pi host-model cost.

## Pi codex-pair consent

Pi codex-pair is off unless **all three** gates pass:

1. the repository has `.codex-pair/context.md`;
2. Pi considers the project trusted; and
3. you grant consent interactively with `/codex-pair`.

The third gate writes the canonical project root to your user-owned allowlist at:

```text
$PI_CODING_AGENT_DIR/ask-llm/codex-pair-projects.json
# normally ~/.pi/agent/ask-llm/codex-pair-projects.json
```

A repository can commit a marker, so **the marker alone never authorizes source transfer or cost**. Consent confirmation states that bounded edited-file content and marker context go to your configured Codex CLI/account. Revoke it at any time:

```text
/codex-pair revoke
```

Pair controls:

```text
/codex-pair                 # status or interactive consent
/codex-pair-pause
/codex-pair-resume
/codex-pair-ack <hash> <reason>
```

The extension observes only successful built-in `edit`/`write` `tool_result` events, debounces a burst to the final settled file state, deduplicates identical content, and injects findings as a persisted `steer` message without triggering an extra host-model turn. It starts no process/timer at extension load. On shutdown/reload/new/resume/fork it closes the current epoch, clears timers, aborts active provider work, waits a bounded interval, and releases owned locks. Durable logs, cache, pause, ack, consent, and pending findings are user product state; shutdown does not erase that history.

Pi pairing works in TUI, RPC, and a long-lived JSON process. It is unsupported in one-shot print mode because the process normally exits before asynchronous debounce/review completes and print mode does not render custom messages.

## Host feature matrix

| Capability | Claude Code | Codex CLI host | Pi |
|---|---:|---:|---:|
| Provider MCP servers | Yes | Yes | No; native tools instead |
| Review/compare/brainstorm skills | Yes | MCP tools only | Yes, `/skill:<name>` + natural language |
| Isolated reviewer subagents | Yes | No | No; portable contracts run inline |
| Independent `fable-review` | Yes | No | No; excluded |
| `codex-image` | Yes | provider-dependent | Yes, explicit workspace-write opt-in |
| codex-pair per-edit review | Claude hooks | No | Pi lifecycle extension |
| Blocking `blockOn: HIGH` Stop gate | Yes | No | **No**; findings are non-blocking |
| Pairing in one-shot print mode | Hook-dependent | No | **No** |

## Update and remove

```bash
pi update npm:@ask-llm/plugin
pi remove npm:@ask-llm/plugin
```

Pi 0.83 removes its managed npm tree/settings entry. User-owned `.codex-pair/` logs/cache/state and the consent allowlist remain until you delete or revoke them explicitly.

## Troubleshooting

- **Package absent:** run `pi list`; reinstall with `pi install npm:@ask-llm/plugin`.
- **Skills absent:** confirm `enableSkillCommands` is true, run `/reload`, and check `/skill:codex-review`. `fable-review` should remain absent.
- **Project package absent:** trust the project (`/trust`, then restart) or use `--approve` for a one-run check.
- **Pairing refuses a marker:** project trust and user-owned consent are both required; run `/codex-pair` in interactive Pi.
- **Provider unavailable:** run the named CLI directly once to install/authenticate it (`codex`, `gemini`, `agy`) or start Ollama and pull the configured model. The native tool returns the provider package's actionable error.
- **Pairing seems silent:** use TUI/RPC/long-lived JSON, check pause status with `/codex-pair`, and inspect `.codex-pair/log.jsonl`. Print mode is intentionally unsupported.
- **Need a refresh after update:** run `/reload` or restart Pi.
