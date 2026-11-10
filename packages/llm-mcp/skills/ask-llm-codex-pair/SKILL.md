---
name: ask-llm-codex-pair
description: "Codex pair review: set up, check or report per-edit review of your edits by Codex. Use for /codex-pair or when asked to pair with Codex."
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Use an independent read-only reviewer while the host remains the editor: Codex by default, or opt-in Claude on Grok CLI. Apply `pairing-contract.md`. Where the host supports the established per-edit integration, set up and report its status: the repository marker carries review context but is not, by itself, authorization on Pi. Preserve bounded file context, include-directory handling, reasoning effort, session continuity where supported, consent, cancellation, actionable relay, failure disclosure, and explicit host lifecycle limitations.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

- On Claude Code, read [claude-code.md](claude-code.md) for hook setup and status.
- On Grok CLI, read [grok.md](grok.md) for foreground per-edit review by Codex or opt-in Claude; this takes precedence over the other-host workflow.
- On Pi, read [pi.md](pi.md) for trusted, consent-gated asynchronous pairing.
- On Cursor Agent, read [cursor.md](cursor.md) for an on-demand iterative reviewer session.
- On Codex, Antigravity, Gemini CLI or OpenCode, follow the Other hosts adapter in [cursor.md](cursor.md).

For when to use this or `/codex-review`, hook behavior, configuration and cost, read [reference.md](reference.md).
