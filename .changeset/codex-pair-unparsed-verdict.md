---
"@ask-llm/mcp": patch
---

codex-pair no longer records an unreadable reviewer reply as a clean review. A reply that matches neither the JSON verdict contract nor the legacy `NONE` / `[HIGH]`/`[MED]`/`[LOW]` format is now logged with verdict `unparsed`, surfaced once as `codex-pair UNPARSED`, kept out of the review cache, and counted towards the consecutive-failure auto-pause. Recognised replies are unchanged.
