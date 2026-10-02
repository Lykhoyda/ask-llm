---
description: Install Ask LLM as a first-class Pi package with native provider tools, portable skills, deterministic multi-provider dispatch, and opt-in codex-pair lifecycle support.
---

# Pi Host Support

Pi is the **host harness**: it owns the conversation, host model, skills, tools, and lifecycle. Codex, Gemini, Grok, Ollama, and Antigravity remain the independent Ask LLM **providers**. Pi has no built-in MCP client, so `@ask-llm/mcp` supplies native Pi tools backed by its bundled provider executors; `@ask-llm/plugin` remains a dependent installation bridge. Do not add MCP configuration to Pi.

> Installing or updating an npm package can execute lifecycle scripts from the package or its dependencies with your user account permissions. Once loaded, Pi package code has the same access. Review package and dependency source before installation or update. Provider tools can transmit project material to their provider. Ollama remains local; Codex, Gemini, and Antigravity use their existing CLI credentials/accounts and may consume subscription quota or incur provider cost. Pi host-model authentication and billing are separate.

## Prerequisites

- Node.js 24+
- Pi 0.83.0 or newer
- one or more provider runtimes:
  - authenticated `codex` CLI for Codex reviews, images, verification, and codex-pair
  - authenticated enterprise `gemini` CLI for Gemini
  - local Ollama server with the requested model pulled
  - authenticated `agy` 1.1.5+ for Antigravity

The published Pi support floor always matches the oldest exact host version exercised by the `pi-package-smoke` CI matrix; currently both the 0.83.0 floor and current 0.84.2 host are tested in isolated environments.

The extension reads provider credentials only indirectly by invoking the provider package/CLI. It never copies keys or Pi credentials.

## Install

