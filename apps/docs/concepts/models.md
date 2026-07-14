---
description: Choose the right model across providers. Default models, fallback behavior (Gemini/Codex/Claude), and per-provider overrides.
---

# Model Selection

Hosted providers (Gemini, Codex, Claude) auto-select a sensible default model with automatic fallback to a lighter model on provider errors. Ollama runs locally and uses exactly the model you pull; it never substitutes another. **Most users should never override the model parameter**; the defaults are tuned for quality.

## Defaults & Fallbacks

<FallbackChain provider="codex" />

| Provider | Default | Fallback | Trigger |
|---|---|---|---|
| Gemini | `gemini-3.1-pro-preview` | `gemini-3.5-flash` | `RESOURCE_EXHAUSTED` quota error or "exhausted your capacity" pattern ([ADR-044](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) |
| Codex | `gpt-5.6-sol` | `gpt-5.6-terra` | Quota errors (`rate_limit_exceeded`, `429`, `insufficient_quota`) ([ADR-028](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) |
| Claude | `opus` | `sonnet` | Claude Code native fallback when Opus is overloaded or unavailable |
| Ollama | `qwen3.6:27b` | none | Local, no fallback; a missing model returns a clear `ollama pull` error |

For Gemini, Codex, and Claude, fallback is automatic: your client sees the actual model and `usage.fellBack` in structured output. Ollama never falls back, so its `fellBack` is always `false`.

Codex uses `medium` reasoning effort for ordinary calls to preserve the previous default behavior. The quality-first `/codex-review` and `/brainstorm` skills use `high`. Direct `ask-codex` calls can override this with `reasoningEffort` (`low`, `medium`, `high`, `xhigh`, or `max`).

## Choosing a Provider

Different providers excel at different things. Pick by what you're doing, not by which is "best":

| Task | Suggested provider | Why |
|---|---|---|
| Targeted code reasoning, refactor critique | **Codex** | GPT-5.6 Sol is the flagship agentic coding model; Terra keeps the fallback balanced |
| Claude second opinion while working in Codex | **Claude** | Opus review through Claude Code CLI, with native session continuation and read-only file access |
| Private / air-gapped analysis | **Ollama** | Runs locally, nothing leaves your machine |
| Subscription-backed second opinion, larger context | **Antigravity** | `agy` via your Google AI Pro/Ultra plan, the Gemini CLI successor |
| Whole-codebase review (enterprise seats) | **Gemini** | 1M+ token context fits what others can't ([enterprise-gated from 2026-06-18](/providers/gemini)) |
| "What do they all think?" comparison | **Multi-LLM** (`multi-llm` tool or `/compare` skill) | Parallel dispatch, see all responses side-by-side |
| Code review with verified findings | **`/multi-review` skill** | Antigravity + Codex in parallel, then verifies each finding against source |

## Overriding the Model

Pass `model` explicitly when you have a reason to:

```text
Use ask-llm with provider gemini and model gemini-3.5-flash to quickly check this CSS file
```

Or programmatically:

```json
{ "name": "ask-llm", "arguments": { "provider": "gemini", "model": "gemini-3.5-flash", "prompt": "..." } }
```

For Codex, common overrides:

```text
Use ask-codex with model gpt-5.6-terra to summarize this commit
```

For Ollama, you can request any model you've pulled:

```bash
ollama pull deepseek-coder:6.7b
```

```text
Use ask-ollama with model deepseek-coder:6.7b to review this implementation
```

## Token Limits & Cost

| Provider | Context window | Cost model |
|---|---|---|
| Gemini Pro | ~1M tokens (~250k LOC) | Gemini Code Assist Standard/Enterprise seat (from 2026-06-18) |
| Gemini Flash | ~1M tokens | Cheaper than Pro; fallback target for quota relief |
| Codex GPT-5.6 Sol | Per OpenAI's published context window | Per OpenAI billing |
| Codex GPT-5.6 Terra | Per OpenAI's published context window | Balanced fallback target |
| Ollama | Per model (e.g., 256k for qwen3.6) | Free, runs locally |

## Track What You're Spending

Token usage is exposed live via:

- **Per-call**: `result.structuredContent.usage` on every `ask-*` tool response (provider, model, inputTokens, outputTokens, cachedTokens, thinkingTokens, durationMs, fellBack); see [ADR-054](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)
- **Per-session aggregate**: call the `get-usage-stats` MCP tool, or read the `usage://current-session` MCP Resource for a JSON snapshot
- **In the REPL**: type `/usage` for a markdown-formatted breakdown

This is in-memory only; no persistence to disk, resets when the MCP server restarts.

## Recommendations by Use Case

- **General code review** → defaults are correct; let the fallback chain handle quota
- **Whole-codebase analysis** → `ask-gemini` (Pro) if you have an enterprise seat, otherwise `ask-antigravity` for large-context reads without per-token billing
- **Quick fixes, fast iteration** → request Flash or `gpt-5.6-terra` explicitly to skip the flagship→fallback round-trip
- **Privacy-sensitive code** → `ask-ollama`, never leaves your machine
- **Multi-perspective debate** → `multi-llm` or `/brainstorm` skill; Claude weighs verified vs inferred
