---
"@ask-llm/mcp": patch
---

`/codex-pair` setup on Claude Code now copies a committed `.codex-pair.example/context.md` from the repository root to `.codex-pair/context.md` without asking, so a fresh worktree can activate pairing unattended. It never overwrites an existing marker. Setup keeps `.codex-pair/` out of git through the local exclude file that `git rev-parse --git-path info/exclude` names, which also works in linked worktrees, and no longer asks to edit `.gitignore`. Without a template, the interactive draft is unchanged. The bundled log CLI gains a `setup` subcommand for this step.
