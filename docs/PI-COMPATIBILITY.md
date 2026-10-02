# Pi host compatibility inventory

This inventory is the committed disposition for every workflow shipped by the canonical `@ask-llm/mcp` package. Pi is a **host harness**, not a consulted Ask LLM provider. Claude Code and Pi load the same skill files (Claude Code through its plugin, Pi from the shared skills folder that `ask-llm setup` fills); portable contracts and explicit host adapters are delimited in those files.

Classifications: **host-neutral**, **thin host adapter**, **lifecycle integration**, and **Claude-only**.

## Skills

| Skill | Classification | Pi disposition |
|---|---|---|
| `ask-llm-antigravity-review` | Thin host adapter | Portable review contract runs inline through native `ask-antigravity`. |
| `ask-llm-brainstorm` | Thin host adapter | Standard mode commits the current Pi host's independent view before deterministic `ask-multi`. Exact Grok + GPT-6 Sol mode instead calls `ask-cursor-agent` for only the two explicit provider/model pairs, treats the host view as non-voting evidence, excludes Gemini, and never upgrades a partial failure to consensus. |
| `ask-llm-brainstorm-all` | Thin host adapter | Same as `brainstorm`, with all five external providers. |
| `ask-llm-codex-image` | Thin host adapter | Native `ask-codex` with explicit `sandbox: "workspace-write"`, followed by filesystem verification. |
| `ask-llm-codex-pair` | Lifecycle integration + thin adapter | Pi command owns consent/status; extension observes successful `tool_result` edit/write events, debounces, reviews, and injects findings. |
| `ask-llm-codex-pair-ack` | Thin host adapter | Pi command dismisses a finding reminder. Pi has no blocking Stop gate. |
| `ask-llm-codex-pair-pause` | Host-neutral + thin command | Shared pause sentinel; native Pi command is the convenient adapter. |
| `ask-llm-codex-pair-resume` | Host-neutral + thin command | Shared pause/failure state; native Pi command is the convenient adapter. |
| `ask-llm-review` | Thin host adapter | Portable reviewer contract runs inline through native `ask-codex`; no false claim of isolated context. |
| `ask-llm-codex-verify` | Thin host adapter | Portable claim-verification contract runs inline with focused `ask-codex` calls. |
| `ask-llm-compare` | Thin host adapter | One `ask-multi` call guarantees bounded concurrent dispatch and stable result order. |
| `ask-llm-fable-review` | Claude-only | Retained for Claude Code's independent Fable agent, but excluded from Pi discovery and advertising. No nested Pi session or Fable provider bridge is added. |
| `ask-llm-gemini-review` | Thin host adapter | Portable review contract runs inline through native `ask-gemini`. |
| `ask-llm-grok-pair` | Claude/Cursor host adapter; refuses on Pi | Claude selects explicit Cursor/xAI/CLI Grok routes; Cursor avoids recursive Cursor invocation. The shared skills folder also exposes it to Pi, where it refuses until a dedicated consent/lifecycle adapter exists. |
| `ask-llm-grok-review` | Thin host adapter | Portable review contract runs inline through native `ask-grok`; the explicit `xai-api`/`grok-cli` harness and exact model are disclosed, with no fallback. |
| `ask-llm-multi-review` | Thin host adapter | One `ask-multi` dispatch followed by host-side source verification. |
| `ask-llm-ollama-review` | Thin host adapter | Portable review contract runs inline through local native `ask-ollama`. |
| `ask-llm-sol-review` | Thin host adapter | Native `ask-codex`, explicitly pinned to Sol/high/read-only, with fallback disclosure. |

## Agents and hooks

The nine files under `packages/llm-mcp/agents/` are Claude Code subagent execution surfaces. Their delimited **Portable contract** sections are reusable by Pi; their frontmatter and delimited Claude Code adapters are not. Pi does not spawn nested agent processes and does not claim context isolation.

Claude hooks remain unchanged and Claude-only as execution surfaces. Pi maps only the product behavior that needs lifecycle support:

| Claude Code behavior | Pi behavior |
|---|---|
| `PostToolUse` Edit/Write/MultiEdit | successful built-in `tool_result` for `edit` or `write`, using `event.input.path` |
| detached debounce worker | in-process trailing debounce with max cap; no detached worker or daemon |
| pending hook context | persisted at-least-once custom message delivered with `steer`, `triggerTurn: false`; stable `findingId` supports receiver deduplication across the bounded crash duplicate window |
| SessionEnd cleanup | idempotent `session_shutdown`: close epoch, clear timers, abort provider work, await bounded settlement, release owned locks |
| `blockOn: HIGH` Stop gate | **unsupported**: findings are loud but non-blocking; Pi has no safe blocking turn-end event |
| one-shot hook output | **unsupported for asynchronous pairing in print mode**; use TUI, RPC, or a long-lived JSON process |
| Fable subagent | **unsupported and not loaded** |

## Security and consent

Pi pairing requires all three conditions:

1. a repository `.codex-pair/context.md` marker;
2. Pi project trust; and
3. a user-owned allowlist entry keyed by the canonical project root, created through interactive `/codex-pair` confirmation.

A committed marker alone never authorizes project-data transfer or Codex cost. Consent lives under `PI_CODING_AGENT_DIR` (normally `~/.pi/agent/ask-llm/codex-pair-projects.json`) and is revoked with `/codex-pair revoke`.

The extension factory detects provider availability before registering tools. Model requests and codex-pair work start only from an explicit tool call, command, or session event.

## Provider bridge

See [HOST-PARITY.md](HOST-PARITY.md) for the native tools' schema and response guarantees, availability rules, and contract test.

`ask-codex`, `ask-gemini`, `ask-grok`, `ask-ollama`, `ask-antigravity` and `ask-multi` remain as deprecated aliases. They invoke each provider package's public `./register` `executeTool` contract so canonical validation, response structure, session behavior, fallbacks, and errors remain provider-owned. `ask-multi` is concrete Pi glue: a bounded `Promise.allSettled` fan-out over two to five unique providers, with per-provider options, stable input-order results and explicit failures.