Follow the [Pi Quick Start](https://github.com/Lykhoyda/ask-llm#pi) for the user-scoped installation. See the [setup reference](https://github.com/Lykhoyda/ask-llm/blob/main/packages/llm-mcp/README.md#command-compatibility) for local package registration, skill refresh, and alternate Pi profiles.

The package provides the native tools and the codex-pair commands. An interactive session prints a one-line notice naming `ask-llm setup --host pi` when no `ask-llm-*` skill is discovered. See [Skills](/plugin/skills) for the portable names and earlier-name compatibility.

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
pi -e ./packages/llm-mcp
```

After changing resources in a running Pi session, use `/reload`.

## Skills and tools

Invoke a skill explicitly with `/skill:<name>` or describe the workflow naturally. Pi progressively loads the same canonical `SKILL.md` files used by Claude Code, then follows their Pi adapter.

Representative commands:

```text
/skill:ask-llm-review
/skill:ask-llm-multi-review
/skill:ask-llm-compare gemini,codex explain this API design
/skill:ask-llm-brainstorm antigravity,codex review this architecture
/skill:ask-llm-brainstorm grok@cursor-agent:grok-4.7-high,codex@cursor-agent:gpt-6-sol-high review this architecture
/skill:ask-llm-codex-image create a monochrome architecture diagram
/skill:ask-llm-codex-verify
/skill:ask-llm-codex-pair
```

Pi reads these skills from the shared skills folder that `ask-llm setup --host pi` fills; the package itself ships only the extension. `ask-llm-fable-review` is not installed: independent Fable review would require a nested Pi session or provider bridge. `ask-llm-grok-pair` is installed for other hosts and refuses on Pi, because Grok pairing still needs a dedicated Pi consent/lifecycle adapter.

Native tools (Pi has no MCP client, so the extension registers them with the MCP server's input schemas; see the [host parity matrix](https://github.com/Lykhoyda/ask-llm/blob/main/docs/HOST-PARITY.md)):

| Tool | Contract |
|---|---|
| `ask-llm` | the MCP `ask-llm` schema (`provider`, `model`, `reasoningEffort`, `includeDirs`, `sessionId`, `harness`, `preferred`, `sandbox`) and the same `AskResponse` in `details.structuredContent`; `provider` lists every eligible provider, and one that is not installed fails at call time |
| `multi-llm` | the MCP `multi-llm` schema and report; omitted `providers` means every detected provider |
| `ask-cursor-agent` | the MCP schema: model-neutral Cursor harness with separate provider + exact account model ID, safe relative `includeDirs`, and optional returned/resumed Cursor `sessionId`; the exact ID is echoed as `model`, Cursor's label stays separate as `reportedModel`, and read-only ask mode never falls back |

Deprecated aliases, kept for existing skills and prompts:

| Tool | Contract |
|---|---|
| `ask-codex` | complete prompt/model/reasoning/session/includeDirs/preferred/sandbox schema; read-only default |
| `ask-gemini` | prompt/model/session schema and canonical quota fallback |
| `ask-grok` | prompt/model/reasoning plus explicit `xai-api` or `grok-cli` harness; no model/harness fallback |
| `ask-ollama` | prompt/model/session schema; local-only, no silent model substitution |
| `ask-antigravity` | prompt/includeDirs schema and supported-`agy` checks |
| `ask-multi` | same prompt to 2–5 unique providers via bounded `Promise.allSettled`, with per-provider options; stable input-order records and explicit failures |

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

Pending delivery is durable at least once across process crashes. Atomic claims prevent concurrent Pi sessions from delivering the same pending record, but a crash after `steer` succeeds and before durable cleanup can repeat it after restart. Every retry preserves the stable `details.findingId`, which receivers can use to deduplicate; Pi does not provide an atomic idempotent-message API that could guarantee exactly-once crash delivery.

Pi pairing works in TUI, RPC, and a long-lived JSON process. It is unsupported in one-shot print mode because the process normally exits before asynchronous debounce/review completes and print mode does not render custom messages.

## Host feature matrix

| Capability | Claude Code | Cursor Agent | Codex CLI host | Pi |
|---|---:|---:|---:|---:|
| Provider MCP servers | Yes | Yes | Yes | No; native tools instead |
| Review/compare/brainstorm skills | Yes | Agent Skills | Portable skills through setup | Yes, `/skill:<name>` + natural language; exact Grok + Sol mode calls native `ask-cursor-agent` twice and never `ask-multi`/Gemini |
| Isolated reviewer subagents | Yes | Host-dependent | No | No; portable contracts run inline |
| Independent `fable-review` | Yes | No; excluded | No | No; excluded |
| `codex-image` | Yes | provider-dependent | provider-dependent | Yes, explicit workspace-write opt-in |
| codex-pair | Claude per-edit hooks | On-demand persisted session | On-demand persisted session | Pi lifecycle extension |
| Grok pairing | Explicit Cursor/xAI/CLI routes | Direct xAI/CLI routes | Direct xAI/CLI routes | Skill is installed but refuses; no consent/lifecycle adapter |
| Blocking `blockOn: HIGH` Stop gate | Yes | No claim | No | **No**; findings are non-blocking |
| Pairing in one-shot print mode | Hook-dependent | On-demand skill | On-demand skill | **No** |

## Update and remove

For a local package registered by setup, update the global installation and refresh the skills:

```bash
npm install -g @ask-llm/mcp
ask-llm setup --host pi
```

Restart Pi or use `/reload` to load the updated extension. To unregister it, run `pi remove <installed package directory>` with the local source path shown by `pi list`; this leaves the global npm installation in place.

For an existing npm bridge installation:

```bash
pi update npm:@ask-llm/plugin
pi remove npm:@ask-llm/plugin
```

Removing the npm bridge deletes Pi's managed npm tree/settings entry. Separately installed skills remain; see [workflow removal](https://github.com/Lykhoyda/ask-llm/blob/main/packages/llm-mcp/README.md#command-compatibility). User-owned `.codex-pair/` logs/cache/state and the consent allowlist remain until you delete or revoke them explicitly.

## Troubleshooting

- **Package absent:** run `pi list`; rerun the [Pi Quick Start](https://github.com/Lykhoyda/ask-llm#pi) setup step.
- **Skills absent:** confirm `enableSkillCommands` is true, run `/reload`, and check `/skill:ask-llm-review`; if it is missing, run `ask-llm setup --host pi`. `ask-llm-fable-review` should remain absent.
- **Project package absent:** trust the project (`/trust`, then restart) or use `--approve` for a one-run check.
- **Pairing refuses a marker:** project trust and user-owned consent are both required; run `/codex-pair` in interactive Pi.
- **Provider unavailable:** run the named CLI directly once to install/authenticate it (`codex`, `gemini`, `agy`) or start Ollama and pull the configured model. The native tool returns the provider package's actionable error.
- **Pairing seems silent:** use TUI/RPC/long-lived JSON, check pause status with `/codex-pair`, and inspect `.codex-pair/log.jsonl`. Print mode is intentionally unsupported.
- **Need a refresh after update:** run `/reload` or restart Pi.
