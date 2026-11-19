---
"@ask-llm/mcp": minor
---

Codex Pair now catches up on dirty and untracked files at activation, resume, and Claude Code turn end, including edits made from the shell. Each pass can review up to 10 files within two minutes and stops on a quota pause. Set `catchUpOnStop: false` in the marker to turn off the turn-end pass. Use `--report` to see which dirty files are pending, failed, or still awaiting a first attempt.
