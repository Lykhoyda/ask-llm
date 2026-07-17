---
"@ask-llm/codex-mcp": patch
"@ask-llm/plugin": patch
---

Expose an explicit `sandbox` opt-in on the `ask-codex` tool. Every Codex run now
defaults to `--sandbox read-only` (ADR-136), which silently broke `/codex-image`
because Codex could no longer write the generated PNG to disk. `ask-codex` now
accepts an optional `sandbox` enum (`read-only` | `workspace-write`, default
`read-only`) that passes through to the executor as a deliberate opt-out of the
read-only review contract for flows that must have Codex write files. The
`/codex-image` skill now sets `sandbox: "workspace-write"`; review, second-opinion,
and analysis flows continue to run read-only.
