# @ask-llm/antigravity-mcp (EXPERIMENTAL)

MCP server for Google's Antigravity CLI (`agy`). Lets Claude get a
subscription-backed second opinion / code review from Antigravity.

> **Experimental.** Validated against `agy` 1.1.5 (base model slugs + separate
> `--effort` flag); `agy` >=1.0.6 prints the response to stdout (gemini-cli
> #27466 is fixed there); older versions fall back to reading `agy`'s internal
> transcript files (sensitive to `agy`'s on-disk layout). No JSON output or
> session id, so it stays single-turn (no multi-turn). Defaults to the
> gemini-3.1-pro model at high reasoning effort, falling back to gemini-3.5-flash
> on a rate limit. When agy rejects a model whose value equals one of those
> built-in base slugs (upstream drift), the executor retries once without a
> model and lets agy pick its default; any other rejected model fails with an
> actionable error naming `agy models`.

## Prerequisites
- `agy` installed and on PATH, and logged in once (run `agy` interactively).

## Config
- `ASK_ANTIGRAVITY_TIMEOUT_MS` — process timeout (default 300000 = 5m).
- `ASK_ANTIGRAVITY_SANDBOX` — set `0` to drop `--sandbox` if it blocks context reads.
- `ASK_ANTIGRAVITY_MODEL` — agy model via `--model` (default `gemini-3.1-pro`, with `gemini-3.5-flash` as the rate-limit fallback; run `agy models` for options). Legacy effort-carrying display strings like `Gemini 3.1 Pro (High)` still resolve for backward compatibility, but they conflict with `--effort`, so the default effort is only sent when the model value equals one of the built-in base slugs.
- `ASK_ANTIGRAVITY_EFFORT` — agy reasoning effort via `--effort` (`low` | `medium` | `high`; default `high`). The default effort is paired with the built-in base slugs and with model-less recovery attempts; an explicitly set value is always passed (you own the model/effort combination — note agy limits some tiers per model, e.g. `gemini-3.1-pro` has no `medium`). Invalid values log a warning and fall back to the default behavior.
