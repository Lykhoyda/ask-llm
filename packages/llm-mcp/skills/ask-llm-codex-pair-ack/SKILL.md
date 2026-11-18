---
name: ask-llm-codex-pair-ack
description: Acknowledge a codex-pair finding by its 16-character hash and a user-owned reason. Use when the user wants to suppress a repeated finding reminder or defer a host gate where supported.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Acknowledge one finding by its 16-character concern hash with a non-empty user reason. Acknowledgement suppresses that finding's reminder/gate; it does not disable future reviews or claim the concern was fixed.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Run `/codex-pair-ack <hash> <reason>`. On Pi this dismisses the matching reminder; there is no blocking Stop gate.

### Grok CLI adapter

Follow the acknowledgement procedure below using the installed `@ask-llm/mcp` package directory in place of `CLAUDE_PLUGIN_ROOT`. Copy the canonical file-scoped hash from `concernHashes.high[i]`, `concernHashes.med[i]` or `concernHashes.low[i]` alongside the matching `concerns` entry in `.codex-pair/log.jsonl` (live or cached). Do not hash the logged text: it may be truncated. See [Grok pairing](../ask-llm-codex-pair/grok.md). Pass the user-owned reason on stdin as shown below. Confirm that Grok will suppress the acknowledged concern in advisory output.

### Other hosts adapter

Per-edit codex-pair review runs in Claude Code, Pi and Grok CLI. On any other host, say there is no active codex-pair reminder to acknowledge here.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

1. Read the first argument as the 16-character lowercase hex hash. Use the remaining text as the user-owned reason, stripping enclosing quotes when present. If either argument is invalid, show `Usage: /codex-pair-ack <hash> "<reason>"` and stop.

2. Run the CLI from the project. Pass the reason on stdin via a single-quoted heredoc. Choose a delimiter that does not appear on a line by itself in the reason. Replace `<hash>` with the validated hash and `<reason>` with the user's text.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-pair-log.mjs" ack "<hash>" <<'CODEX_PAIR_ACK_REASON'
   <reason>
   CODEX_PAIR_ACK_REASON
   ```

   Done when the CLI confirms the acknowledgement. Show the hash and reason to the user and say the Stop gate will skip that finding. Surface the CLI error if it fails.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
