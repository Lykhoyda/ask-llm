---
name: brainstorm-all
description: Send a topic to all external providers (Gemini, Codex, Grok, Ollama, Antigravity) concurrently after the current host model forms an independent view. Use when the user wants an all-provider brainstorm with synthesis and explicit unavailable-provider reporting.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Apply the brainstorm contract with all five external providers: Gemini, Codex, Grok, Ollama, and Antigravity. The current host model forms its independent view first; unavailable providers are reported, not silently omitted; synthesis distinguishes verified evidence from inference.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Follow `/skill:brainstorm` semantics with `ask-multi` providers `gemini,codex,grok,ollama,antigravity`, after the current Pi host model has committed its independent view.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Multi-LLM Brainstorm (All Providers)

Consult all available external LLM providers (Gemini, Codex, Grok, Ollama, Antigravity) simultaneously while Claude Opus performs its own independent research on the topic, then synthesize perspectives from all six participants.

## Instructions

1. Determine the brainstorm topic:
   - If the user provided a topic directly, use it
   - If the context is about code changes, gather the relevant diff with `git diff` and `git diff --cached`
   - If the context is a design/plan, gather the relevant documentation or conversation context

2. If no topic is clear, ask the user what they'd like to brainstorm about.

3. Launch the `brainstorm-coordinator` agent with the topic, external providers set to `gemini,codex,grok,ollama,antigravity`, and any gathered context. The coordinator will:
   - Run its own Claude Opus research phase in parallel with the external dispatches (Phase 3B — reads actual files, traces code, uses WebFetch/WebSearch on referenced external docs)
   - Dispatch the topic to the five external providers in parallel (Phase 3A)
   - Synthesize all findings with Claude's verified findings weighted higher than inferred ones

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
