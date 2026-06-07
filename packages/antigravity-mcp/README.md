# ask-antigravity-mcp (EXPERIMENTAL)

MCP server for Google's Antigravity CLI (`agy`). Lets Claude get a
subscription-backed second opinion / code review from Antigravity.

> **Experimental.** Validated against `agy` 1.0.6, which prints the response to
> stdout (gemini-cli #27466 is fixed there); older versions fall back to reading
> `agy`'s internal transcript files (sensitive to `agy`'s on-disk layout). No JSON
> output or session id, so it stays one-shot: no model selection, no multi-turn.

## Prerequisites
- `agy` installed and on PATH, and logged in once (run `agy` interactively).

## Config
- `ASK_ANTIGRAVITY_TIMEOUT_MS` — process timeout (default 300000 = 5m).
- `ASK_ANTIGRAVITY_SANDBOX` — set `0` to drop `--sandbox` if it blocks context reads.
