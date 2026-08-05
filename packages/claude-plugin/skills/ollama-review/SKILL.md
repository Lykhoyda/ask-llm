---
name: ollama-review
description: Get a second opinion from a local Ollama LLM on your current code changes. Analyzes staged/unstaged diffs and returns prioritized findings. No API keys needed. Use when user asks to "review with Ollama", "local code review", or "review offline".
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Gather the relevant staged, unstaged, and untracked code changes; build a bounded context brief; request a local Ollama review; verify each reported finding against source; and return only prioritized, source-supported findings. Never imply external data transfer and surface unavailable local models actionably.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Call the native `ask-ollama` tool and apply only the `Portable contract` section of `../../agents/ollama-reviewer.md`; ignore that file's frontmatter and Claude Code adapter.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Ollama Code Review

Review current code changes by delegating to the `ollama-reviewer` agent.

## Instructions

1. Gather the diff to review:
   - Run `git diff` to get unstaged changes
   - Run `git diff --cached` to get staged changes
   - Combine both into a single diff

2. If the diff is empty, inform the user there are no changes to review.

3. Launch the `ollama-reviewer` agent with the diff content. The agent handles the Ollama prompt structure and output formatting.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
