---
description: "The host parity matrix: tools, workflows, options, diagnostics and deliberate lifecycle differences."
---

# Hosts

A host is the coding assistant you work in. A provider is the model you consult. The matrix below is kept equal to the canonical [HOST-PARITY matrix](https://github.com/Lykhoyda/ask-llm/blob/main/docs/HOST-PARITY.md); `ask-llm doctor` prints the rows for installed hosts.

<!-- HOST-PARITY:START (generated from packages/llm-mcp/src/hosts/parity.ts; host-parity.test.ts keeps them equal) -->
| | Claude Code | Codex | Cursor | Antigravity | Grok Build | Gemini | Pi | Claude Desktop | OpenCode |
|---|---|---|---|---|---|---|---|---|---|
| tools | MCP: ask-llm, multi-llm, ask-cursor-agent, ping, get-usage-stats, diagnose | MCP: ask-llm, multi-llm, ask-cursor-agent, ping, get-usage-stats, diagnose | MCP: ask-llm, multi-llm, ask-cursor-agent, ping, get-usage-stats, diagnose | MCP: ask-llm, multi-llm, ask-cursor-agent, ping, get-usage-stats, diagnose | MCP: ask-llm, multi-llm, ask-cursor-agent, ping, get-usage-stats, diagnose | MCP: ask-llm, multi-llm, ask-cursor-agent, ping, get-usage-stats, diagnose | native ask-llm, multi-llm, ask-cursor-agent with the MCP input schemas; ask-codex, ask-gemini, ask-grok, ask-ollama, ask-antigravity, ask-multi as deprecated aliases | MCP: ask-llm, multi-llm, ask-cursor-agent, ping, get-usage-stats, diagnose | MCP: ask-llm, multi-llm, ask-cursor-agent, ping, get-usage-stats, diagnose |
| skills | the Claude plugin, installed by `ask-llm setup` | shared skills folder `~/.agents/skills`, filled by `ask-llm setup` | shared skills folder `~/.agents/skills`, filled by `ask-llm setup` | `~/.gemini/config/skills`; `ask-llm setup` prints the copy command | `~/.grok/skills`, filled by `ask-llm setup` | shared skills folder `~/.agents/skills`, filled by `ask-llm setup` | shared skills folder `~/.agents/skills`, filled by `ask-llm setup` | none (tools only) | shared skills folder `~/.agents/skills`, filled by `ask-llm setup` |
| options | every `ask-llm` option reaches the executor unchanged; provider enums list providers detected at start, falling back to all eligible providers after exclusions when none are detected | every `ask-llm` option reaches the executor unchanged; provider enums list providers detected at start, falling back to all eligible providers after exclusions when none are detected | every `ask-llm` option reaches the executor unchanged; provider enums list providers detected at start, falling back to all eligible providers after exclusions when none are detected | every `ask-llm` option reaches the executor unchanged; provider enums list providers detected at start, falling back to all eligible providers after exclusions when none are detected | every `ask-llm` option reaches the executor unchanged; provider enums list providers detected at start, falling back to all eligible providers after exclusions when none are detected | every `ask-llm` option reaches the executor unchanged; provider enums list providers detected at start, falling back to all eligible providers after exclusions when none are detected | every `ask-llm` option reaches the executor unchanged; provider enums list providers detected at start, falling back to all eligible providers after exclusions when none are detected | every `ask-llm` option reaches the executor unchanged; provider enums list providers detected at start, falling back to all eligible providers after exclusions when none are detected | every `ask-llm` option reaches the executor unchanged; provider enums list providers detected at start, falling back to all eligible providers after exclusions when none are detected |
| diagnostics | `diagnose` tool and `ask-llm doctor` | `diagnose` tool and `ask-llm doctor` | `diagnose` tool and `ask-llm doctor` | `diagnose` tool and `ask-llm doctor` | `diagnose` tool and `ask-llm doctor` | `diagnose` tool and `ask-llm doctor` | `ask-llm doctor` (no `diagnose` tool) | `diagnose` tool and `ask-llm doctor` | `diagnose` tool and `ask-llm doctor` |
| pairing | per-edit codex-pair hooks from the plugin, off until `/codex-pair` consent | on demand through the `ask-llm-codex-pair` skill; no per-edit review | on demand through the `ask-llm-codex-pair` skill; no per-edit review | on demand through the `ask-llm-codex-pair` skill; no per-edit review | per-edit pair hook by manual registration; Codex default or opt-in Claude; off without the marker | on demand through the `ask-llm-codex-pair` skill; no per-edit review | per-edit codex-pair extension, off until project trust, the marker and `/codex-pair` consent | none | on demand through the `ask-llm-codex-pair` skill; no per-edit review |
| subagents | isolated reviewer agents from the plugin | none; reviews run inline | none; reviews run inline | none; reviews run inline | none; reviews run inline | none; reviews run inline | none; reviews run inline | none | none; reviews run inline |
| Stop gate | blocks the turn on a HIGH codex-pair finding only with `blockOn: HIGH` | none | none | none | none | none | none; codex-pair findings are non-blocking | none | none |
<!-- HOST-PARITY:END -->
## Setup limits

Claude Desktop is tools only. Antigravity needs the workflow-copy step printed by setup. Existing Codex registrations require manual inspection of user and project configuration, including filters. OpenCode registration is tested with fixtures only. See [Migration](/reference/migration) when setup leaves an earlier entry unchanged.

## Claude Code

Claude Code has isolated reviewer agents and hooks. Only its opt-in `blockOn: HIGH` Stop gate can block a turn on pair findings; other hosts do not claim that gate. [Claude Code host notes](/compatibility/claude-code) include the hooks and agents reference.

## Cursor

Cursor runs consent-gated pairing on demand, with exact provider/model options. It does not run Claude Code hooks. See [Cursor host notes](/compatibility/cursor).

## Pi

Pi 0.83.0+ has native tools and per-edit pairing, gated by marker, project trust and user-owned consent. Findings do not block turns. One-shot print mode does not support asynchronous pairing. See [Pi host notes](/compatibility/pi).

## Other hosts

Portable reviews, comparisons and brainstorming run inline where isolated subagents are unavailable. Tool prefixes and skill syntax belong to each host. The logical schemas and provider options are shared; provider-specific limits are described in each provider reference. Clients outside this matrix can use [manual configuration](/advanced/manual-configuration), without a claim of automatic setup support.
