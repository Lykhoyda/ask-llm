---
name: ask-llm-gemini-review
description: Get a second opinion from Gemini on your current code changes. Analyzes staged/unstaged diffs and returns prioritized findings. Use when user asks to "review with Gemini", "Gemini code review", or "ask Gemini to check my code".
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Gather the relevant staged, unstaged, and untracked code changes; build a bounded context brief; request a Gemini review; verify each reported finding against source; and return only prioritized, source-supported findings. Preserve the canonical `gemini-3.1-pro-preview` → `gemini-3.8-flash` quota fallback, timeout, and explicit failure disclosure.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Call the native `ask-gemini` tool and apply the portable contract above.

### Other hosts adapter

Codex, Cursor Agent, Antigravity, Grok Build, Gemini CLI and OpenCode get this skill from their skills folder, not from a plugin. Apply the portable contract above inline with a Gemini call as described in `../ask-llm-review/transport.md` (`provider: "gemini"`).

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Gemini Code Review

Review current code changes by delegating to the `gemini-reviewer` agent.

## Instructions

1. Gather the diff to review:
   - Run `git diff` to get unstaged changes
   - Run `git diff --cached` to get staged changes
   - Combine both into a single diff

2. If the diff is empty, inform the user there are no changes to review.

3. Launch the `gemini-reviewer` agent with the diff content. The agent handles the Gemini prompt structure and output formatting.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
