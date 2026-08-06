---
name: codex-pair-resume
description: Resume codex-pair for this project after a previous pause. Removes `.codex-pair/state/paused` and clears failure state. Review resumes on the next supported file edit; missing state is a no-op.
---

<!-- PORTABLE-CONTRACT:START -->
## Host availability

This skill is Claude Code-only. Pi does not load or advertise codex-pair resume commands or pairing state. Use explicit review skills on Pi instead.
<!-- PORTABLE-CONTRACT:END -->

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The detailed workflow below applies only to Claude Code and preserves its existing hook and project-state mechanics.



# Resume codex-pair for this project

Removes the pause sentinel written by `/codex-pair-pause`, restoring normal codex-pair review behavior. The `.codex-pair/context.md` marker and `.codex-pair/state/` directory are left in place (the directory holds the cache, inflight locks, and any other future state per [ADR-092](../../../../docs/DECISIONS.md)).

## Instructions

1. Locate the `.codex-pair/context.md` marker by walking up from the current working directory (the project ROOT is the directory holding `.codex-pair/`). If no marker is found, inform the user: "codex-pair is not enabled in this project (no `.codex-pair/context.md` marker found). Nothing to resume."

2. Check whether the pause sentinel exists at `<marker-dir>/.codex-pair/state/paused`:
   - If it does not exist, tell the user: "codex-pair was not paused — no `.codex-pair/state/paused` sentinel found. No change."
   - If it exists and is non-empty, it is an auto-pause written by the hook itself
     (quota exhaustion or repeated failures — see #176). `cat` it and show the user
     the `kind`, `reason`, and `resetHint` fields before removing, so they know
     whether the provider has likely recovered.
   - Remove it, together with the consecutive-failure counter — resuming while
     the counter is still at threshold would re-pause on the very next single
     failure. Quote the paths so marker directories with spaces work:
     ```bash
     rm -f -- "<marker-dir>/.codex-pair/state/paused" "<marker-dir>/.codex-pair/state/failures.json"
     ```

3. Confirm to the user with the marker directory path:
   ```
   codex-pair resumed for <marker-dir>
   The next Edit/Write/MultiEdit will trigger a review.
   ```

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
