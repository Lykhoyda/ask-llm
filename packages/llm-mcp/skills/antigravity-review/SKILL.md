---
name: antigravity-review
description: Get a second opinion from Google Antigravity (agy) on your current code changes. Analyzes staged/unstaged diffs and returns prioritized findings. Use when the user asks to "review with Antigravity", "Antigravity code review", or "ask agy to check my code".
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Gather the relevant staged, unstaged, and untracked code changes; build a bounded context brief; request an Antigravity review; verify each reported finding against source; and return only prioritized, source-supported findings. Preserve read-only intent, provider authentication errors, timeout behavior, and explicit failure disclosure.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Call the native `ask-antigravity` tool and apply only the `Portable contract` section of `../../agents/antigravity-reviewer.md`; ignore that file's frontmatter and Claude Code adapter.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Antigravity Code Review

Review current code changes by delegating to the `antigravity-reviewer` agent — a subscription-backed second opinion via Google's Antigravity CLI (`agy`).

## Prerequisites

This skill is **experimental** and requires:

- `agy` installed and **logged in once** (run `agy` interactively to complete Google Sign-In).
- The Antigravity MCP server registered, e.g. `claude mcp add antigravity -- npx -y @ask-llm/antigravity-mcp`.

It is one-shot (no multi-turn) and **subscription-backed** — it uses your Google AI Pro/Ultra plan, not per-token API billing. For routine review on a paid OpenAI/Gemini setup, prefer [`codex-review`](../codex-review/SKILL.md) or [`gemini-review`](../gemini-review/SKILL.md). To compare several providers at once, use [`multi-review`](../multi-review/SKILL.md).

## Instructions

1. Gather the diff to review:
   - Run `git diff` to get unstaged changes
   - Run `git diff --cached` to get staged changes
   - Combine both into a single diff

2. If the diff is empty, inform the user there are no changes to review.

3. Launch the `antigravity-reviewer` agent with the diff content. The agent handles the Antigravity prompt structure, confidence filtering, and output formatting. If the `mcp__antigravity__ask-antigravity` tool is unavailable, the agent will tell the user to register the Antigravity MCP server rather than failing silently.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
