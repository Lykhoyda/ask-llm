---
description: The shared consultation interface, structured responses and host-specific diagnostics.
---

# Tools and schemas

Most hosts expose these tools over MCP. Pi exposes `ask-llm`, `multi-llm` and `ask-cursor-agent` natively with the same schemas; diagnostics on Pi use the CLI. See [Hosts](/compatibility/hosts).

The orchestrator exposes a single `ask-llm` tool (not one per provider), so the same tool surface is registered whenever any provider is installed:

| Tool | Purpose |
|------|---------|
| `ask-llm` | Single unified tool; picks the provider via `provider` parameter (`gemini`, `codex`, `claude`, `grok`, `ollama`, `antigravity`). Optional `harness` (Grok only), `includeDirs` (Codex/Claude/Antigravity), `reasoningEffort` (Codex/Grok), and Codex-only `preferred`/`sandbox` are forwarded; unsupported combinations fail validation instead of being stripped. For Codex continuity, pass `sessionId: ""` first, then resume with the returned ID; resumed Codex calls reject `includeDirs` |
| `ask-cursor-agent` | Model-neutral Cursor Agent harness. Requires separate `provider` (`claude`, `codex`, `gemini`, `grok`), exact `model` from `agent --list-models`, and `prompt`; the requested model must match the provider family (Auto and noncanonical IDs are refused) and is echoed back as `model`, with Cursor's display label in optional `reportedModel`; optional relative `includeDirs` map to repeated `--add-dir`, and the returned Cursor conversation `sessionId` can be passed back to resume; prompts above 16 KB are piped over stdin; read-only ask mode, no fallback |
| `multi-llm` | Dispatch the same prompt to multiple providers in parallel; returns per-provider responses + usage in one call |
| `get-usage-stats` | Per-session token totals + breakdowns by provider/model; in-memory, no persistence |
| `diagnose` | Self-diagnosis: Node version, PATH, provider CLI presence + versions. Read-only |
| `ping` | Connection test |

The orchestrator uses a single `ask-llm` provider-routing tool (not one per provider) for token efficiency. All `ask-*` tools return both human-readable text and a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema`.

Codex calls are ephemeral when `sessionId` is omitted. To create a resumable Codex conversation, pass `sessionId: ""` on the first `ask-llm` call and pass its returned Thread ID on follow-ups.

It also exposes `usage://current-session` as an MCP Resource for live JSON snapshots of token spend.

## ask-llm parameters

Send a prompt to any installed provider, picked via the `provider` parameter.

**Parameters:**
- `prompt` (required): The question, code review request, or analysis task.
- `provider` (required): One of `codex`, `claude`, `grok`, `antigravity`, `ollama`, `gemini`; detected providers are listed, falling back to eligible providers after exclusions when none are detected. Claude is intentionally unavailable when Claude Code itself is the host because nested Claude sessions are unsupported.
- `model` (optional): Override the default model. Usually unnecessary; defaults are sensible per provider with auto-fallback.
- `sessionId` (optional): Resume a previous conversation. For Codex, pass `""` on the first call to create a persisted thread, then pass its returned Thread ID; omitting it makes the Codex call ephemeral. For other providers, pass the value from a prior response's `[Session ID: ...]` footer (or `result.structuredContent.sessionId` for programmatic clients).

**Returns:** Both human-readable text (`content[0].text`) AND a structured `AskResponse` (`structuredContent`) with `{provider, response, model, sessionId, usage}`; programmatic clients can extract fields directly without regex-parsing the footer.

- `harness`: Grok-only `xai-api` or `grok-cli`; no failover.
- `includeDirs`: validated relative paths for Codex, Claude and Antigravity; resumed Codex calls reject this field.
- `reasoningEffort`: Codex or Grok; other providers reject it.
- `preferred`, `sandbox`: Codex-only. Reviews default to read-only; writable sandboxes require deliberate opt-in.

Unsupported combinations fail validation rather than being stripped. Exact enum and range constraints come from the tool schema advertised by your installed version.

## Parallel dispatch

`multi-llm` takes `prompt` and optional `providers`. Omitted providers means all detected providers. Results isolate failures and include provider, success/error, model, response, usage and duration. Inspect per-provider failures; success from one model cannot replace a missing participant.

## Sessions

**Claude, Gemini, and Codex** use their CLIs' native session-resume features. Sessions live in each provider CLI's own storage. The provider retains prior turns; each follow-up still consumes account quota or billing. Codex persists a fresh thread only when its first call passes `sessionId: ""`; omitted Codex calls stay ephemeral. Claude sessions are intended for Codex and other non-Claude hosts; the unified server suppresses Claude inside Claude Code to prevent unsupported nested sessions.

**Ollama** has no native session support. The MCP server stores conversation history at `/tmp/ask-llm-sessions/<id>.json` with **24-hour TTL**, **40-message cap** (oldest dropped on overflow), **owner-only file permissions** (0o600 file / 0o700 directory), and **atomic temp+rename writes** to avoid partial-read races. Each turn replays the full prior conversation, which costs input tokens proportional to depth, bounded by the 40-message cap and acceptable for local-only inference.

To start a fresh Ollama session explicitly, pass `sessionId: ""` (empty string); the executor creates a new UUID and returns it in the response.

---

## Legacy tool reference

Earlier provider-specific tools and Pi aliases remain documented in the unchanged provider pages and [Migration](/reference/migration). For workflow command names, see [Skills](/reference/skills).
