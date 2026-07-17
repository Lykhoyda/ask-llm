---
"@ask-llm/plugin": patch
---

`/sol-review` no longer depends on agent improvisation when the `ask-codex` MCP tool is unavailable in the subagent context (#232). The skill preflights the transport, the `sol-reviewer` agent sanctions an exact CLI fallback (`codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" -s read-only --ignore-user-config --ignore-rules --skip-git-repo-check`) with plugin-namespaced tool variants recognized as primary transport, transport fallbacks must be disclosed like model fallbacks, and a missing CLI stops the review instead of degrading to another transport, model, or sandbox mode.
