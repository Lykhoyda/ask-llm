---
name: codex-review
description: Get a second opinion from OpenAI Codex on your current code changes. Analyzes staged/unstaged diffs and returns prioritized findings. Use when user asks to "review with Codex", "Codex code review", or "ask Codex to check my code".
user_invocable: true
---

# Codex Code Review

Review current code changes by delegating to the `codex-reviewer` agent.

## When to use this vs codex-pair

This skill is **precision-first**: confidence ≥ 80, "don't flag style/linter-catchable" filter. Optimized for low false-alarm rate on diff review — appropriate default for routine PRs.

For **recall-first** review on hot-path code (money handling, security paths, spec-implementing code), see the [`codex-pair`](../codex-pair/SKILL.md) sibling — a PostToolUse hook that opts in per-project via a `.codex-pair/context.md` marker file. The 4-task benchmark in ADR-077 shows codex-pair catches domain-level "wrong but won't crash" issues (float-money precision, cross-cutting validation gaps, edge clamping) that this skill's confidence filter structurally suppresses. Different classes of bug, not the same class with different completeness.

| Use this skill | Use codex-pair |
|---|---|
| Routine PR review (cheap, high precision) | Money/billing/security/spec code (deeper, costlier) |
| You want one comprehensive report | You want every concern flagged with severity |
| Cost-sensitive (~$0.04/PR) | Acceptable cost (~$0.20/edit pass) |

## Instructions

1. Gather the diff to review:
   - Run `git diff` to get unstaged changes
   - Run `git diff --cached` to get staged changes
   - Combine both into a single diff

2. If the diff is empty, inform the user there are no changes to review.

3. Launch the `codex-reviewer` agent with the diff content. The agent handles the Codex prompt structure and output formatting, using GPT-5.6 Sol at `high` reasoning effort with automatic Terra fallback.
