# Provider Parity Matrix

The six providers deliberately do NOT behave identically — each difference below is either grounded in a provider's real constraints or is an accepted gap with the reasoning recorded. This doc exists so a difference is never mistaken for an oversight. Companion to ADR-128.

Factory defaults are literals (`FACTORY_DEFAULT_MODEL` in each package's `constants.ts`); the live default may differ via `ASK_<PROVIDER>_MODEL`.

| Dimension | Gemini | Codex | Claude | Grok | Ollama | Antigravity |
|---|---|---|---|---|---|---|
| Transport | `gemini` CLI spawn | `codex exec --json` spawn | `claude -p --output-format json` spawn; prompt over stdin | Explicit harness: native `fetch` to xAI `POST /v1/responses` (`store:false`, fixed origin; default) or Grok Build headless `grok -p --output-format json`; no harness fallback | HTTP `POST /api/chat` (native fetch) | `agy -p --output-format json` spawn after an `agy --version` gate (minimum 1.1.5); unified discovery excludes detected unsupported or unverifiable versions from dispatch; `--disable-slash-commands` added on agy >=1.1.9 |
| Factory default model | `gemini-3.1-pro-preview` | `gpt-5.6-sol` | `opus` alias | `grok-4.6` for xAI API; CLI IDs come exactly from `grok models` | `qwen3.6:27b` | `gemini-3.1-pro` + `--effort high` |
| Fallback | quota → `gemini-3.6-flash` | quota → `gpt-5.6-terra`, pinned-incompatible 400 → actionable message | Claude CLI native overload/unavailability fallback → `sonnet` | **none by design** — requested model is sent unchanged; every model/quota/safety failure is terminal and actionable | **none by design** — local means the user pulls what they intend to run; actionable `ollama pull` error | rate-limit → `gemini-3.5-flash`; a rejected model whose value equals the shipped default/fallback slug → one model-less retry, any other rejected value fails actionably |
| Reasoning effort | provider-managed | `medium` general default; `high` for review/brainstorm; per-call override | provider-managed | `low\|medium\|high\|xhigh`, default `high`; API uses `reasoning.effort`, CLI uses `--effort`; effort is not encoded into IDs | provider-managed | `--effort high` default; validated env override |
| Timeout default | 210s | **800s** | 600s | 600s; aborts the underlying HTTP request and body read | 600s | 300s |
| Timeout env var | `ASK_GEMINI_TIMEOUT_MS` | `ASK_CODEX_TIMEOUT_MS` | `ASK_CLAUDE_TIMEOUT_MS` | `ASK_GROK_TIMEOUT_MS` | `ASK_OLLAMA_TIMEOUT_MS` | `ASK_ANTIGRAVITY_TIMEOUT_MS` |
| Session mechanism | CLI `--resume <id>`; `[Session ID: ...]` | native threads; omitted is ephemeral, `""` persists first turn, non-empty resumes | native `session_id` via `--resume` | **single-turn only**; API sets `store:false`; CLI uses one headless turn and does not expose a session through AskResponse | sessions stored owner-only under `os.tmpdir()/ask-llm-sessions`, 24h | **single-turn only** |
| Empty-string `sessionId` | starts fresh + disables response cache | fresh persisted thread | starts fresh | n/a | starts fresh + disables response cache | n/a |
| includeDirs | edit tool only | fresh calls only | supported | n/a (API receives prompt bytes only) | n/a | supported |
| Edit mode | `ask-gemini-edit` | `ask-codex-edit` | none | none; structured JSON Schema is available to machine-mode callers, not a file-edit tool | none | none |
| Structured output | prompt/changeMode paths | native `--output-schema` | prompt-constrained | xAI Responses `text.format` strict JSON Schema plus local validation; CLI is prompt-constrained then validated locally; API structured calls bypass cache | prompt-constrained | prompt-constrained |
| Progress fidelity | real streaming assistant deltas | keep-alive only | keep-alive; final response once | keep-alive while one non-streaming HTTP response is pending; final 150-char tail | single 150-char tail on completion | keep-alive only |
| Read-only guarantee | CLI is read-only in `-p` mode | all public calls request read-only | hard Read/Glob/Grep tool boundary | API has no local file/tools; CLI uses `--sandbox read-only`, one turn, no subagents/memory/web search | local HTTP model has no file tools | soft prompt + sandbox only |
| Error-signal detection | quota, trust, tier-cutoff enrichment | quota/session/model lists | structured CLI errors + nested-host guard | HTTP status + bounded xAI error envelope: auth, model, quota/credits/rate, safety, malformed/incomplete, transport | model-not-found, server, timeout | rate-limit + model-unavailable sets |
| Credentials | Gemini CLI login/API config | Codex CLI login/API config | Claude Code login | API: `XAI_API_KEY`; CLI: cached `grok login` or `XAI_API_KEY`; secrets are redacted and never returned | none | agy login |
| Cost controls | provider account | provider account | provider account | API-key path is metered; CLI follows its authenticated plan. API output capped at 16,384 tokens by default; no priority tier, billing/spend changes, credit purchase, capacity request, overage, or fallback. Plain identical calls can cache; structured calls do not | local compute only | subscription quota |
| Concurrency | no provider lock | no provider lock | no provider lock | independent HTTP requests | independent HTTP requests | no lock — answers arrive on each process stdout |

Shared MCP behavior (identical everywhere, enforced by shared code + tests): 25s keep-alive progress, `askResponseSchema` structured output, 100KB prompt cap, cancellation propagation, and duplicate-tool-name fail-fast.

Known deliberate NON-alignments to leave alone unless a user asks:
- **Timeout spread (210s–800s)** encodes real model behavior differences, not inconsistency.
- **"Session ID" vs "Thread ID"** labels match each CLI's own vocabulary.
- **Ollama and Grok have no model fallback for different reasons:** Ollama must run the locally pulled model; Grok's API request is an explicit metered model choice. Neither silently substitutes.
- **Grok reasoning variants are request parameters, not invented model slugs.** Discover model IDs through `GET /v1/models`; send the chosen ID unchanged.
- **Harness and model are separate.** `ask-grok` selects `xai-api` or `grok-cli` explicitly; the unified `ask-cursor-agent` tool requires a provider plus an exact account catalog model ID and works for Grok, Claude, Codex, Gemini, or any other canonical provider.
- **Grok does not enable xAI storage or server-side tools.** `store:false` and no tools keep API consultations one-shot and cost-bounded. Grok CLI runs one read-only turn. Cursor Agent runs `--mode ask` without `--force` or automatic workspace trust.
- **Claude host suppression** is intentional because Claude Code rejects nested Claude Code sessions.
- **Codex review/brainstorm model:** GPT-5.6 Sol is the default and Terra is the quota fallback. `ASK_CODEX_PREFERRED_MODEL` remains a compatibility escape hatch.
