---
"@ask-llm/plugin": minor
---

codex-pair: a primary-model quota error followed by a **structurally-unavailable fallback model** now auto-pauses cleanly (kind `quota`, with the reset hint) instead of cascading to the 3-failure backstop. On ChatGPT-plan Codex accounts the `gpt-5.5-mini` fallback is rejected with a 400 ("not supported when using Codex with a ChatGPT account") — because plan quota is account-wide, a cheaper fallback never applied. The hook now recognizes the broken fallback ladder as the same "no usable model" exhaustion as the no-ladder case and re-throws the primary quota error so its reason + reset hint reach the pause notice. ADR-123.
