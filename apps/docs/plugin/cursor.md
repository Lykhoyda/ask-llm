---
description: Use Ask LLM pairing skills from Cursor Agent through Cursor's native Agent Skills and MCP plugin surfaces, without Claude-only hook assumptions.
---

# Cursor Agent Host

`@ask-llm/plugin` ships a Cursor Plugin adapter in `.cursor-plugin/plugin.json`. Cursor loads the canonical `SKILL.md` corpus through its Agent Skills surface and the exact provider tools through `mcp.json`. It does not consume Claude Code's hook registration, `${CLAUDE_PLUGIN_ROOT}`, `AskUserQuestion`, or Claude MCP namespace conventions.

## Start from source

```bash
yarn install --immutable
yarn build
agent --plugin-dir ./packages/claude-plugin
```

Installed plugins expose `/codex-pair` and `/grok-pair` in Cursor's `/` skill menu. If you only want MCP setup, copy `packages/claude-plugin/mcp.json` entries to project `.cursor/mcp.json` or user `~/.cursor/mcp.json`, then restart/reload Cursor Agent. The adapter registers:

- `codex` → `@ask-llm/codex-mcp` (`ask-codex`);
- `grok` → `@ask-llm/grok-mcp` (`ask-grok`);
- `ask-llm` → `@ask-llm/mcp` (`ask-cursor-agent` plus unified tools).

## `/codex-pair` on Cursor

Cursor's `/codex-pair` is an on-demand iterative pair session. Cursor remains the editor; an authenticated Codex CLI is the explicit read-only reviewer. Before calling the provider it reports the exact model, reasoning effort, bounded files, relative include directories, quota/data boundary, and asks for consent.

The first `ask-codex` call passes `sessionId: ""` to create a persisted thread and may pass up to 32 safe relative `includeDirs`. Follow-ups reuse the returned structured Thread ID and omit `includeDirs`, because `codex exec resume` does not support `--add-dir`. Feedback is relayed and source-verified before Cursor edits. Interrupts cancel the MCP call; unavailable tools/models, partial failures, and any Codex quota fallback are reported rather than hidden.

Example:

```text
/codex-pair model=gpt-5.6-sol effort=high include=packages/api,packages/shared review this migration
```

If `ask-codex` is absent, configure the exact server instead of using a generic call:

```json
{
  "mcpServers": {
    "codex": { "command": "npx", "args": ["-y", "@ask-llm/codex-mcp"] }
  }
}
```

## `/grok-pair` route safety

When Cursor itself is the host, `/grok-pair` does not recursively invoke Cursor Agent. Select `xai-api` or `grok-cli` through `ask-grok`, with exact harness/model/effort and no fallback. Claude Code may instead select Grok through the model-neutral `ask-cursor-agent` tool; that route keeps host, provider, Cursor harness, exact catalog ID, and optional display label separate and refuses Auto or cross-provider substitution.

## Lifecycle differences

| Capability | Claude Code | Cursor Agent |
|---|---|---|
| `/codex-pair` | Marker-gated continuous hooks plus dashboard | On-demand skill-backed persisted reviewer session |
| Registration | Claude plugin + `.mcp.json` | Cursor Plugin Agent Skills + `mcp.json` |
| Include directories | Per-edit context from marker/project | Explicit safe relative `includeDirs` on first Codex call |
| Completion gate | Optional Claude Stop hook | Explicit completed/cancelled/failed session report |
| Cancellation | Claude hook/provider process lifecycle | Cursor MCP AbortSignal/interrupt |

The portable contract is canonical in `packages/claude-plugin/skills/pairing-contract.md`; host adapters must not claim lifecycle guarantees their host does not provide.
