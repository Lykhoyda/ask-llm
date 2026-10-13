---
description: Research a plan with explicit reviewers and keep disagreements visible.
---

# Brainstorm

Ask for independent research followed by synthesis:

```text
Ask Codex and Grok to challenge our notification architecture. Separate evidence, assumptions, disagreements and recommended next steps.
```

The portable workflow is `ask-llm-brainstorm`; Claude Code retains `/brainstorm` and Pi uses `/skill:ask-llm-brainstorm`. The host follows its own adapter and should not claim Claude-only subagents or hooks on another host. Each participant consumes its own account quota; explicitly choose metered routes only when you intend that cost.

Send a topic to an explicit multi-model panel, ground it with independent Claude Opus research, then synthesize the findings. Provider, harness, requested catalog ID, independently observed served model (direct xAI API / Grok CLI only; a disclosed same-product alias/snapshot stays eligible), and Cursor's optional reported display label remain separate. Cursor Agent and Codex CLI echo the requested ID, so those attributions are selected-only and unverifiable rather than an actual model. The coordinator agent runs:

1. **Phase 3B: Claude Opus research.** Claude reads actual files, traces real code paths, fetches referenced docs, and forms findings tagged Verified or Inferred. In standard mode Claude is a participant. In the exact Grok + Sol mode it is a non-voting evidence verifier, so the requested panel remains exactly two models.
2. **Phase 3A: External dispatch.** A single foreground blocking Bash call sends the topic to each requested external provider in parallel and waits for all of them. Up to 10 minutes total (Bash tool max). It's a foreground blocking call, not a background-job dispatch, because sub-agents can't own processes that outlive their turn.
3. **Phase 4: Synthesis.** Combines Claude's findings with the external responses:

- Consensus points (where multiple participants agree; Claude verified + external = highest confidence)
- Unique insights (findings from only one participant)
- Contradictions (verified findings outrank inferred ones)
- Actionable recommendations (prioritized by impact and confidence)

```text
# Default external providers (Antigravity + Codex), plus Claude Opus always
/ask-llm-brainstorm Should we use a monorepo or polyrepo for this project?

# Custom external providers
/ask-llm-brainstorm gemini,codex,ollama Review this authentication approach

# Architect panel: exactly Grok + GPT-6 Sol via Cursor Agent; Gemini excluded
/ask-llm-brainstorm grok@cursor-agent:grok-4.7-high,codex@cursor-agent:gpt-6-sol-high "review this architecture"

# Explicit direct-Grok alternative; never pivots away from Grok Build
/ask-llm-brainstorm grok@grok-cli:grok-4.7,codex@cursor-agent:gpt-6-sol-high "review this architecture"
```

**Default external providers:** `antigravity,codex` (avoids unnecessary Ollama calls). Antigravity follows the [execution gate](/providers/antigravity). Compatible bare provider lists remain supported. For predictable routing use `provider@harness:exact-model-id`; the preferred Grok path is Cursor Agent. A list is either all bare names or all routed specs—mixing them (for example `grok@cursor-agent:grok-4.7-high,antigravity`) is refused before any provider is called, with no rerouting or substitution; generalized mixed panels are deferred to a future ADR. Exact IDs come from the selected harness catalog (`agent --list-models`, `grok models`, or xAI `/v1/models`) and are never translated between catalogs.

The architect panel invokes only the two listed Cursor participants: `provider: "grok"` with `model: "grok-4.7-high"`, and `provider: "codex"` with `model: "gpt-6-sol-high"`. It never calls Gemini or Cursor `Auto`. If registration, authentication, model availability, or route support fails for either participant, the result is **partial** and surviving insights are attributed only to the model that answered—never called two-model consensus. Claude's evidence can verify claims but cannot supply the missing vote.

The `grok-cli` form is supported only when the installed official Grok Build exposes Ask LLM's required headless JSON/read-only contract. A direct-route failure is terminal for that participant; there is no silent pivot among Cursor Agent, Grok CLI, or xAI API.

Agreement between models is not proof of correctness. Check the evidence behind the synthesis, and keep dissent and skipped participants in the final report.
