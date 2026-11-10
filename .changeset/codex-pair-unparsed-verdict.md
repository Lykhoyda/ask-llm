---
"@ask-llm/mcp": patch
---

The shared codex-pair review hook scripts (used by Claude Code and Grok CLI) no longer record an unreadable reviewer reply as a clean review. A reply that matches neither the JSON verdict contract nor the legacy `NONE` / `[HIGH]`/`[MED]`/`[LOW]` format is now logged with verdict `unparsed`, surfaced once as `codex-pair UNPARSED`, kept out of the review cache, and counted towards the consecutive-failure auto-pause. Recognised replies are unchanged. The Pi codex-pair extension is unchanged by this release.
