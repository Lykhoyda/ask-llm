---
"@ask-llm/plugin": patch
---

codex-pair now inserts reviewed file and context text into the review prompt literally, so `$` sequences such as `` $` `` no longer paste the prompt into the file and cause phantom "injected prompt" HIGH findings.
