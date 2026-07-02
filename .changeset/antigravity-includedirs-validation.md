---
"ask-antigravity-mcp": minor
---

`ask-antigravity`'s `includeDirs` now validates paths via the shared `relativeDirSchema` (relative only — no `..`, absolute, or `~` paths), matching `ask-codex`/`ask-codex-edit`/`ask-gemini-edit`. Previously arbitrary paths were forwarded to `agy --add-dir` unvalidated, which is especially risky because agy runs with `--dangerously-skip-permissions`. Found by a Codex review of the new provider-parity matrix.
