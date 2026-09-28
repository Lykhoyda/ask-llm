---
name: grok-review
description: Get an independent Grok code review through the xAI API. Use when the user asks to review with Grok or wants a Grok second opinion. Requires XAI_API_KEY and explicit acceptance of metered xAI API pricing.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Gather the relevant staged, unstaged, and untracked changes; build a bounded context brief; request an independent Grok review; verify every reported finding against source; and return only prioritized, source-supported findings. State that project context is sent to xAI and may incur API charges. Never enable billing, buy credits, use priority processing, substitute models, or retry on another model.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Call the native `ask-grok` tool and apply only the `Portable contract` section of `../../agents/grok-reviewer.md`; ignore that file's frontmatter and Claude Code adapter.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

Review current code changes by delegating to the `grok-reviewer` agent.

1. Confirm the user configured `XAI_API_KEY` and understands xAI API usage is metered separately from any Grok consumer subscription. Do not configure billing or credits.
2. Gather `git diff`, `git diff --cached`, and relevant untracked files. If there are no changes, say so.
3. Launch the `grok-reviewer` agent with a bounded diff and relevant project instructions.
4. If the Grok MCP tool is unavailable, explain how to register it without attempting another provider. For API use:
   `claude mcp add --scope user grok -e XAI_API_KEY="$XAI_API_KEY" -- npx -y @ask-llm/grok-mcp`
   For official Grok Build, install/authenticate `grok`, set `ASK_GROK_HARNESS=grok-cli` in the MCP environment, and register the same package without silently switching from API.
5. Preserve provider/model/harness attribution and any xAI error verbatim after secret redaction. Never silently route to Codex, Gemini, or another model.
<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
