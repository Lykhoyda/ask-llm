---
name: ask-llm-antigravity-review
description: Get a second opinion from Google Antigravity (agy) on your current code changes. Analyzes staged/unstaged diffs and returns prioritized findings. Use when the user asks to "review with Antigravity", "Antigravity code review", or "ask agy to check my code".
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Gather the relevant staged, unstaged, and untracked code changes; build a bounded context brief; request an Antigravity review; verify each reported finding against source; and return only prioritized, source-supported findings. Preserve read-only intent, provider authentication errors, timeout behavior, and explicit failure disclosure.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Call the native `ask-antigravity` tool and apply the portable contract above.

### Other hosts adapter

Codex, Cursor Agent, Antigravity, Grok Build, Gemini CLI and OpenCode get this skill from their skills folder, not from a plugin. Apply the portable contract above inline with an Antigravity call as described in `../ask-llm-review/transport.md` (`provider: "antigravity"`).

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Antigravity Code Review

Review current code changes with the `antigravity-reviewer` agent using Google's Antigravity CLI (`agy`).

## Prerequisites

This skill is **experimental** and requires:

- A supported `agy` version signed in to the intended Google account. Confirm the account's credit settings before the first Antigravity call.
- The Ask LLM server registered (`npm install -g @ask-llm/mcp`, then `ask-llm setup`), with `ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1` set for it.

The skill requests one review. Google does not support third-party headless use on consumer plans and describes third-party access as a terms violation. Review Google's position before choosing this route. [Ask LLM Antigravity guide](https://lykhoyda.github.io/ask-llm/providers/antigravity)

## Instructions

1. Gather the diff to review:
   - Run `git diff` to get unstaged changes
   - Run `git diff --cached` to get staged changes
   - Combine both into a single diff

2. If the diff is empty, inform the user there are no changes to review.

3. Launch the `antigravity-reviewer` agent with the diff content. The agent handles the review prompt, confidence filtering, and output formatting. The unified tool registered by `ask-llm setup` reaches Antigravity with `provider: "antigravity"`.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
