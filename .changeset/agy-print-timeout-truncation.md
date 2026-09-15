---
"@ask-llm/antigravity-mcp": patch
---

Fail closed when agy ≥1.1.28 hits `--print-timeout` and returns a truncated exit-0 answer, instead of serving the partial as complete. Capture stderr via the existing success-path hook; keep older agy on the non-zero timeout contract.
