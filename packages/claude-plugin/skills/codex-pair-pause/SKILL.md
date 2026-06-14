---
name: codex-pair-pause
description: Pause the codex-pair PostToolUse hook for this project without removing the .codex-pair/context.md marker. Writes a .codex-pair/state/paused sentinel that the hook checks on every Edit/Write/MultiEdit. Use when you want to temporarily silence reviews — running a noisy refactor, dogfooding the hook itself, working on docs-only changes, etc. — and resume later with /codex-pair-resume.
user_invocable: true
---

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
