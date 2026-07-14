---
name: sol-review
description: Review the current code changes specifically with OpenAI GPT-5.6 Sol. Use when the user asks for a Sol review, says "review with Sol", wants a model-pinned Codex review, or invokes /sol-review.
user_invocable: true
---

# Sol Code Review

Run a read-only, precision-first review explicitly pinned to GPT-5.6 Sol at high reasoning effort.

## Workflow

1. Run `git status --short`, `git diff`, and `git diff --cached`.
2. Include untracked files the user wants reviewed with `git add -N <path>` so their contents appear in the diff without staging them.
3. If the combined diff is empty, report that there are no changes to review.
4. Read the root and file-scoped `CLAUDE.md` files plus any ADRs cited by changed code.
5. Launch the `sol-reviewer` agent with the diff and a compact context brief containing the changed files, applicable conventions, referenced ADRs, and the user's requested review focus.
6. Return the agent's validated findings without adding unverified issues.

The reviewer must call `ask-codex` with `model: "gpt-5.6-sol"` and `reasoningEffort: "high"`. This explicit pin distinguishes `/sol-review` from `/codex-review`, which follows the configured Codex default. If Codex falls back to Terra on quota, disclose that the requested Sol review did not complete on Sol.
