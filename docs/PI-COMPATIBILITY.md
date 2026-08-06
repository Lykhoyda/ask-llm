# Pi host compatibility inventory

This inventory is the committed disposition for every workflow shipped by the canonical `@ask-llm/plugin` package. Pi is a **host harness**, not a consulted Ask LLM provider. Claude Code and Pi load the same skill files; portable contracts and explicit host adapters are delimited in those files.

Classifications: **host-neutral**, **thin host adapter**, and **Claude-only**.

## Skills

| Skill | Classification | Pi disposition |
|---|---|---|
| `antigravity-review` | Thin host adapter | Portable review contract runs inline through native `ask-antigravity`. |
| `brainstorm` | Thin host adapter | The current Pi host model commits its independent view before deterministic `ask-multi` dispatch. The host is not assumed to be Claude, and same-family overlap is disclosed. |
| `brainstorm-all` | Thin host adapter | Same as `brainstorm`, with all four external providers. |
| `codex-image` | Thin host adapter | Native `ask-codex` with explicit `sandbox: "workspace-write"`, followed by filesystem verification. |
| `codex-pair` | Claude-only | Excluded from Pi discovery; Claude Code's hook and command surface remains unchanged. |
| `codex-pair-ack` | Claude-only | Excluded from Pi discovery with the rest of the pairing command family. |
| `codex-pair-pause` | Claude-only | Excluded from Pi discovery with the rest of the pairing command family. |
| `codex-pair-resume` | Claude-only | Excluded from Pi discovery with the rest of the pairing command family. |
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

Claude hooks remain unchanged and Claude-only as execution surfaces. Pi does not map the `codex-pair` lifecycle: it registers no pairing event handlers or commands and creates no pairing consent, cache, lock, log, or pending-delivery state. Explicit Pi reviews use the native provider tools. Fable remains unsupported and unloaded.

## Pairing

Pi pairing is not included in this release. A repository `.codex-pair/context.md` marker has no Pi meaning and cannot enable automatic provider transfer or cost. Claude Code's existing marker, hook, Stop-gate, pause, acknowledgement, and logging behavior remains unchanged.

The extension factory registers provider tools only. It performs no filesystem read, timer creation, or provider invocation until an explicit tool call.

## Provider bridge

Pi intentionally has no built-in MCP client. The extension therefore registers native `ask-codex`, `ask-gemini`, `ask-ollama`, `ask-antigravity`, and `ask-multi` tools. Individual tools invoke each provider package's public `./register` `executeTool` contract so canonical validation, response structure, session behavior, fallbacks, and errors remain provider-owned. `ask-multi` is concrete Pi glue: a bounded `Promise.allSettled` fan-out over two to four unique providers, with stable input-order results and explicit failures.
