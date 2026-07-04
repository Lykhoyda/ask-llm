---
"@ask-llm/plugin": patch
---

`/compare` now includes **Antigravity** in its default provider set, matching `/brainstorm-all` and `/multi-review`. The skill dispatches to gemini, codex, ollama, and antigravity in parallel (ADR-050 backgrounding + per-PID wait) and renders a fourth `### Antigravity` section side-by-side. Previously `/compare` silently excluded Antigravity even though it is a first-class provider (ADR-125/128). A user can still request a subset (e.g. "compare gemini and codex"). A load-bearing contract test now pins the `antigravity-run.js` dispatch leg so it cannot regress.
