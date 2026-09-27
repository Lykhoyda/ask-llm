---
"@ask-llm/plugin": patch
---

The codex-pair Stop gate now blocks on HIGH findings in files inside untracked nested git repositories and no longer loses a file's current-content review when it was logged under two paths to the same file.
