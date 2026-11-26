# @ask-llm/antigravity-mcp (EXPERIMENTAL)

> [!WARNING]
> **Retired.** `@ask-llm/antigravity-mcp` is no longer published: it was unpublished from npm in November 2026 and its MCP Registry entry is deleted. This folder is a private workspace whose Antigravity provider code is bundled into [`@ask-llm/mcp`](https://www.npmjs.com/package/@ask-llm/mcp). Install that with `npm install -g @ask-llm/mcp`, then run `ask-llm setup`; see the [migration guide](https://lykhoyda.github.io/ask-llm/reference/migration.html). The rest of this README describes the retired standalone server and is kept for reference.

MCP server for Google's Antigravity CLI (`agy`). Lets Claude get a
subscription-backed second opinion / code review from Antigravity.

> **Experimental.** Discovery and ping report unsupported or
> unverifiable installations as detected but unusable, exclude them from
> dispatch, and provide an actionable update diagnostic. The executor consumes
> agy's structured JSON stdout; see the [provider guide](https://lykhoyda.github.io/ask-llm/providers/antigravity)
> for response parsing, version gates, token usage, and limitations. For follow-ups and
> reset behavior, see [Sessions](https://lykhoyda.github.io/ask-llm/providers/antigravity#sessions). Defaults to the
> gemini-4-neon model at high reasoning effort, falling back to gemini-4-hydrogen
> on a rate limit. When agy rejects a model whose value equals one of those
> built-in base slugs (upstream drift), the executor retries once without a
> model and lets agy pick its default; any other rejected model fails with an
> actionable error naming `agy models`.

This package's review tool and read-only machine execution refuse before probing agy unless `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1`. Opted-in runs still carry no read-only guarantee. See [What protects opted-in runs](https://lykhoyda.github.io/ask-llm/providers/antigravity#what-protects-opted-in-runs) for the session-only settings overlay, affected users, update guidance, and isolation limits.

## Prerequisites
- A [supported agy version](https://lykhoyda.github.io/ask-llm/providers/antigravity#prerequisites) installed and on PATH (`agy --version`), and logged in once (run `agy` interactively).

## Config
- `ASK_ANTIGRAVITY_ALLOW_UNISOLATED` — unset by default; only the exact value `1` permits unisolated execution.
- `ASK_ANTIGRAVITY_TIMEOUT_MS` — process timeout (default 300000 = 5m). See the provider guide's [early-finish error guidance](https://lykhoyda.github.io/ask-llm/providers/antigravity#sessions).
- `ASK_ANTIGRAVITY_SANDBOX` — set `0` to drop `--sandbox` from review calls if it blocks context reads; see the provider guide for the quota-probe exception.
- `ASK_ANTIGRAVITY_MODEL` — agy model via `--model` (default `gemini-4-neon`, with `gemini-4-hydrogen` as the rate-limit fallback; accepted names are whatever `agy models` lists on your install). Legacy effort-carrying display strings are passed to agy unchanged for backward compatibility, but they conflict with `--effort`, so the default effort is only sent when the model value equals one of the built-in base slugs.
- `ASK_ANTIGRAVITY_EFFORT` — agy reasoning effort via `--effort` (`low` | `medium` | `high` | `xhigh`, default `high`). The default effort is paired with the built-in base slugs and with model-less recovery attempts. A per-call `reasoningEffort` on unified `ask-llm` takes precedence and is rejected before spawn with a recognized tiered model ID. agy validates any environment-set model and effort pair it receives. Run `agy models` to see each model's tiers. Invalid effort values log a warning and use the default behavior.
