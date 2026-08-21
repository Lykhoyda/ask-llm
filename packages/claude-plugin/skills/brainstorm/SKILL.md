---
name: brainstorm
description: Send a topic to an explicit multi-model panel, then synthesize findings with truthful provider, harness, and model attribution. Usage /brainstorm [participants] <topic>. Defaults to antigravity,codex. Preferred Grok route uses Cursor Agent with an exact catalog ID.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

For the standard workflow, the current host model records an independent analysis before seeing external answers, then sends the same bounded topic and Context Brief concurrently to the selected providers. For the exact Grok + GPT-5.6 Sol workflow, the host is a non-voting evidence verifier/synthesizer: the brainstorming panel has exactly those two requested participants. Cross-check source where possible and synthesize consensus, unique insights, contradictions, rejected false positives, failures, and confidence. Keep provider, harness, requested model ID, independently observed served model ID, and Cursor's reported display label separate. Only direct xAI API / Grok CLI routes can report a served ID, and only when the provider/CLI payload actually carries one; a disclosed same-product alias/snapshot resolution (for example `grok-4.6` or `grok-4-latest` served as a dated `grok-4-<snapshot>`) stays eligible, while a different model is a mismatch and ineligible. A direct route whose payload omits the model stays selected-only. Cursor Agent and Codex CLI echo the requested ID, so that attribution is selected-only and unverifiable—never call a requested or selected ID the actual model. Never select Cursor Auto, infer a requested ID from a display label, silently change a model, or pivot to another harness/provider.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

The current Pi host model completes its independent evidence memo first. Standard provider lists use native `ask-multi`. A routed participant uses the matching native tool instead: `provider@cursor-agent:model` calls `ask-cursor-agent` with separate `provider` and exact `model`; direct Grok calls `ask-grok` with the explicit `harness` and exact model. For the exact Grok + Sol panel, issue only these two consultations (concurrently when the host supports it):

- `ask-cursor-agent({ provider: "grok", model: "cursor-grok-4.6-high", prompt })`
- `ask-cursor-agent({ provider: "codex", model: "gpt-5.6-sol-high", prompt })`

Do not call `ask-multi` for that panel because it cannot express Cursor harness identity, and do not call Gemini. Treat the host memo as non-voting verification evidence, not a third panel answer. If either participant fails, label the run partial and do not claim two-model consensus.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.

# Multi-LLM Brainstorm

Consult an explicitly selected panel on a topic, then synthesize the responses against source-grounded host research.

## Instructions

### Phase 1: Parse arguments and freeze participant identity

- The first argument may be a comma-separated participant list.
- Compatible bare provider names remain supported: `gemini`, `codex`, `grok`, `ollama`, `antigravity`. If omitted, default to `antigravity,codex`.
- Bare `grok` retains the existing direct canonical runner and its explicit `ASK_GROK_HARNESS` selection (`xai-api` default or `grok-cli`) for compatibility. That direct route never falls back.
- Preferred explicit syntax is `provider@harness:exact-model-id`. Supported routed participants are:
  - `grok@cursor-agent:<exact ID from agent --list-models>` (preferred Grok route)
  - `codex@cursor-agent:<exact GPT-5.6 Sol ID from agent --list-models>`
  - `grok@grok-cli:<exact ID from grok models>` (explicit Grok Build alternative)
  - `grok@xai-api:<exact ID from GET /v1/models>`
  - `codex@codex-cli:gpt-5.6-sol` (explicit direct Codex alternative; any reported fallback makes the exact panel partial)
- Never accept `Auto`, map a display label to an ID, or substitute a route. A missing registration/harness, unavailable model, auth failure, or unsupported provider/harness pair is a participant failure with its actionable error preserved.
- Everything after the participant list is the topic.
- In standard mode, Claude Opus remains a participant. In the exact Grok + Sol mode below, Claude is only the non-voting evidence verifier/synthesizer so the panel has exactly two participants.

**Architect workflow — exactly Grok + GPT-5.6 Sol, no Gemini:**

```text
/brainstorm grok@cursor-agent:cursor-grok-4.6-high,codex@cursor-agent:gpt-5.6-sol-high "review this architecture"
```

These IDs are exact catalog examples verified for this workflow; account catalogs can change, so use `agent --list-models` and replace an unavailable ID explicitly. The coordinator must not call Gemini, the direct Grok runner, xAI API, Grok Build, or Codex CLI for this invocation.

**Explicit Grok Build alternative (still no Gemini):**

```text
/brainstorm grok@grok-cli:grok-build,codex@cursor-agent:gpt-5.6-sol-high "review this architecture"
```

This route is valid only when the installed Grok Build contract supports Ask LLM's headless JSON/read-only flags. Failure is terminal for the Grok participant; do not pivot to Cursor or xAI.

### Phase 2: Determine and prepare the brainstorm topic

- If the user provided a topic directly, use it.
- For code changes, gather relevant context:
  - Run `git status --short` first.
  - Use `git add -N <new-files>` for untracked files the user wants included.
  - Combine `git diff` and `git diff --cached`.
  - Exclude noise with `:!docs/` `:!apps/docs/` `:!*.md` `:!yarn.lock` `:!*.lock` `:!*.png`.
  - If the combined diff exceeds 150KB, ask before sending.
- For a design/plan, gather relevant documentation and conversation context.
- If no topic is clear, ask what to brainstorm.
- Create a compact **Context Brief**. It must list the exact requested participant identities, not just display names:

```markdown
## Context Brief

Intent:
- User request:
- Brainstorm mode: <standard | exact-grok-sol>
- Participants: <provider via harness, exact requested model for each>
- Explicitly excluded: <for exact-grok-sol: Gemini and every unselected route>

Scope:
- Changed/referenced files:
- Included files/docs:
- Excluded files/docs and reason:
- Diff bytes:

Repository signals:
- Relevant package/workspace:
- CLAUDE.md files read:
- ADRs/docs read:

Risk focus:
- Security:
- Data loss:
- Concurrency/state:
- API/contract:
- Tests/build:

Open questions:
- Items not verified before dispatch:
```

### Phase 3: Launch the brainstorm-coordinator agent

Pass the topic, exact participant specs, Context Brief, and gathered context. The coordinator:

- researches independently before dispatch and records any unverified assumptions;
- treats that research as non-voting verification evidence in exact two-model mode;
- uses the packaged `dist/brainstorm-run.js` for the exact Grok + Sol panel so both requests start concurrently within one blocking foreground process;
- uses only the selected routes and exact IDs;
- surfaces every failure and preserves provider/harness/model attribution; and
- synthesizes only after dispatch completes.

### Phase 4: Present synthesis truthfully

Pass through the coordinator's structured output. Attribute each participant by provider, harness, and requested ID; add the observed served ID only for direct xAI API / Grok CLI routes (noting a disclosed alias/snapshot), and describe Cursor and Codex CLI attributions as selected-only and unverifiable with any Cursor display label shown as a label, not a catalog ID. A two-model consensus exists only when both requested participants succeeded and independently support the point. If one fails, label the run **partial**, attribute surviving insights to the model that produced them, and never describe them as consensus. If both fail, report failure and provide no panel synthesis. The host's verification memo may verify or reject claims, but it cannot turn one participant's answer into two-model agreement.

## Important — verification matters

Confidence scores are not an oracle. External LLMs can return high-confidence claims contradicted by source. Verified findings carry more weight than inferred findings, while participant counts and consensus eligibility remain mechanical and cannot be upgraded by confidence. For code-review-specific per-finding verification, use `/multi-review`.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
