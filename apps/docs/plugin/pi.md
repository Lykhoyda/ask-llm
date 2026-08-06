---
description: Install Ask LLM as a first-class Pi package with native provider tools, portable skills, and deterministic multi-provider dispatch.
---

# Pi Host Support

Pi is the **host harness**: it owns the conversation, host model, skills, tools, and lifecycle. Codex, Gemini, Ollama, and Antigravity remain the independent Ask LLM **providers**. Pi has no built-in MCP client, so `@ask-llm/plugin` registers native Pi tools backed by the provider packages' canonical execution contracts; do not add MCP configuration to Pi.

> Pi packages run with your full user permissions and npm installs their runtime dependencies. Review package source before installation. Provider tools can transmit project material to their provider. Ollama remains local; Codex, Gemini, and Antigravity use their existing CLI credentials/accounts and may consume subscription quota or incur provider cost. Pi host-model authentication and billing are separate.

## Prerequisites

- Node.js 20+
- Pi 0.83.0 or newer
- one or more provider runtimes:
  - authenticated `codex` CLI for Codex reviews, images, and verification
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
```

Pi loads 11 skills. `fable-review` and the four `codex-pair` skills are intentionally Claude Code-only and are neither loaded nor advertised in Pi. Independent Fable review would require a nested Pi session or a new provider bridge, while pairing would require a separate reliable lifecycle and consent design; both are outside this release's bounded Pi surface.

Native tools:

| Tool | Contract |
|---|---|
| `ask-codex` | complete prompt/model/reasoning/session/includeDirs/preferred/sandbox schema; read-only default |
| `ask-gemini` | prompt/model/session schema and canonical quota fallback |
| `ask-ollama` | prompt/model/session schema; local-only, no silent model substitution |
| `ask-antigravity` | prompt/includeDirs schema and supported-`agy` checks |
| `ask-multi` | same prompt to 2–4 unique providers via bounded `Promise.allSettled`; stable input-order records and explicit failures |

Tool output is bounded to Pi's 50KB/2000-line policy. Provider failures throw, so Pi records `isError: true`; Ask LLM usage remains raw metadata in `details` and is not misreported as Pi host-model cost.

## Pairing

Pi pairing is not included in this release. The Pi extension registers provider tools only: it adds no edit/write event handlers, pairing commands, consent allowlist, timers, locks, or pending-finding state. Use explicit `/skill:codex-review` calls in Pi when you want a review. Claude Code's existing `codex-pair` hooks and commands remain unchanged.

## Host feature matrix

| Capability | Claude Code | Codex CLI host | Pi |
|---|---:|---:|---:|
| Provider MCP servers | Yes | Yes | No; native tools instead |
| Review/compare/brainstorm skills | Yes | MCP tools only | Yes, `/skill:<name>` + natural language |
| Isolated reviewer subagents | Yes | No | No; portable contracts run inline |
| Independent `fable-review` | Yes | No | No; excluded |
| `codex-image` | Yes | provider-dependent | Yes, explicit workspace-write opt-in |
| codex-pair per-edit review | Claude hooks | No | Not included |

## Update and remove

```bash
pi update npm:@ask-llm/plugin
pi remove npm:@ask-llm/plugin
```

Pi 0.83 removes its managed npm tree/settings entry. This release creates no Pi pairing state or consent allowlist. Any project `.codex-pair/` data belongs to the unchanged Claude Code integration.

## Troubleshooting

- **Package absent:** run `pi list`; reinstall with `pi install npm:@ask-llm/plugin`.
- **Skills absent:** confirm `enableSkillCommands` is true, run `/reload`, and check `/skill:codex-review`. `fable-review` should remain absent.
- **Project package absent:** trust the project (`/trust`, then restart) or use `--approve` for a one-run check.
- **Provider unavailable:** run the named CLI directly once to install/authenticate it (`codex`, `gemini`, `agy`) or start Ollama and pull the configured model. The native tool returns the provider package's actionable error.
- **codex-pair absent:** this is expected in Pi. Use explicit `/skill:codex-review` calls or Claude Code for hook-driven pairing.
- **Need a refresh after update:** run `/reload` or restart Pi.
