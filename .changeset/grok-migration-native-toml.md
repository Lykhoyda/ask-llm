---
"@ask-llm/mcp": patch
---

`ask-llm setup` now reads Grok Build entries in the form `grok mcp add` writes them: an `args` list split over several lines, so `npx -y @ask-llm/mcp` and split provider entries are replaced or retired automatically, and an `env` table from `grok mcp add -e`, which counts as custom settings, so such an entry gets guidance and a change made during confirmation is reported as a conflict instead of a failure. Host version probes and commands now run in their own process group, and the whole group is stopped only on timeout or interruption, so a host that relaunches itself, such as Gemini CLI, no longer leaves processes behind after a probe timeout.
