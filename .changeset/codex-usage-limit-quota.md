---
"@ask-llm/shared": patch
"ask-codex-mcp": patch
---

Fix Codex quota fallback for CLI 0.137+ ("You've hit your usage limit").

Codex 0.137 reports plan exhaustion as `{"type":"error","message":"You've hit your usage limit"}` on **stdout JSONL** while exiting non-zero, with only a benign `Reading additional input from stdin...` notice on stderr. Two gaps meant the gpt-5.5 → gpt-5.5-mini fallback silently never fired:

- `executeCommand` discarded stdout on a non-zero exit, so the quota text never reached `isQuotaError()`. It now unions stderr+stdout into the rejected error (stdout-borne errors from any provider are now visible), and `sanitizeErrorForLLM` passes the `usage limit` phrasing through untruncated.
- The Codex executor's `QUOTA_SIGNALS` now includes `usage limit`, so the error is classified as quota and the fallback model is used.
