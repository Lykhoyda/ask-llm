---
"ask-gemini-mcp": patch
---

Surface actionable, date-gated guidance when Gemini CLI's backend stops serving free/Pro/Ultra accounts (2026-06-18 cutoff, #140). On or after the cutoff, an auth/quota-class failure is classified and a hedged tier-discontinuation notice is prepended to the error (cutoff date, switch to ask-codex/ask-ollama, Antigravity `agy` is a separate path not yet supported). The Flash-fallback control flow is unchanged; the cutoff is overridable via `ASK_GEMINI_TIER_CUTOFF`.
