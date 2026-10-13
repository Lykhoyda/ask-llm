---
description: Claude-specific isolated reviewers, hooks and the optional Stop gate.
---

# Claude Code host notes

Follow [Install](/start/install), then start a new Claude Code session. Setup connects the server and installs the Claude Code workflows through the host's marketplace. This is an implementation detail of setup, not a separate onboarding step. Pairing remains off until you opt in.

Reviews, plan critique, comparisons and brainstorming use the same portable workflow contracts as other hosts. Claude Code can also launch isolated reviewers and run per-edit hooks. See [Review changes](/workflows/review-changes), [workflow names](/reference/skills), and the [host matrix](/compatibility/hosts).

## Connection details

The Claude Code plugin itself still ships only the Codex MCP registration used by review and pairing commands. Fully restart Claude Code after installation or upgrade, then run `/mcp`; `plugin:ask-llm:codex` should be connected and expose the exact `ask-codex` capability. Plugin agents and skills prefer that bundled `ask-codex` leaf, then a fully pinned unified `ask-llm` call (`provider: "codex"` plus model and Codex options), then the disclosed `codex exec` fallback.

## Hooks

This page is Claude Code-specific. Pi uses native extension lifecycle events instead of these scripts; see [Pi Host Support](/compatibility/pi) for its `tool_result`, debounce, delivery, consent, and shutdown mapping.

Hooks are automated actions that trigger on specific Claude Code events. Every hook the Ask LLM plugin ships is part of the **codex-pair** continuous-review pipeline, so this page is the hook-mechanics reference; the feature itself, its setup, slash commands, cost, and Stop gate live on the dedicated [Codex Pair](/advanced/codex-pair) page.

> **Looking for codex-pair?** Setup, the `/codex-pair` slash commands, config knobs, cost characteristics, the opt-in Stop gate, and the "hook isn't firing" workaround all moved to [Codex Pair](/advanced/codex-pair). This page only covers what hooks the plugin registers and how registration works.

### Hooks the plugin registers

All five hooks are dependency-free with zero workspace imports, required so they run from marketplace `git-subdir` installs that don't run `npm install`. The prompt-drain and Stop hooks only surface already-persisted verdicts (zero new LLM calls); the session hook manages pause, debounce, and broker state. Each self-gates on the `.codex-pair/context.md` marker file and stays silent (zero cost, zero Codex calls) unless a project opts in. Review transport and broker configuration are documented in [Codex Pair](/advanced/codex-pair).

