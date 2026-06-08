---
name: brainstorm-all
description: Send a topic to ALL LLM providers (Gemini, Codex, Ollama, Antigravity) in parallel while Claude Opus performs its own independent research in parallel. Synthesizes findings from up to five participants. Shortcut for /brainstorm gemini,codex,ollama,antigravity <topic>. Requires Ollama running locally and agy installed for the Antigravity participant.
user_invocable: true
---

# Multi-LLM Brainstorm (All Providers)

Consult all available external LLM providers (Gemini, Codex, Ollama, Antigravity) simultaneously while Claude Opus performs its own independent research on the topic, then synthesize perspectives from all five participants.

## Instructions

1. Determine the brainstorm topic:
   - If the user provided a topic directly, use it
   - If the context is about code changes, gather the relevant diff with `git diff` and `git diff --cached`
   - If the context is a design/plan, gather the relevant documentation or conversation context

2. If no topic is clear, ask the user what they'd like to brainstorm about.

3. Launch the `brainstorm-coordinator` agent with the topic, external providers set to `gemini,codex,ollama,antigravity`, and any gathered context. The coordinator will:
   - Run its own Claude Opus research phase in parallel with the external dispatches (Phase 3B — reads actual files, traces code, uses WebFetch/WebSearch on referenced external docs)
   - Dispatch the topic to the four external providers in parallel (Phase 3A)
   - Synthesize all findings with Claude's verified findings weighted higher than inferred ones
