---
"@ask-llm/mcp": patch
---

The Grok CLI harness now reports a read-only sandbox that cannot start (for example an unreachable Docker socket) as a harness environment failure naming the sandbox, instead of a safety refusal.
