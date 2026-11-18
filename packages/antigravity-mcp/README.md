# @ask-llm/antigravity-mcp (EXPERIMENTAL)

MCP server for Google's Antigravity CLI (`agy`). Lets Claude get a
subscription-backed second opinion / code review from Antigravity.

> **Experimental.** Discovery and ping report unsupported or
> unverifiable installations as detected but unusable, exclude them from
> dispatch, and provide an actionable update diagnostic. The executor consumes
> agy's structured JSON stdout; see the [provider guide](https://lykhoyda.github.io/ask-llm/providers/antigravity)
> for response parsing, version gates, token usage, and limitations. For follow-ups and
> reset behavior, see [Sessions](https://lykhoyda.github.io/ask-llm/providers/antigravity#sessions). Defaults to the
> gemini-4-argon model at high reasoning effort, falling back to gemini-3.8-flash
> on a rate limit. When agy rejects a model whose value equals one of those
> built-in base slugs (upstream drift), the executor retries once without a
> model and lets agy pick its default; any other rejected model fails with an
> actionable error naming `agy models`.

This package's review tool and read-only machine execution refuse before probing agy unless `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1`. Opted-in runs still carry no read-only guarantee. See [What protects opted-in runs](https://lykhoyda.github.io/ask-llm/providers/antigravity#what-protects-opted-in-runs) for the session-only settings overlay, affected users, update guidance, and isolation limits.

## Prerequisites
- A [supported agy version](https://lykhoyda.github.io/ask-llm/providers/antigravity#prerequisites) installed and on PATH (`agy --version`), and logged in once (run `agy` interactively).

## Config
- `ASK_ANTIGRAVITY_ALLOW_UNISOLATED` — unset by default; only the exact value `1` permits unisolated execution.
- `ASK_ANTIGRAVITY_TIMEOUT_MS` — process timeout (default 300000 = 5m). Raise it or shorten the prompt if agy hits its print timeout. Fresh and resumed calls report timeouts, interruptions, and failures from agy's JSON envelope even on exit 0, with stderr timeout warnings as a fallback.
- `ASK_ANTIGRAVITY_SANDBOX` — set `0` to drop `--sandbox` from review calls if it blocks context reads; see the provider guide for the quota-probe exception.
- `ASK_ANTIGRAVITY_MODEL` — agy model via `--model` (default `gemini-4-argon`, with `gemini-3.8-flash` as the rate-limit fallback; run `agy models` for options). Legacy effort-carrying display strings like `Gemini 4 Argon (High)` still resolve for backward compatibility, but they conflict with `--effort`, so the default effort is only sent when the model value equals one of the built-in base slugs.
- `ASK_ANTIGRAVITY_EFFORT` — agy reasoning effort via `--effort` (`low` | `medium` | `high`; default `high`). The default effort is paired with the built-in base slugs and with model-less recovery attempts; an explicitly set value is always passed (you own the model/effort combination — note agy limits some tiers per model, run `agy models` to see each model's tiers). Invalid values log a warning and fall back to the default behavior.
