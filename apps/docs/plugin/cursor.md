---
description: Use Ask LLM pairing skills from Cursor Agent through Cursor's native Agent Skills and MCP plugin surfaces, without Claude-only hook assumptions.
---

# Cursor Agent Host

`@ask-llm/plugin` ships a Cursor Plugin adapter in `.cursor-plugin/plugin.json`. Cursor loads exactly the two Cursor-adapted skills (`/codex-pair`, `/grok-pair`) through its Agent Skills surface and the unified Ask LLM server through `mcp.json`; the manifest sets `agents: []`, `commands: []`, and `hooks: {}` (Cursor's manifest schema accepts a path or array for `agents`/`commands` and a path or object for `hooks`, and a present field replaces folder discovery) so Claude-only reviewer agents and the Claude-format `hooks/hooks.json` are never auto-discovered by Cursor. The remaining review/brainstorm/compare skills still use Claude-only mechanics and are deferred to separate Cursor-compatibility work. It does not consume Claude Code's hook registration, `${CLAUDE_PLUGIN_ROOT}`, `AskUserQuestion`, or Claude MCP namespace conventions.

## Start from source

```bash
yarn install --immutable
yarn build
agent --plugin-dir ./packages/claude-plugin
```

Installed plugins expose only `/codex-pair` and `/grok-pair` in Cursor's `/` skill menu. The Cursor manifest deliberately omits `/codex-pair-ack`, `/codex-pair-pause`, and `/codex-pair-resume`: those toggle the Claude Code/Pi background per-edit reviewer through `.codex-pair/state` sentinels, and Cursor's on-demand session has no background reviewer for them to act on. If you only want MCP setup, copy the `packages/claude-plugin/mcp.json` entry to project `.cursor/mcp.json` or user `~/.cursor/mcp.json`, then restart/reload Cursor Agent. The adapter bundles exactly one server:

- `ask-llm` → `@ask-llm/mcp` (`ask-cursor-agent` plus the unified `ask-llm` tool, which pair skills call only fully pinned — provider, harness, exact model, effort, include directories, session — never as a generic fallback).

Keep one registration per server: if the plugin is loaded, do not add a second `ask-llm` entry in `.cursor/mcp.json`. The split servers are optional user installs, not plugin bundles — `codex` → `@ask-llm/codex-mcp` (`ask-codex`) and `grok` → `@ask-llm/grok-mcp` (`ask-grok`); when such a deterministic leaf is exposed the pair skills prefer it, otherwise they use only fully pinned unified calls and never fall back between tools.

## `/codex-pair` on Cursor

Cursor's `/codex-pair` is an on-demand iterative pair session. Cursor remains the editor; an authenticated Codex CLI is the explicit read-only reviewer. Both `model=<exact ID>` and `effort=low|medium|high|xhigh|max` are required: the adapter cannot safely infer environment defaults inside a separately spawned MCP server. If either is omitted, pairing stops before extra context is read or consent is requested. Before calling the provider it reports those exact choices, bounded files, relative include directories, quota/data boundary, and asks for consent.

The first Codex call (`ask-codex` when user-installed, otherwise the fully pinned unified `ask-llm` with `provider: "codex"`) passes `sessionId: ""` to create a persisted thread and may pass up to 32 safe relative `includeDirs`. Follow-ups reuse the returned structured Thread ID and omit `includeDirs`, because `codex exec resume` does not support `--add-dir`; a resumed call that still passes `includeDirs` is rejected by every Codex transport (split `ask-codex`, unified `ask-llm`) rather than silently dropping the directories. Feedback is relayed and source-verified before Cursor edits. Interrupts cancel the MCP call; unavailable tools/models, partial failures, and any Codex quota fallback are reported rather than hidden.

Example:

```text
/codex-pair model=gpt-5.6-sol effort=high include=packages/api,packages/shared review this migration
```

With the plugin loaded, the unified `ask-llm` tool is the bundled transport: `/codex-pair` uses it with `provider: "codex"` and every option pinned; unsupported combinations (including `includeDirs` on a resumed thread) are rejected instead of stripped. A separately user-installed `ask-codex` leaf is preferred when exposed. If neither is present, install the recommended unified server instead of making a generic call:

```json
{
  "mcpServers": {
    "ask-llm": { "command": "npx", "args": ["-y", "@ask-llm/mcp"] }
  }
}
```

Save it in project `.cursor/mcp.json` or user `~/.cursor/mcp.json`, authenticate `codex`, then reload the server from **Cursor Settings → Tools & MCP** or restart Cursor Agent. A `codex` entry using `@ask-llm/codex-mcp` remains the optional user-installed split-tool alternative.

## `/grok-pair` route safety

When Cursor itself is the host, `/grok-pair` does not recursively invoke Cursor Agent. Select `xai-api` or `grok-cli` through the bundled unified `ask-llm` with provider, harness, exact model, and effort all pinned, or through a separately user-installed `ask-grok` leaf when exposed; there is no fallback. Claude Code may instead select Grok through the model-neutral `ask-cursor-agent` tool; that route keeps host, provider, Cursor harness, exact catalog ID, and optional display label separate and refuses Auto or cross-provider substitution.

If neither direct leaf is exposed, configure the recommended unified server and reload Cursor MCP:

```json
{
  "mcpServers": {
    "ask-llm": { "command": "npx", "args": ["-y", "@ask-llm/mcp"] }
  }
}
```

Save it in project `.cursor/mcp.json` or user `~/.cursor/mcp.json`. The `xai-api` route needs `XAI_API_KEY` in the MCP process environment; keep literal secrets in user-level configuration and never commit them. The `grok-cli` route needs authenticated Grok Build with headless JSON flags visible in `grok --help`. Reload from **Cursor Settings → Tools & MCP** or restart Cursor Agent, then invoke `/grok-pair` again. Unified startup probes both direct harnesses, so a CLI-only login works without setting `ASK_GROK_HARNESS=grok-cli`; the request still pins `harness: "grok-cli"`, and no API fallback occurs. A CLI-only call that omits `harness` fails with a diagnostic naming that pin (or `ASK_GROK_HARNESS=grok-cli`), and an explicit `ASK_GROK_HARNESS` makes startup readiness track that harness alone.

## Lifecycle differences

| Capability | Claude Code | Cursor Agent |
|---|---|---|
| `/codex-pair` | Marker-gated continuous hooks plus dashboard | On-demand skill-backed persisted reviewer session |
| Registration | Claude plugin + `.mcp.json` (Codex only) | Cursor Plugin Agent Skills + `mcp.json` (unified `ask-llm` only; split servers user-installed) |
| Include directories | Per-edit context from marker/project | Explicit safe relative `includeDirs` on first Codex call |
| Completion gate | Optional Claude Stop hook | Explicit completed/cancelled/failed session report |
| Cancellation | Claude hook/provider process lifecycle | Cursor MCP AbortSignal/interrupt |
| Pause / resume / ack | `/codex-pair-pause`, `/codex-pair-resume`, `/codex-pair-ack` toggle the background hook | Not exposed — no background reviewer; end or restart the on-demand session |

The portable contract is canonical in `packages/claude-plugin/skills/pairing-contract.md`; host adapters must not claim lifecycle guarantees their host does not provide.
