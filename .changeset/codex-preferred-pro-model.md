---
"ask-codex-mcp": minor
"@ask-llm/plugin": minor
---

Codex `/codex-review` and `/brainstorm` now prefer `gpt-5.5-pro` when the Codex
account is entitled, falling back transparently to `gpt-5.5` (then `gpt-5.4-mini`
on quota). Those two commands opt in automatically; the raw `ask-codex` tool can
opt in with the new `preferred` arg. `ASK_CODEX_PREFERRED_MODEL` customizes which
model the preferred tier uses (default `gpt-5.5-pro`) — it does not by itself
enable preferred mode. `codex-pair`, `/multi-review`, and `/codex-verify` are
unchanged. (ADR-132)
