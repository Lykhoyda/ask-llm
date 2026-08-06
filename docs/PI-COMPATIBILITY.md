# Pi host compatibility inventory

This inventory is the committed disposition for every workflow shipped by the canonical `@ask-llm/plugin` package. Pi is a **host harness**, not a consulted Ask LLM provider. Claude Code and Pi load the same skill files; portable contracts and explicit host adapters are delimited in those files.

Classifications: **host-neutral**, **thin host adapter**, **lifecycle integration**, and **Claude-only**.

## Skills

| Skill | Classification | Pi disposition |
|---|---|---|
| `antigravity-review` | Thin host adapter | Portable review contract runs inline through native `ask-antigravity`. |
| `brainstorm` | Thin host adapter | The current Pi host model commits its independent view before deterministic `ask-multi` dispatch. The host is not assumed to be Claude, and same-family overlap is disclosed. |
| `brainstorm-all` | Thin host adapter | Same as `brainstorm`, with all four external providers. |
| `codex-image` | Thin host adapter | Native `ask-codex` with explicit `sandbox: "workspace-write"`, followed by filesystem verification. |
| `codex-pair` | Lifecycle integration + thin adapter | Pi command owns consent/status; extension observes successful `tool_result` edit/write events, debounces, reviews, and injects findings. |
| `codex-pair-ack` | Thin host adapter | Pi command dismisses a finding reminder. Pi has no blocking Stop gate. |
| `codex-pair-pause` | Host-neutral + thin command | Shared pause sentinel; native Pi command is the convenient adapter. |
| `codex-pair-resume` | Host-neutral + thin command | Shared pause/failure state; native Pi command is the convenient adapter. |
| `codex-review` | Thin host adapter | Portable reviewer contract runs inline through native `ask-codex`; no false claim of isolated context. |
| `codex-verify` | Thin host adapter | Portable claim-verification contract runs inline with focused `ask-codex` calls. |
| `compare` | Thin host adapter | One `ask-multi` call guarantees bounded concurrent dispatch and stable result order. |
| `fable-review` | Claude-only | Retained for Claude Code's independent Fable agent, but excluded from Pi discovery and advertising. No nested Pi session or Fable provider bridge is added. |
| `gemini-review` | Thin host adapter | Portable review contract runs inline through native `ask-gemini`. |
| `multi-review` | Thin host adapter | One `ask-multi` dispatch followed by host-side source verification. |
| `ollama-review` | Thin host adapter | Portable review contract runs inline through local native `ask-ollama`. |
| `sol-review` | Thin host adapter | Native `ask-codex`, explicitly pinned to Sol/high/read-only, with fallback disclosure. |

## Agents and hooks

The eight files under `packages/claude-plugin/agents/` are Claude Code subagent execution surfaces. Their delimited **Portable contract** sections are reusable by Pi; their frontmatter and delimited Claude Code adapters are not. Pi does not spawn nested agent processes and does not claim context isolation.

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

The extension factory registers resources only. It performs no filesystem read, timer creation, or provider invocation until a session event, command, tool call, or successful edit/write result requires it.

## Provider bridge

Pi intentionally has no built-in MCP client. The extension therefore registers native `ask-codex`, `ask-gemini`, `ask-ollama`, `ask-antigravity`, and `ask-multi` tools. Individual tools invoke each provider package's public `./register` `executeTool` contract so canonical validation, response structure, session behavior, fallbacks, and errors remain provider-owned. `ask-multi` is concrete Pi glue: a bounded `Promise.allSettled` fan-out over two to four unique providers, with stable input-order results and explicit failures.
