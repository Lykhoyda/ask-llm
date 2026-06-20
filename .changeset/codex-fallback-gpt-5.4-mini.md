---
"ask-codex-mcp": patch
"@ask-llm/plugin": patch
---

Fix the Codex quota-fallback model: default to `gpt-5.4-mini` instead of `gpt-5.5-mini`.

`gpt-5.5-mini` is rejected with a `400 "not supported when using Codex with a ChatGPT account"` on ChatGPT-plan accounts — the common case for the `codex` CLI, where plan quota is account-wide — so when `gpt-5.5` hit a usage limit the fallback retry failed (`…fallback also failed`) instead of producing a cheaper answer. `gpt-5.4-mini` is confirmed to work on both ChatGPT-plan and API-key accounts and is now the default `ASK_CODEX_FALLBACK_MODEL`. The `gpt-5.5` primary default is unchanged, and API-key users who prefer `gpt-5.5-mini` can still pin it via `ASK_CODEX_FALLBACK_MODEL`. The codex-pair plugin default is updated to match. See ADR-126 (closes #194).
