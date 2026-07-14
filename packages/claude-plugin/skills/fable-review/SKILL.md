---
name: fable-review
description: Review the current code changes directly with the Fable model. Use when the user asks for a Fable review, says "review with Fable", wants Fable's independent perspective on a diff, or invokes /fable-review.
user_invocable: true
---

# Fable Code Review

Run a read-only, precision-first review in an isolated Fable context.

## Workflow

1. Run `git status --short`, `git diff`, and `git diff --cached`.
2. Include untracked files the user wants reviewed with `git add -N <path>` so their contents appear in the diff without staging them.
3. If the combined diff is empty, report that there are no changes to review.
4. Read the root and file-scoped `CLAUDE.md` files plus any ADRs cited by changed code.
5. Launch the `fable-reviewer` agent with the per-invocation model set to `fable`, plus the diff and a compact context brief containing the changed files, applicable conventions, referenced ADRs, and the user's requested review focus.
6. Inspect the Agent tool result metadata before accepting the review. Its `resolvedModel` must start with `claude-fable-`. If the field is absent or names any other model, abort and report that Fable is unavailable or overridden; do not return that agent's findings as a Fable review.
7. Return the agent's validated findings without adding unverified issues.

The `fable-reviewer` agent's `model: fable` frontmatter and the launch-time `model: "fable"` argument request Fable, while the `resolvedModel` check verifies the model Claude Code actually selected. Do not substitute another reviewer or route this skill through an external MCP provider. If Fable is unavailable, surface that failure explicitly.
