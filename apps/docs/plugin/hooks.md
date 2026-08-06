---
description: The Claude Code hooks the Ask LLM plugin registers, how hook registration works, and the two hooks the plugin removed. The codex-pair continuous-review pipeline has its own dedicated page.
---

# Claude Code Hooks

This page is Claude Code-specific. Pi uses native extension lifecycle events instead of these scripts; see [Pi Host Support](/plugin/pi) for its `tool_result`, debounce, delivery, consent, and shutdown mapping.

Hooks are automated actions that trigger on specific Claude Code events. Every hook the Ask LLM plugin ships is part of the **codex-pair** continuous-review pipeline, so this page is the hook-mechanics reference; the feature itself, its setup, slash commands, cost, and Stop gate live on the dedicated [Codex Pair](/plugin/codex-pair) page.

> **Looking for codex-pair?** Setup, the `/codex-pair` slash commands, config knobs, cost characteristics, the opt-in Stop gate, and the "hook isn't firing" workaround all moved to [Codex Pair](/plugin/codex-pair). This page only covers what hooks the plugin registers and how registration works.

## Hooks the plugin registers

All five hooks are dependency-free with zero workspace imports, required so they run from marketplace `git-subdir` installs that don't run `npm install`. Only `codex-pair-watch` shells out to `codex exec --json` to run a review; the prompt-drain and Stop hooks only surface already-persisted verdicts (zero new LLM calls), and the session hook manages pause/debounce state (plus the optional broker). Each self-gates on the `.codex-pair/context.md` marker file and stays silent (zero cost, zero Codex calls) unless a project opts in.

| Hook | Event | Action |
|------|-------|--------|
| `codex-pair-watch` | `PostToolUse` (Edit / Write / MultiEdit) | Debounced per-edit Codex review of the settled file state. See [Codex Pair → the hook pipeline](/plugin/codex-pair#the-hook-pipeline) |
| `codex-pair-prompt-drain` | `UserPromptSubmit` | Drains queued codex-pair verdicts that finished mid-turn so they reach Claude without waiting for the next edit |
| `codex-pair-stop-gate` | `Stop` | Drains remaining verdicts at turn-end; with `blockOn: HIGH` (opt-in, default OFF) blocks turn-end on unaddressed HIGH findings or in-flight reviews |
| `codex-pair-session` | `SessionStart` | Announces a paused project or auto-resumes an expired auto-pause; starts the experimental `codex app-server` broker only with `ASK_CODEX_BROKER=1` |
| `codex-pair-session` | `SessionEnd` | Clears debounce state so orphaned workers self-cancel; tears down the broker when `ASK_CODEX_BROKER=1` |

## How hook registration works

The plugin ships `hooks/hooks.json`, which Claude Code reads on plugin install. Each entry maps an event (`PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`) to a `command` that invokes a script under `${CLAUDE_PLUGIN_ROOT}/scripts/`. The `PostToolUse` entry additionally carries a `matcher` (`Edit|Write|MultiEdit`) so it only fires for edit-shaped tool calls.

Because the scripts have zero workspace imports, they run identically from a source checkout and from a marketplace `git-subdir` install (which never runs `npm install`). If a Claude Code install doesn't auto-invoke the plugin-declared `PostToolUse` hook, a project-local `.claude/settings.local.json` workaround registers the script directly; see [Codex Pair → the project-settings workaround](/plugin/codex-pair#if-the-hook-isn-t-firing-automatically-the-project-settings-workaround-issue-74).

## Removed hooks

The plugin previously shipped two other hooks that have been removed:

- A `Stop` hook, removed because the `Stop` event fires per-turn rather than per-session, making it noisy and high-latency, and `git diff HEAD` excluded untracked files which silently dropped coverage on new-file sessions. (The current `codex-pair-stop-gate` is fundamentally different: it reads the already-computed `log.jsonl` with zero new LLM calls.)
- A `PreToolUse` pre-commit Gemini-review hook, removed because per-file codex-pair review delivers higher-recall feedback continuously *during* editing rather than only at commit time, and the on-demand `/gemini-review` skill covers the explicit-review need.

Use the `/gemini-review` slash command for explicit on-demand pre-commit reviews instead, or the `/codex-review` skill for a precision-first PR-style review.

## CLI Binaries (source builds only)

The package declares four CLI binaries for contributors who clone, build, and link the plugin locally. Marketplace installs use `git-subdir` and do not run the TypeScript build, so these `dist/*-run.js` binaries are **not available from a normal marketplace install**. Marketplace users should invoke the provider through its MCP tool instead.

```bash
# Pipe a diff to Gemini
git diff | ask-gemini-run "Review these changes for critical issues"

# Pipe to Codex
git diff --staged | ask-codex-run "Any bugs in these staged changes?"

# Pipe to local Ollama
cat src/auth.ts | ask-ollama-run "Review this auth implementation"

# Pipe to Antigravity (subscription-backed via agy)
git diff | ask-antigravity-run "Second opinion on these changes?"
```

All four binaries accept:
- **Positional argument:** The prompt
- **Stdin:** Piped content (code, diffs, files)
- **Combined:** `echo 'code' | ask-gemini-run "review this"`
