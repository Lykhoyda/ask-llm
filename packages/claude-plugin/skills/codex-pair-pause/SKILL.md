---
name: codex-pair-pause
description: Pause codex-pair for this project without removing `.codex-pair/context.md`. Writes the shared `.codex-pair/state/paused` sentinel. Use during noisy refactors, hook dogfooding, or other temporary review pauses.
---

<!-- PORTABLE-CONTRACT:START -->
## Host availability

This skill is Claude Code-only. Pi does not load or advertise codex-pair pause commands or pairing state. Use explicit review skills on Pi instead.
<!-- PORTABLE-CONTRACT:END -->

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The detailed workflow below applies only to Claude Code and preserves its existing hook and project-state mechanics.



# Pause codex-pair for this project

Pauses the codex-pair hook for the current project without removing the `.codex-pair/context.md` marker. The marker (and its project context) stays in place — only the temporary pause sentinel is written. Resume with `/codex-pair-resume`.

The hook may also pause itself automatically — on provider quota exhaustion or after
3 consecutive review failures — writing the same sentinel with a JSON body that
records why (`kind`, `reason`, `resetHint`). Manual and automatic pauses are resumed
the same way.

## When to use

- Starting a noisy refactor where every edit would surface concerns you've already decided to accept
- Working on docs/comments/typos where review adds no value
- Dogfooding the hook itself (avoid recursive self-reviews)
- Burning down a known-issues list where you don't want codex re-flagging them on every save

For permanent disable, remove the `.codex-pair/` directory instead (`rm -rf .codex-pair/`). For per-file/per-directory opt-out, use `.codex-pair/ignore` (gitignore-style globs).

## Instructions

1. Locate the `.codex-pair/context.md` marker by walking up from the current working directory (the project ROOT is the directory holding `.codex-pair/`). If no marker is found, inform the user: "codex-pair is not enabled in this project (no `.codex-pair/context.md` marker found). Nothing to pause."

2. Create the pause sentinel:
   ```bash
   mkdir -p <marker-dir>/.codex-pair/state
   touch <marker-dir>/.codex-pair/state/paused
   ```
   Replace `<marker-dir>` with the directory containing `.codex-pair/`.

3. Confirm to the user with the marker directory path:
   ```
   codex-pair paused for <marker-dir>
   Resume with /codex-pair-resume (or `rm <marker-dir>/.codex-pair/state/paused`)
   ```

4. If `.gitignore` in the marker directory does not already contain `.codex-pair/`, mention it as a suggestion (do not modify the user's .gitignore without asking).

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
