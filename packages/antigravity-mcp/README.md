# ask-antigravity-mcp (EXPERIMENTAL)

MCP server for Google's Antigravity CLI (`agy`). Lets Claude get a
subscription-backed second opinion / code review from Antigravity.

> **Experimental.** `agy`'s headless `-p` mode does not reliably print to stdout
> (gemini-cli #27466) and exposes no JSON output or session id. This server reads
> `agy`'s internal transcript files as a fallback, so it is sensitive to changes
> in `agy`'s on-disk layout. One-shot only: no model selection, no multi-turn.

## Prerequisites
- `agy` installed and on PATH, and logged in once (run `agy` interactively).

## Config
- `ASK_ANTIGRAVITY_TIMEOUT_MS` — process timeout (default 300000 = 5m).
- `ASK_ANTIGRAVITY_SANDBOX` — set `0` to drop `--sandbox` if it blocks context reads.