| Hook | Event | Action |
|------|-------|--------|
| `codex-pair-watch` | `PostToolUse` (Edit / Write / MultiEdit) | Debounced per-edit Codex review of the settled file state. See [Codex Pair → the hook pipeline](/advanced/codex-pair#the-hook-pipeline) |
| `codex-pair-prompt-drain` | `UserPromptSubmit` | Drains queued codex-pair verdicts that finished mid-turn so they reach Claude without waiting for the next edit |
| `codex-pair-stop-gate` | `Stop` | Drains remaining verdicts at turn-end; with `blockOn: HIGH` (opt-in, default OFF) blocks turn-end on unaddressed HIGH findings or in-flight reviews |
| `codex-pair-session` | `SessionStart` | Announces or resumes an auto-paused project and manages the broker; see [Codex Pair](/advanced/codex-pair) |
| `codex-pair-session` | `SessionEnd` | Clears debounce state and manages broker teardown; see [Codex Pair](/advanced/codex-pair) |

### How hook registration works

The plugin ships `hooks/hooks.json`, which Claude Code reads on plugin install. Each entry maps an event (`PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `UserPromptSubmit`) to a `command` that invokes a script under `${CLAUDE_PLUGIN_ROOT}/scripts/`. The `PostToolUse` entry additionally carries a `matcher` (`Edit|Write|MultiEdit`) so it only fires for edit-shaped tool calls.

Because the scripts have zero workspace imports, they run identically from a source checkout and from a marketplace `git-subdir` install (which never runs `npm install`). If a Claude Code install doesn't auto-invoke the plugin-declared `PostToolUse` hook, a project-local `.claude/settings.local.json` workaround registers the script directly; see [Codex Pair → the project-settings workaround](/advanced/codex-pair#if-the-hook-isn-t-firing-automatically-the-project-settings-workaround-issue-74).

### Removed hooks

The plugin previously shipped two other hooks that have been removed:

- A `Stop` hook, removed because the `Stop` event fires per-turn rather than per-session, making it noisy and high-latency, and `git diff HEAD` excluded untracked files which silently dropped coverage on new-file sessions. (The current `codex-pair-stop-gate` is fundamentally different: it reads the already-computed `log.jsonl` with zero new LLM calls.)
- A `PreToolUse` pre-commit Gemini-review hook, removed because per-file codex-pair review delivers higher-recall feedback continuously *during* editing rather than only at commit time, and the on-demand `/gemini-review` skill covers the explicit-review need.

Use the `/gemini-review` slash command for explicit on-demand pre-commit reviews instead, or the `/codex-review` skill for a precision-first PR-style review.

## Agents

Agents are specialized sub-processes that Claude Code dispatches to handle complex tasks. Each agent runs in an isolated context window, preventing review noise from polluting your main conversation.

### Review Agents

#### `fable-reviewer`

This native reviewer analyzes the current diff directly in an isolated context pinned to `fable`. It has read-only tools, verifies every candidate against the source, and reports only findings at 80% confidence or higher.

Invoke it with `/fable-review`.

#### `sol-reviewer`

This reviewer uses an isolated Opus coordinator to request `gpt-6-sol` explicitly at high reasoning, then validates Sol's findings against the source. Invoke it with `/sol-review`. It prefers any exact `ask-codex` leaf (including the plugin-bundled Codex server), otherwise a fully pinned unified `ask-llm` call (`provider: "codex"` plus model and Codex options), otherwise the disclosed `codex exec` fallback. An older unified schema that cannot honor those options is reported rather than stripped. A quota fallback to Terra is disclosed instead of being presented as a Sol result.

Provider-backed review agents use a 3-phase workflow with confidence-based filtering:

**Phase 1: Context Gathering**
- Read the project's `CLAUDE.md` for conventions
- Analyze the git diff (staged + unstaged)
- Identify affected files and their purpose

**Phase 2: Provider Consultation**
- Construct a targeted prompt with the diff and conventions
- Call the respective provider (Codex, Grok, Antigravity, Ollama, or Gemini)
- Parse the structured response

**Phase 3: Synthesis**
- Filter findings by confidence score (80%+ threshold)
- Group as **Critical** (90%+) or **Important** (80-89%)
- Discard low-confidence noise

#### `codex-reviewer`

Sends code changes to OpenAI Codex (GPT-6 Astra) for review. Automatic fallback to GPT-5.6 Terra on quota limits.

#### `antigravity-reviewer`

Sends code changes to Google Antigravity (`agy`) for a subscription-backed review via your Google AI Pro/Ultra plan. Experimental; the Gemini CLI successor.

#### `grok-reviewer`

Sends code changes to Grok through the selected xAI API or official Grok CLI harness. Exact model and harness attribution are preserved; failures never route to another model/provider. API data transfer and pricing are explicit.

#### `ollama-reviewer`

Sends code changes to a local Ollama model. All processing stays on your machine; no data leaves your network.

#### `gemini-reviewer`

Sends code changes to Google Gemini for review. Leverages Gemini's massive context window for changes that span many files. ([Enterprise-gated from 2026-06-18](/providers/gemini).)

### Brainstorm Agent

#### `brainstorm-coordinator`

Orchestrates multi-LLM brainstorming sessions with **Claude Opus as a first-class research participant** in standard mode. In the exact Grok + GPT-6 Sol mode (see [`/brainstorm`](/reference/skills#brainstorm)) Claude's research is a non-voting evidence memo, the panel is exactly the two requested participants, and one participant failure makes the run partial rather than two-model consensus. The agent runs four phases sequentially within a single sub-agent turn:

**Phase 1: Context Gathering.** Identify the topic, gather diffs/files/conversation context referenced by it.

**Phase 2: Prompt Construction.** Build a structured prompt for the external providers (numbered points, pros/cons, deliverables).

**Phase 3B: Claude Opus Research (runs first).** Claude reads the actual artifacts referenced by the topic with `Read`/`Glob`/`Grep`, traces real code paths, uses `WebFetch`/`WebSearch` for any referenced external docs, and forms its own independent findings. Each finding is tagged **Verified** (backed by an actual file Read or fetched doc) or **Inferred** (reasoned from the topic description). This phase MUST complete before Phase 3A so Claude cannot anchor on external responses.

**Phase 3A: External Provider Dispatch (runs after 3B).** A SINGLE foreground blocking Bash call handles selected external providers via direct backgrounding (`cmd > out 2>&1 &`) plus per-PID `wait`, with `timeout: 600000` (10 min, the Bash tool maximum). The raw Antigravity participant follows the [execution gate](/providers/antigravity). The exact Grok + Sol panel instead runs one foreground `ask-brainstorm-run` process that owns both concurrent routed participants. Background jobs are explicitly forbidden because sub-agents cannot own processes that outlive their turn; Codex at high reasoning effort gets SIGKILLed silently otherwise. Per-provider stdout AND stderr are captured so failures are loud.

**Phase 4: Synthesis.** Combines Claude's Phase 3B findings with the external responses:
   - **Consensus**: Where multiple participants agree (verified Claude + external = highest confidence)
   - **Unique insights**: Findings from only one participant
   - **Contradictions**: Verified findings outrank inferred ones in tie-breaking
   - **Recommendations**: Prioritized by impact and confidence

The `Participants Consulted` section lists each participant by provider, harness, and requested model or discloses why it was skipped (Claude Opus has a `(verified against real files: ...)` annotation; in exact mode it is marked non-voting and Gemini is listed as explicitly excluded). This agent is invoked by the `/brainstorm` and `/brainstorm-all` skills.

### Running Agents Directly

You can also invoke agents directly from Claude Code:

```text
Use the codex-reviewer agent to review my current changes
```

Or in automated workflows via the Agent tool with `subagent_type`.
