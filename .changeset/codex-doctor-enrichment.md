---
"@ask-llm/shared": minor
"ask-codex-mcp": minor
"ask-llm-mcp": minor
"ask-gemini-mcp": patch
"ask-ollama-mcp": patch
"ask-antigravity-mcp": patch
---

`ask-llm doctor` now folds a compact `codex doctor` health summary into the Codex provider section (#183). When codex is available, the doctor capability-probes `codex doctor --json` and, on success, shows codex's overall status plus any non-ok checks with remediation (the full mapped check list rides along in `--json`). It degrades silently when codex is absent, too old to support `--json`, or errors — default output is unchanged, and codex health never affects the doctor exit code. Implemented via a generic `enrich` hook on the provider spec so `@ask-llm/shared` stays provider-agnostic; codex-specific parsing lives in `ask-codex-mcp`. (gemini/ollama/antigravity bump = rebuild only: they embed the updated shared `doctor.ts`, ADR-119.)
