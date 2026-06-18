---
"ask-antigravity-mcp": minor
"ask-llm-mcp": patch
"@ask-llm/plugin": patch
---

Default `ask-antigravity` to **Gemini 3.1 Pro (High)** — the strongest reasoning tier — and add a **Gemini 3.5 Flash (High)** rate-limit fallback.

Previously `ask-antigravity` defaulted to Gemini 3.5 Flash (High) with no fallback. It now leads with the Pro reasoning tier for the code-review / second-opinion workload and retries once on Flash when Pro hits a subscription rate limit (`RESOURCE_EXHAUSTED` / `429` / quota), mirroring the cross-tier quota fallback that `ask-gemini` and `ask-codex` already use. If the resolved model is already the fallback (or the caller pinned it via `ASK_ANTIGRAVITY_MODEL`), there is nothing to fall back to and the actionable rate-limit message is returned. Non-rate-limit failures (auth, not-installed, timeout) are surfaced as-is and never trigger a fallback. Override the default with the `ASK_ANTIGRAVITY_MODEL` env var (run `agy models` for options).
