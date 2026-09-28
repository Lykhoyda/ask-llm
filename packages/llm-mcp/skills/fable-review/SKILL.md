---
name: fable-review
description: Request a review of the current code changes from the Fable model. Use when the user asks for a Fable review, says "review with Fable", wants Fable's independent perspective on a diff, or invokes /fable-review.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Gather a bounded diff and context brief, run the independent Fable reviewer in a read-only isolated context, source-verify its findings, and disclose that the resolved runtime model cannot be independently inspected.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Unsupported and intentionally not loaded or advertised by the Pi manifest. Do not start a nested Pi/Fable session. Independent Fable review remains a Claude Code capability.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Fable Code Review

Request a read-only, precision-first review in an isolated Fable context.

## Workflow

1. Use Bash to read `CLAUDE_CODE_SUBAGENT_MODEL`. If it is set to anything other than `inherit`, `fable`, or a `claude-fable-*` model ID, abort before launching: this environment variable has higher precedence than the skill's model request.
2. Run `git status --short`, `git diff`, and `git diff --cached`.
3. Include untracked files the user wants reviewed with `git add -N <path>` so their contents appear in the diff without staging them.
4. If the combined diff is empty, report that there are no changes to review.
5. Read the root and file-scoped `CLAUDE.md` files plus any ADRs cited by changed code.
6. Launch the `fable-reviewer` agent with the per-invocation model set to `fable`, plus the diff and a compact context brief containing the changed files, applicable conventions, referenced ADRs, and the user's requested review focus.
7. If the Agent tool reports a fallback or model-availability error, abort instead of returning its findings as a Fable review.
8. Return the agent's validated findings without adding unverified issues. State that Fable was requested but the resolved model was not independently verified, because Claude Code does not expose the resolved subagent model to skills and an organization `availableModels` policy can silently fall back to the inherited model.

The `fable-reviewer` agent's `model: fable` frontmatter and the launch-time `model: "fable"` argument both request Fable. Do not substitute another reviewer or route this skill through an external MCP provider. Never claim the runtime-selected model was verified when Claude Code did not expose it.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
