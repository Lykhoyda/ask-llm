---
"@ask-llm/plugin": minor
---

codex-pair seamless pairing (ADR-130): auto-pauses now self-heal — TTL expiry (quota 6h / failures 24h, `CODEX_PAIR_QUOTA_PAUSE_TTL_MS` / `CODEX_PAIR_FAILURES_PAUSE_TTL_MS`), immediate expiry when the plugin version changed since the pause, a SessionStart paused-reminder/auto-resume notice, and `/codex-pair-resume` clearing the failure counter. Every verdict is now emitted on the documented model-visible channel (PostToolUse `hookSpecificOutput.additionalContext`) alongside `systemMessage`. The Stop-gate drains queued debounce verdicts at turn-end for all projects and, with `blockOn: HIGH`, blocks once per turn while reviews are still in flight (settling debounce windows, running codex calls, and the new worker `reviewing` handoff marker).
