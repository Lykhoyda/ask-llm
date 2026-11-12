---
"@ask-llm/mcp": patch
---

End portable `/codex-pair` without questions or review calls when the writer is positively identified as Codex and the reviewer would also be Codex. Explain the lack of independent review, point to `/grok-pair`, and report `completed (not applicable)`. Unknown writer families and existing adapters retain their behavior; Pi's native command is unchanged.
