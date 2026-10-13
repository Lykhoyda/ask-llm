---
description: Native tools, portable workflows and explicit per-project pairing consent.
---

# Pi host notes

Pi owns your conversation, host model, tools and lifecycle. Ask LLM supplies native tools backed by the same provider executors and schemas as other hosts; Pi does not need MCP configuration. Your Pi account and reviewer accounts have separate authentication and billing.

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

## Connection

Follow [Install](/start/install), then restart Pi or use `/reload`. Setup registers the globally installed extension as a local package and fills the shared skills folder. The extension prints a notice naming `ask-llm setup --host pi` if no portable workflow is found. Earlier npm installations are left unchanged with [migration guidance](/reference/migration).

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
| `ask-llm` | the MCP `ask-llm` schema (`provider`, `model`, `reasoningEffort`, `includeDirs`, `sessionId`, `harness`, `preferred`, `sandbox`) and the same `AskResponse` in `details.structuredContent`; `provider` uses the same detected availability and exclusions as MCP |
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

Displayed tool text is bounded to Pi's 50KB/2000-line policy; structured payloads remain complete. Provider failures throw, so Pi records `isError: true`; Ask LLM usage remains raw metadata in `details` and is not misreported as Pi host-model cost.

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

The extension observes only successful built-in `edit`/`write` `tool_result` events, debounces a burst to the final settled file state, deduplicates identical content, and injects findings as a persisted `steer` message without triggering an extra host-model turn. Pairing starts no process/timer at extension load; native tools probe provider availability before registration. On shutdown/reload/new/resume/fork it closes the current epoch, clears timers, aborts active provider work, waits a bounded interval, and releases owned locks. Durable logs, cache, pause, ack, consent, and pending findings are user product state; shutdown does not erase that history.

Pending delivery is durable at least once across process crashes. Atomic claims prevent concurrent Pi sessions from delivering the same pending record, but a crash after `steer` succeeds and before durable cleanup can repeat it after restart. Every retry preserves the stable `details.findingId`, which receivers can use to deduplicate; Pi does not provide an atomic idempotent-message API that could guarantee exactly-once crash delivery.

Pi pairing works in TUI, RPC, and a long-lived JSON process. It is unsupported in one-shot print mode because the process normally exits before asynchronous debounce/review completes and print mode does not render custom messages.

## Host feature matrix

See the [host parity matrix](https://github.com/Lykhoyda/ask-llm/blob/main/docs/HOST-PARITY.md) for tools, skills, options, diagnostics, pairing, subagents, and the Stop gate across all supported hosts. The following workflow-specific limits supplement that matrix:

| Capability | Claude Code | Cursor Agent | Codex CLI host | Pi |
|---|---:|---:|---:|---:|
| Independent `fable-review` | Yes | No; excluded | No | No; excluded |
| `codex-image` | Yes | provider-dependent | provider-dependent | Yes, explicit workspace-write opt-in |
| Grok pairing | Explicit Cursor/xAI/CLI routes | Direct xAI/CLI routes | Direct xAI/CLI routes | Skill is installed but refuses; no consent/lifecycle adapter |
| Pairing in one-shot print mode | Hook-dependent | On-demand skill | On-demand skill | **No** |

## Update and remove

See [Upgrade and remove](/start/upgrade-remove). For the setup-managed local package, `pi list` shows the path to pass to `pi remove`. Skills and user-owned pairing state remain until explicitly removed or revoked. Earlier npm sources remain unchanged; follow [Migration](/reference/migration) before retiring them.

## Troubleshooting

- **Package absent:** run `pi list`; rerun the [Install](/start/install) setup step.
- **Skills absent:** confirm `enableSkillCommands` is true, run `/reload`, and check `/skill:ask-llm-review`; if it is missing, run `ask-llm setup --host pi`. `ask-llm-fable-review` should remain absent.
- **Project package absent:** trust the project (`/trust`, then restart) or use `--approve` for a one-run check.
- **Pairing refuses a marker:** project trust and user-owned consent are both required; run `/codex-pair` in interactive Pi.
- **Provider unavailable:** run the named CLI directly once to install/authenticate it (`codex`, `gemini`, `agy`) or start Ollama and pull the configured model. The native tool returns the provider package's actionable error.
- **Pairing seems silent:** use TUI/RPC/long-lived JSON, check pause status with `/codex-pair`, and inspect `.codex-pair/log.jsonl`. Print mode is intentionally unsupported.
- **Need a refresh after update:** run `/reload` or restart Pi.
