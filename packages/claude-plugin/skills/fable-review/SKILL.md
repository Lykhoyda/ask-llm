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
5. Launch the `fable-reviewer` agent with the diff and a compact context brief containing the changed files, applicable conventions, referenced ADRs, and the user's requested review focus.
6. Return the agent's validated findings without adding unverified issues.

The `fable-reviewer` agent's `model: fable` frontmatter is the model pin. Do not substitute another reviewer or route this skill through an external MCP provider. If Fable is unavailable, surface that failure explicitly.
