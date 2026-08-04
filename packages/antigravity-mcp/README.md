# @ask-llm/antigravity-mcp (EXPERIMENTAL)

MCP server for Google's Antigravity CLI (`agy`). Lets Claude get a
subscription-backed second opinion / code review from Antigravity.

> **Experimental.** Requires `agy` >=1.1.5 and is validated against 1.1.5 (base
> model slugs + separate `--effort` flag); discovery and ping report older or
> unverifiable installations as detected but unusable, exclude them from
> dispatch, and provide an actionable update diagnostic. The executor requests
> `--output-format json` (supported across the whole >=1.1.5 range) and reads
> the answer plus token usage from the JSON envelope on stdout, with plain
> stdout as a defensive last resort. On agy >=1.1.9 it also passes
> `--disable-slash-commands`. Single-turn only for now (headless resume via the
> captured conversation id is tracked as follow-up work). Defaults to the
> gemini-3.1-pro model at high reasoning effort, falling back to gemini-3.5-flash
> on a rate limit. When agy rejects a model whose value equals one of those
> built-in base slugs (upstream drift), the executor retries once without a
> model and lets agy pick its default; any other rejected model fails with an
> actionable error naming `agy models`.

## Prerequisites
- `agy` >=1.1.5 installed and on PATH (`agy --version`), and logged in once (run `agy` interactively). Older versions are not supported.

## Config
- `ASK_ANTIGRAVITY_TIMEOUT_MS` — process timeout (default 300000 = 5m).
- `ASK_ANTIGRAVITY_SANDBOX` — set `0` to drop `--sandbox` if it blocks context reads.
- `ASK_ANTIGRAVITY_MODEL` — agy model via `--model` (default `gemini-3.1-pro`, with `gemini-3.5-flash` as the rate-limit fallback; run `agy models` for options). Legacy effort-carrying display strings like `Gemini 3.1 Pro (High)` still resolve for backward compatibility, but they conflict with `--effort`, so the default effort is only sent when the model value equals one of the built-in base slugs.
- `ASK_ANTIGRAVITY_EFFORT` — agy reasoning effort via `--effort` (`low` | `medium` | `high`; default `high`). The default effort is paired with the built-in base slugs and with model-less recovery attempts; an explicitly set value is always passed (you own the model/effort combination — note agy limits some tiers per model, e.g. `gemini-3.1-pro` has no `medium`). Invalid values log a warning and fall back to the default behavior.
