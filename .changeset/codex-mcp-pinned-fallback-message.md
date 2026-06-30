---
"ask-codex-mcp": patch
---

Surface an actionable error when a pinned `ASK_CODEX_FALLBACK_MODEL` is structurally unavailable for your Codex account type.

Previously, if the primary model hit a quota error and a pinned fallback (e.g. `ASK_CODEX_FALLBACK_MODEL=gpt-5.5-mini` on a ChatGPT-plan account) was rejected with `400 "not supported when using Codex with a ChatGPT account"`, the MCP executor surfaced a generic `…fallback also failed: <400>. Run \`codex doctor\`` message — and `codex doctor` cannot diagnose an account-type model restriction. The executor now detects this case (porting `isModelUnavailableError` from the codex-pair hook, ADR-123) and throws a message that names the model, explains it isn't available for your account type, and points at `ASK_CODEX_FALLBACK_MODEL` (the default `gpt-5.4-mini` works on both ChatGPT-plan and API-key accounts). The default fallback already works everywhere (ADR-126), so this only affects users who deliberately pin an incompatible model. See ADR-127 (closes #196).
