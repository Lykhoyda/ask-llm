---
"@ask-llm/mcp": minor
---

Add an explicit, bounded `doctor --format toon` v1 pilot with structured errors, filtered-versus-capped omission counts, a `completeness` flag, truncation disclosure, contextual help, and a `--full` escape hatch. Default text and `--json` output bytes, MCP, and machine contracts are unchanged; `--full` is accepted as a no-op for text/JSON, and unknown `doctor` arguments now exit 2 with a structured error instead of being ignored.
