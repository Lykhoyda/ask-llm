---
description: Isolated sub-agents for AI code review and multi-LLM brainstorming. Confidence-based filtering (80%+ threshold) across Codex, Antigravity, Ollama, and Gemini.
---

# Agents

Agents are specialized sub-processes that Claude Code dispatches to handle complex tasks. Each agent runs in an isolated context window, preventing review noise from polluting your main conversation.

## Review Agents

All review agents use a 3-phase workflow with confidence-based filtering:

**Phase 1: Context Gathering**
- Read the project's `CLAUDE.md` for conventions
- Analyze the git diff (staged + unstaged)
- Identify affected files and their purpose

**Phase 2: Provider Consultation**
- Construct a targeted prompt with the diff and conventions
- Call the respective provider (Codex, Antigravity, Ollama, or Gemini)
- Parse the structured response

**Phase 3: Synthesis**
- Filter findings by confidence score (80%+ threshold)
- Group as **Critical** (90%+) or **Important** (80-89%)
- Discard low-confidence noise

### `codex-reviewer`

Sends code changes to OpenAI Codex (GPT-5.5) for review. Automatic fallback to GPT-5.5-mini on quota limits.

### `antigravity-reviewer`

Sends code changes to Google Antigravity (`agy`) for a subscription-backed review via your Google AI Pro/Ultra plan. Experimental; the Gemini CLI successor.

### `ollama-reviewer`

Sends code changes to a local Ollama model. All processing stays on your machine — no data leaves your network.

### `gemini-reviewer`

Sends code changes to Google Gemini for review. Leverages Gemini's massive context window for changes that span many files. ([Enterprise-gated from 2026-06-18](/providers/gemini).)

## Brainstorm Agent

### `brainstorm-coordinator`

Orchestrates multi-LLM brainstorming sessions with **Claude Opus as a first-class research participant**, not just an orchestrator. The agent runs four phases sequentially within a single sub-agent turn:

**Phase 1 — Context Gathering.** Identify the topic, gather diffs/files/conversation context referenced by it.

**Phase 2 — Prompt Construction.** Build a structured prompt for the external providers (numbered points, pros/cons, deliverables).

**Phase 3B — Claude Opus Research (runs first).** Claude reads the actual artifacts referenced by the topic with `Read`/`Glob`/`Grep`, traces real code paths, uses `WebFetch`/`WebSearch` for any referenced external docs, and forms its own independent findings. Each finding is tagged **Verified** (backed by an actual file Read or fetched doc) or **Inferred** (reasoned from the topic description). This phase MUST complete before Phase 3A so Claude cannot anchor on external responses — see [ADR-049](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md).

**Phase 3A — External Provider Dispatch (runs after 3B).** A SINGLE foreground blocking Bash call dispatches all selected external providers in parallel via direct backgrounding (`cmd > out 2>&1 &`) plus per-PID `wait`, with `timeout: 600000` (10 min — the Bash tool maximum). Background jobs are explicitly forbidden because sub-agents cannot own processes that outlive their turn — Codex at high reasoning effort gets SIGKILLed silently otherwise. Per-provider stdout AND stderr are captured so failures are loud. See [ADR-050](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md).

**Phase 4 — Synthesis.** Combines Claude's Phase 3B findings with the external responses:
   - **Consensus** — Where multiple participants agree (verified Claude + external = highest confidence)
   - **Unique insights** — Findings from only one participant
   - **Contradictions** — Verified findings outrank inferred ones in tie-breaking
   - **Recommendations** — Prioritized by impact and confidence

The `Participants Consulted` section lists Claude Opus alongside Gemini/Codex/Ollama with a `(verified against real files: ...)` annotation for grounded findings. This agent is invoked by the `/brainstorm` and `/brainstorm-all` skills.

## Running Agents Directly

You can also invoke agents directly from Claude Code:

```text
Use the gemini-reviewer agent to review my current changes
```

Or in automated workflows via the Agent tool with `subagent_type`.
