---
"@ask-llm/plugin": patch
---

codex-pair: the Stop drain, `blockOn: HIGH` gate, and UserPromptSubmit drain now cover every repository edited during the session — not just Claude Code's current working directory. In multi-repo sessions where an edit lands in a different repo than the cwd, that repo's queued verdicts now drain at turn-end and its unaddressed HIGH findings correctly block "done" (issue #209, ADR-131). A new session-scoped marker registry under the OS temp dir bridges the watch hook (which knows the edited repo) to the cwd-anchored Stop/prompt hooks. Behavior is unchanged for single-repo sessions and when the hook payload carries no `session_id`.
