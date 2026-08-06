---
name: codex-pair-ack
description: Acknowledge a codex-pair finding by its 16-character hash and a user-owned reason. Use when the user wants to suppress a repeated finding reminder or defer a host gate where supported.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Acknowledge one finding by its 16-character concern hash with a non-empty user reason. Acknowledgement suppresses that finding's reminder/gate; it does not disable future reviews or claim the concern was fixed.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Run `/codex-pair-ack <hash> <reason>`. On Pi this dismisses the matching reminder; there is no blocking Stop gate.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Acknowledge a codex-pair HIGH finding

Records an ack for the given finding hash so the codex-pair Stop-gate skips it on future turn-ends. The gate prints a full 16-char hash in its block message, e.g. `[fc69d46835dfd2ab] src/auth.ts` — pass that hash verbatim.

## Instructions

1. **Parse args.** The first whitespace-delimited token is `<hash>` (16-char hex). The remaining text (strip enclosing quotes if present) is `<reason>`. If either is missing, print usage and stop:
   ```
   Usage: /codex-pair-ack <hash> "<reason>"
   Example: /codex-pair-ack fc69d46835dfd2ab "false positive — test-only code path"
   ```

2. **Locate the `.codex-pair/` directory.** Walk up from the current working directory looking for `.codex-pair/context.md`. The directory that contains `.codex-pair/` is `<markerDir>`. If no marker is found after reaching the filesystem root, tell the user:
   ```
   codex-pair is not enabled in this project (no .codex-pair/context.md found). Nothing to acknowledge.
   ```

3. **Validate the hash** before using it: it must match `^[0-9a-f]{16}$`. If it does not, print the usage block from step 1 and stop (a malformed hash means the user mistyped it).

4. **Record the ack** by running the Bash command below. Substitute real values for `<plugin-root>` (the absolute path of this plugin, i.e. the value of `CLAUDE_PLUGIN_ROOT`), `<markerDir>`, and `<hash>`. **Do NOT interpolate `<reason>` into the command string** — the reason is read from stdin via a single-quoted heredoc so the shell never expands `$(...)`, backticks, or quotes inside it (injection-safe). Replace the `<reason>` line with the user's reason text verbatim:
   ```bash
   node --input-type=module -e '
   import { addAck } from "<plugin-root>/scripts/lib/state.mjs";
   import { readFileSync } from "node:fs";
   // With `node -e CODE A B`, process.argv = [node, A, B] (no script-file
   // placeholder), so argv[1]=markerDir, argv[2]=hash.
   addAck(process.argv[1], process.argv[2], { reason: readFileSync(0, "utf8").trim() });
   ' "<markerDir>" "<hash>" <<'CODEX_PAIR_ACK_REASON'
   <reason>
   CODEX_PAIR_ACK_REASON
   ```
   `addAck` writes a concurrency-safe shard under `<markerDir>/.codex-pair/state/acks/` (creating the directory if needed). The hash is passed verbatim — no resolution is performed.

5. **Confirm** to the user:
   ```
   Acknowledged `<hash>` — <reason>. The Stop-gate will skip this finding.
   ```
   If the node one-liner exits non-zero, surface the error output so the user can diagnose it.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->

