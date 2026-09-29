---
"@ask-llm/mcp": patch
---

The codex-pair Stop gate no longer blocks on files that the repository's `.gitignore` ignores inside untracked nested git repositories, and resolves each logged path only once.
