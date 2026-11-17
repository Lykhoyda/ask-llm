---
"@ask-llm/mcp": minor
"@ask-llm/antigravity-mcp": minor
---

Pass a session-only agy settings overlay on every Antigravity call: agy stays in Default mode and refuses file writes and commands, and the user's agy `settings.json` is never changed. This covers the review tool, the unified and multi-provider paths, retries, `doctor --live`, the `/quota` probe, and the `/brainstorm` participant. Antigravity now requires agy 1.5.9 or newer, the oldest version verified to enforce the overlay; older agy is refused with an update message. `--mode plan` is no longer passed because agy ignores it. Only users who set `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1` were affected; that opt-in and its warning are unchanged.
