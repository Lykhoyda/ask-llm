---
description: Portable workflows and on-demand pairing in Cursor; lifecycle limits remain explicit.
---

# Cursor host notes

Setup registers the user-scope connection and installs portable workflows into the skills folder. Follow [Install](/start/install) and restart Cursor. The source adapter exposes two pair skills and their earlier-name pointers; it disables discovery of Claude-only agents and hooks. See [manual configuration](/advanced/manual-configuration) for project scope and [Migration](/reference/migration) for earlier registrations.

## `/codex-pair` on Cursor

Cursor's `/codex-pair` is an on-demand iterative pair session. Cursor remains the editor; an authenticated Codex CLI is the explicit read-only reviewer. Both `model=<exact ID>` and `effort=low|medium|high|xhigh|max|ultra` are required: the adapter cannot safely infer environment defaults inside a separately spawned MCP server. If either is omitted, pairing stops before extra context is read or consent is requested. Before calling the provider it reports those exact choices, bounded files, relative include directories, quota/data boundary, and asks for consent.

The first Codex call (`ask-codex` when user-installed, otherwise the fully pinned unified `ask-llm` with `provider: "codex"`) passes `sessionId: ""` to create a persisted thread, `sandbox: "read-only"`, and may pass up to 32 safe relative `includeDirs`. Follow-ups reuse the returned structured Thread ID and omit `includeDirs`, because `codex exec resume` does not support `--add-dir`; a resumed call that still passes `includeDirs` is rejected by every Codex transport (split `ask-codex`, unified `ask-llm`) rather than silently dropping the directories. Feedback is relayed and source-verified before Cursor edits. Interrupts cancel the MCP call; unavailable tools/models, incomplete unified schemas, partial failures, and any Codex quota fallback are reported rather than hidden.

Example:

```text
/codex-pair model=gpt-6-sol effort=medium include=packages/api,packages/shared review this migration
```

With the plugin loaded, the unified `ask-llm` tool is the bundled transport: `/codex-pair` uses it with `provider: "codex"` and every option pinned; unsupported combinations (including `includeDirs` on a resumed thread) are rejected instead of stripped. A separately user-installed `ask-codex` leaf is preferred when exposed. If neither transport is present, run `ask-llm setup --host cursor`, follow any printed guidance, authenticate Codex, and reload from **Cursor Settings → Tools & MCP** or restart Cursor Agent. Earlier registrations are covered by [Migration](/reference/migration).

## `/grok-pair` route safety

When Cursor itself is the host, `/grok-pair` does not recursively invoke Cursor Agent. Select `xai-api` or `grok-cli` through the bundled unified `ask-llm` with provider, harness, exact model, and effort all pinned, or through a separately user-installed `ask-grok` leaf when exposed; there is no fallback. Claude Code may instead select Grok through the model-neutral `ask-cursor-agent` tool; that route keeps host, provider, Cursor harness, exact catalog ID, and optional display label separate and refuses Auto or cross-provider substitution.

If neither direct transport is exposed, run `ask-llm setup --host cursor` and reload Cursor. The `xai-api` route needs `XAI_API_KEY` in the MCP process environment; keep literal secrets in user-level configuration and never commit them. The `grok-cli` route needs authenticated Grok Build with headless JSON flags visible in `grok --help`. Reload from **Cursor Settings → Tools & MCP** or restart Cursor Agent, then invoke `/grok-pair` again. Unified startup probes both direct harnesses, so a CLI-only login works without setting `ASK_GROK_HARNESS=grok-cli`; the request still pins `harness: "grok-cli"`, and no API fallback occurs. A CLI-only call that omits `harness` fails with a diagnostic naming that pin (or `ASK_GROK_HARNESS=grok-cli`), and an explicit `ASK_GROK_HARNESS` makes startup readiness track that harness alone.

## Lifecycle differences

| Capability | Claude Code | Cursor Agent |
|---|---|---|
| `/codex-pair` | Marker-gated continuous hooks plus dashboard | On-demand skill-backed persisted reviewer session |
| Registration | Claude plugin + `.mcp.json` (Codex only) | Cursor Plugin Agent Skills + `mcp.json` (unified `ask-llm` only; split servers user-installed) |
| Include directories | Per-edit context from marker/project | Explicit safe relative `includeDirs` on first Codex call |
| Completion gate | Optional Claude Stop hook | Explicit completed/cancelled/failed session report |
| Cancellation | Claude hook/provider process lifecycle | Cursor MCP AbortSignal/interrupt |
| Pause / resume / ack | `/codex-pair-pause`, `/codex-pair-resume`, `/codex-pair-ack` toggle the background hook | Setup installs the portable skills, but they do not control Cursor's on-demand session; end or restart that session instead |

The portable contract is canonical in `packages/llm-mcp/skills/ask-llm-codex-pair/pairing-contract.md`; host adapters must not claim lifecycle guarantees their host does not provide.
