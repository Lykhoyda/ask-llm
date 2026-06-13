---
"@ask-llm/plugin": minor
---

codex-pair now pauses itself when the provider is dead instead of erroring on every edit (#176). Quota exhaustion (both models) auto-pauses with a one-time notice including the parsed reset hint; 3 consecutive failures of any kind trigger the same backstop. Failure reasons now surface the real codex error (stdout JSONL error event) instead of the "Reading prompt from stdin..." stderr banner, and ChatGPT-plan quota phrasings ("You've hit your usage limit") are now classified for the existing model fallback. Resume stays manual: /codex-pair-resume.
