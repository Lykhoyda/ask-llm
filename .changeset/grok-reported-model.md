---
"@ask-llm/grok-mcp": patch
---

Expose the provider/CLI-reported model separately as `reportedModel` on `GrokExecutorResult` and `GrokCliExecutorResult` (also round-tripped through the xAI response cache), leaving `model` as the effective ID. Consumers can now tell an independently observed served model apart from an echoed requested ID when the xAI payload or Grok CLI envelope omits `model`.
