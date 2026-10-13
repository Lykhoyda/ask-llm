---
description: Understand what a review sends, who can edit, and where session state lives.
---

# Data flow

The coding assistant gathers the diff, selected files and relevant project context, then sends that material to the provider you choose. That provider returns an opinion; your assistant remains the editor. Hosting Ask LLM in Claude Code does not mean Claude is the reviewer, and Claude Code cannot consult a nested Claude session.

## Review boundaries

Codex, Claude, Gemini, Grok and Cursor review routes use read-only controls. Antigravity refuses execution by default; enabling it does not give a read-only guarantee. Local Ollama inference stays on the configured server; use a local endpoint when your material must stay on your machine. A remote `OLLAMA_HOST` sends material to that endpoint.

Ask LLM sends no telemetry. Selected hosted providers receive your prompts and code under their own policies, and the host can retain its conversation. Grok's API route uses `store:false`; that request setting is not a guarantee about every provider retention policy.

## Request Flow

<RequestFlow />

For a single-provider call (`ask-llm` with `provider: "gemini"`), only one of the provider lanes fires. For `multi-llm`, both fire in parallel via `Promise.all` inside the Ask LLM process; per-provider failures are isolated, so one provider hitting quota doesn't fail the whole call.

## Connection details

Provider executors apply their own controls:

- **Quota fallback**: Gemini Pro → Flash on `RESOURCE_EXHAUSTED`; Codex `gpt-6-astra` → `gpt-5.6-terra` on quota errors
- **Stdin handling**: Codex needs an EOF-terminated pipe rather than `/dev/null`, otherwise it errors out
- **PATH resolution**: macOS GUI clients (Claude Desktop) don't inherit your shell's PATH; the server resolves it from your login shell at startup
- **Live progressive output**: Gemini's `--output-format stream-json` deltas are parsed and forwarded to MCP progress notifications, so users see Gemini's prose unfolding rather than a frozen wait
- **Session continuity**: Claude, Gemini, Codex, and Ollama support multi-turn via the `sessionId` parameter; Codex requires `sessionId: ""` on turn one to persist a resumable thread, while an omitted value stays ephemeral (Grok and Antigravity are single-turn)
- **Read-only Claude consultations**: Claude consultations use safe mode and exposes only Read, Glob, and Grep; the MCP host performs any edits
- **Structured responses**: every `ask-*` tool returns both human-readable text AND a structured `AskResponse` (provider, response, model, sessionId, usage) via MCP `outputSchema` so programmatic clients don't have to parse the response footer

You don't need to think about any of this; it's just the infrastructure that makes the natural-language flow work reliably.

## Session storage

Codex calls are ephemeral when `sessionId` is omitted; a resumable first call uses `sessionId: ""`. Claude, Gemini and Codex manage persisted sessions in their own CLI storage. Ollama replays history stored in `/tmp/ask-llm-sessions/<id>.json` with owner-only permissions, a 24-hour TTL and a 40-message cap. Grok and Antigravity are single-turn. Cursor conversations have their own returned/resumed ID.

Usage totals are in memory and reset when the server restarts. Pairing writes user-owned logs and state under `.codex-pair/`; see [pair review](/advanced/codex-pair). Do not treat model agreement as evidence that a claim is correct. Validate it against source, tests and requirements.
