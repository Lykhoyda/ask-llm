---
name: ask-llm-brainstorm
description: Consult a multi-model panel, the fixed Fable + Astra + Carbon frontier panel with --frontier, or one exact Codex model with --external-only. Usage /brainstorm [--external-only | --frontier] [--no-fallback] [participants] <topic>. The default panel uses antigravity,codex.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

For the standard workflow, the current host model records an independent analysis before seeing external answers, then sends the same bounded topic and Context Brief concurrently to the selected providers. For the exact Grok + GPT-6 Sol workflow, the host is a non-voting evidence verifier/synthesizer: the brainstorming panel has exactly those two requested participants. For the frontier panel, the host is likewise a non-voting evidence verifier/synthesizer and the panel has exactly three pinned participants: Claude Fable, GPT-6.2 Astra, and Gemini 4 Carbon (High). Cross-check source where possible and synthesize consensus, unique insights, contradictions, rejected false positives, failures, and confidence. Keep provider, harness, requested model ID, independently observed served model ID, and Cursor's reported display label separate. Only direct xAI API / Grok CLI routes can report a served ID, and only when the provider/CLI payload actually carries one; a disclosed same-product alias/snapshot resolution (for example `grok-4.7` served as a dated `grok-4.7-<snapshot>`, or `grok-4-latest` served as `grok-4-<snapshot>`) stays eligible, while a different model is a mismatch and ineligible. A direct route whose payload omits the model stays selected-only. Cursor Agent and Codex CLI echo the requested ID, so that attribution is selected-only and unverifiable—never call a requested or selected ID the actual model. Never select Cursor Auto, infer a requested ID from a display label, silently change a model, or pivot to another harness/provider.
<!-- PORTABLE-CONTRACT:END -->

## Parse arguments before dispatch

Read the leading options separately from the participant list and topic. Recognize `--external-only`, `--frontier`, and `--no-fallback` in any order. Reject unknown leading options. Freeze the selected options and routes before preparing a consultation.

- `--external-only` requires exactly one explicit `codex@codex-cli:<exact-model-id>` participant and a topic. It implies `--no-fallback`, which may also be written explicitly. Reject an empty or Auto ID, a display label, multiple participants, or any other route. An exact ID is a single token made of letters, digits, dots, underscores, slashes, colons, or hyphens, starting with a letter or digit. Pass the exact token unchanged.
- `--frontier` selects the fixed frontier panel and takes only a topic. It implies `--no-fallback`, which may also be written explicitly. Reject it together with `--external-only` or with any participant list, and reject an empty topic.
- Without `--external-only` or `--frontier`, keep the standard bare list or the routed panel of exactly one Grok model and one GPT-6 family Sol model. `--no-fallback` controls the Codex second-model attempt. It applies to bare Codex in the Claude Code coordinator, and to a routed Codex participant if its transport can enforce one model attempt. The pinned Cursor Agent route already dispatches only once. Reject the flag for panels without Codex and for bare lists on Pi or other portable hosts where the batch tool cannot enforce it.
- For invalid combinations, explain the syntax and stop before any provider dispatch. Never reinterpret a routed participant as a bare name.

```text
/brainstorm --external-only --no-fallback codex@codex-cli:gpt-6.2-astra "Review the trade-offs of this queue design"
```

## External-only workflow

Use this branch before host research, any independent memo, or the Claude Code coordinator. The current host prepares one bounded prompt with the topic and relevant context, then relays the consultation. It may verify a specific fact against source. It does not add a peer opinion, invoke a helper model, assemble a panel or write a consensus section.

Send the exact model, `reasoningEffort: "high"`, `sandbox: "read-only"`, and `noFallback: true`. Omit `sessionId` for a fresh ephemeral call. Use the host route below.

- On Pi, call native `ask-llm` with `provider: "codex"`, `preferred: false`, and explicit `includeDirs` (empty when none). Check that the advertised schema supports Codex and every pinned field, including `noFallback`, before dispatch. If it does not, stop with package and skill update guidance.
- On Claude Code and other hosts, use the strict Codex ladder in [transport.md](../ask-llm-review/transport.md). Check registered tools first so the marketplace install can use its bundled `ask-codex` leaf. The CLI-only rung uses [codex-strict.sh](codex-strict.sh) from this skill folder. Do not launch the coordinator or use `dist/brainstorm-run.js` for this branch.

Make at most one consultation. A stale registration may be skipped before dispatch, but an invoked tool's refusal, disconnect, timeout or provider failure ends the run. Require a nonempty answer with the same selected model and configured effort. Check the tool's structured result and fallback flag when exposed, or its leading attribution line if the host only exposes text. Reject a reported fallback or mismatched selection. On success, show one participant with its transport, selected model, configured reasoning effort and answer. On failure, name the selected route, requested model and configured effort, and preserve the error without panel synthesis.

## Frontier panel workflow

Use this branch for `--frontier`. The current host prepares one bounded prompt with the topic and a Context Brief, then writes its independent evidence memo before any dispatch. The memo is non-voting: it can verify or reject claims but never adds a panel vote. Then consult exactly these three participants concurrently with the same prompt, one attempt each:

| Participant | Route and pins |
|---|---|
| Claude Fable | The isolated, read-only Claude Code subagent route that `/fable-review` uses, launched with model `fable` at high effort. Only Claude Code can run it. |
| GPT-6.2 Astra | Codex `model: "gpt-6.2-astra"`, `reasoningEffort: "high"`, `sandbox: "read-only"`, `noFallback: true`, through the strict Codex ladder in [transport.md](../ask-llm-review/transport.md). |
| Gemini 4 Carbon (High) | Antigravity through the `ask-llm` tool with `provider: "antigravity"`, `model: "gemini-4-carbon-high"`, and `noFallback: true`. Omit `reasoningEffort`: the ID already carries the High tier, and Ask LLM rejects a separate effort with a tiered ID. Antigravity's execution opt-in applies. |

Never substitute a participant, route, or model, and never add a fourth participant. Check each route before dispatch. A participant the host cannot run, or whose tool is missing or lacks a pinned field, is listed as unavailable with its reason and is not dispatched; the others still run. A participant whose call fails is listed with its route, requested model, configured effort, and error. A reported fallback or a different selected model makes that answer ineligible and is disclosed. For every answer, report the route, the requested model, and the configured effort. Say that Fable was requested but its resolved model was not independently verified, and that the Astra and Carbon labels are selected-only.

A point is frontier consensus only when at least two successful participants state it independently; name them, and say when all three agree. Label the run **partial** when fewer than three participants answered, and write no consensus section when fewer than two answered. If none answered, report the failures without a panel synthesis.

## Host adapters

### Pi adapter

For `--frontier`, list Claude Fable as unavailable on Pi, because independent Fable review is a Claude Code capability and Pi starts no nested Fable session. After the independent memo, issue only these two native `ask-llm` calls, concurrently when the host supports it, after checking that the advertised schema supports every pinned field. Pass explicit `includeDirs` to the Codex call (empty when none). The run is partial by construction.

- `ask-llm({ provider: "codex", model: "gpt-6.2-astra", reasoningEffort: "high", sandbox: "read-only", noFallback: true, preferred: false, includeDirs, prompt })`
- `ask-llm({ provider: "antigravity", model: "gemini-4-carbon-high", noFallback: true, prompt })`

After the external-only branch, the Pi host completes its independent evidence memo first. Standard provider lists use native `ask-multi`. When relaying the Codex answer, preserve the selected model and configured effort from its result. A routed participant uses the matching native tool instead: `provider@cursor-agent:model` calls `ask-cursor-agent` with separate `provider` and exact `model`; direct Grok calls `ask-grok` with the explicit `harness` and exact model. Use native `ask-llm` with the strict Codex pins above for a direct Sol participant with `--no-fallback`. A participant list mixing routed `provider@harness:exact-model-id` entries with bare provider names is refused before any tool call; nothing is dispatched or substituted. With the example Cursor IDs below, issue only these two consultations (concurrently when the host supports it):

- `ask-cursor-agent({ provider: "grok", model: "grok-4.7-high", prompt })`
- `ask-cursor-agent({ provider: "codex", model: "gpt-6.2-sol-high", prompt })`

Do not call `ask-multi` for that panel because it cannot express Cursor harness identity, and do not call Gemini. Treat the host memo as non-voting verification evidence, not a third panel answer. If either participant fails, label the run partial and do not claim two-model consensus.

### Other hosts adapter

Codex, Cursor Agent, Antigravity, Grok Build, Gemini CLI and OpenCode get this skill from their skills folder, not from a plugin. After the external-only branch, the host completes its independent evidence memo first. For standard provider lists, apply the availability filtering, dispatch, and reporting steps in `../ask-llm-review/transport.md` and relay the selected model and configured effort from the Codex result. A routed participant uses its matching tool instead: `provider@cursor-agent:model` calls the `ask-cursor-agent` tool with separate `provider` and exact `model`; `grok@grok-cli:model` and `grok@xai-api:model` call `ask-llm` with `provider: "grok"`, that `harness` and the exact model; `codex@codex-cli:model` uses the Codex call from `../ask-llm-review/transport.md` with that exact model and uses the strict ladder if `--no-fallback` is set. A list mixing routed and bare entries is refused before any call. In the exact Grok + Sol panel, consult only the two requested routes. The host memo is non-voting evidence, and a failed participant makes the run partial.

For `--frontier`, list Claude Fable as unavailable, because only Claude Code can run its isolated subagent. Consult Astra through the strict Codex ladder in `../ask-llm-review/transport.md`, and Carbon through the `ask-llm` tool with the pins in the frontier table. When a participant's tools cannot honor every pin, list it as unavailable with the upgrade guidance from that file instead of stopping the whole run.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The detailed workflow below applies to standard and exact two-member panels in Claude Code after the external-only branch. The frontier panel follows its own section next and does not launch the coordinator. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code.

## Frontier panel on Claude Code

Run `--frontier` in this conversation. Do not launch `brainstorm-coordinator`: a subagent cannot launch the Fable subagent.

1. Gather context and build the Context Brief as in Phase 2 below, with mode `frontier`, the three participants with their exact routes, and every other provider recorded as excluded.
2. Use Bash to read `CLAUDE_CODE_SUBAGENT_MODEL`. If it is set to anything other than `inherit`, `fable`, or a `claude-fable-*` model ID, list Fable as unavailable, because that variable overrides the model the skill requests.
3. Resolve the other two routes before dispatch. For Astra, use the strict Codex ladder: an exact `ask-codex` leaf, then the `ask-llm` leaf, each checked against its input schema. For Carbon, use the `ask-llm` leaf of the `ask-llm` server (`mcp__ask-llm__ask-llm`) whose schema offers `antigravity` as a `provider` and advertises `model` and `noFallback`; an `ask-antigravity` leaf cannot take the model pin. A route that is not exposed, or a schema missing a pinned field, makes that participant unavailable.
4. Write the independent evidence memo yourself before any dispatch: read the referenced files, trace the relevant code, and mark each finding Verified or Inferred.
5. Send every available consultation in one message so they run concurrently: launch the `fable-consultant` agent with the per-invocation model set to `fable`, and make the Astra and Carbon tool calls with the frontier pins. If Astra resolves only to the CLI rung, run `bash "${CLAUDE_PLUGIN_ROOT}/skills/ask-llm-brainstorm/codex-strict.sh" gpt-6.2-astra high` with the prompt on stdin as a foreground Bash call with `timeout: 600000` in that same message.
6. If the Agent tool reports a fallback or model-availability error for Fable, treat that answer as ineligible. Check the Astra and Carbon results for a fallback flag or a model other than the one requested.
7. Synthesize with the frontier rules above and the coordinator's cross-check discipline and output format: verify specific claims against source, keep rejected false positives visible, grade synthesis confidence, and list each participant as answered, failed, or unavailable.

# Multi-LLM Brainstorm

Consult an explicitly selected panel on a topic, then synthesize the responses against source-grounded host research.

## Instructions

### Phase 1: Parse arguments and freeze participant identity

- After the leading options, the first argument may be a comma-separated participant list.
- Compatible bare provider names remain supported: `gemini`, `codex`, `grok`, `ollama`, `antigravity`. If omitted, default to `antigravity,codex`.
- Bare `grok` retains the existing direct canonical runner and its explicit `ASK_GROK_HARNESS` selection (`xai-api` default or `grok-cli`) for compatibility. That direct route never falls back.
- Preferred explicit syntax is `provider@harness:exact-model-id`. Supported routed participants are:
  - `grok@cursor-agent:<exact ID from agent --list-models>` (preferred Grok route)
  - `codex@cursor-agent:<exact GPT-6 Sol ID from agent --list-models>`
  - `grok@grok-cli:<exact ID from grok models>` (explicit Grok Build alternative)
  - `grok@xai-api:<exact ID from GET /v1/models>`
  - `codex@codex-cli:gpt-6.2-sol` (explicit direct Codex alternative; any reported fallback makes the exact panel partial)
- Never accept `Auto`, map a display label to an ID, or substitute a route. A missing registration/harness, unavailable model, auth failure, or unsupported provider/harness pair is a participant failure with its actionable error preserved.
- A participant list must be either all bare provider names or all routed `provider@harness:exact-model-id` specs. A mixed list (for example `grok@cursor-agent:grok-4.7-high,antigravity`) is refused before any dispatch with the "Mixed brainstorm participant lists are not supported" error; no participant is rerouted to a bare runner, substituted, or dispatched. Generalized mixed panels are deferred to a future ADR.
- Everything after the participant list is the topic.
- In standard mode, Claude Opus remains a participant. In the exact Grok + Sol mode below, Claude is only the non-voting evidence verifier/synthesizer so the panel has exactly two participants.

**Architect workflow — exactly Grok + GPT-6 Sol, no Gemini:**

```text
/brainstorm grok@cursor-agent:grok-4.7-high,codex@cursor-agent:gpt-6.2-sol-high "review this architecture"
```

The Cursor `gpt-6.2-sol-high` example follows the `<codex-slug>-high` naming but is unverified; confirm the exact ID with `agent --list-models` before use. Confirm the Grok ID against the same catalog. The coordinator must not call Gemini, the direct Grok runner, xAI API, Grok Build, or Codex CLI for this invocation.

**Explicit Grok Build alternative (still no Gemini):**

```text
/brainstorm grok@grok-cli:grok-4.7,codex@cursor-agent:gpt-6.2-sol-high "review this architecture"
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

Pass the topic, exact participant specs, frozen `--no-fallback` choice, Context Brief, and gathered context. The coordinator:

- researches independently before dispatch and records any unverified assumptions;
- treats that research as non-voting verification evidence in exact two-model mode;
- uses the packaged `dist/brainstorm-run.js` for the exact Grok + Sol panel so both requests start concurrently within one blocking foreground process;
- uses only the selected routes and exact IDs;
- surfaces every failure and preserves provider/harness/model attribution; and
- synthesizes only after dispatch completes.

### Phase 4: Present synthesis truthfully

Pass through the coordinator's structured output, including the configured reasoning effort for direct Codex. Attribute each participant by provider, harness, and requested ID; add the observed served ID only for direct xAI API / Grok CLI routes (noting a disclosed alias/snapshot), and describe Cursor and Codex CLI attributions as selected-only and unverifiable with any Cursor display label shown as a label, not a catalog ID. A two-model consensus exists only when both requested participants succeeded and independently support the point. If one fails, label the run **partial**, attribute surviving insights to the model that produced them, and never describe them as consensus. If both fail, report failure and provide no panel synthesis. The host's verification memo may verify or reject claims, but it cannot turn one participant's answer into two-model agreement.

## Important — verification matters

Confidence scores are not an oracle. External LLMs can return high-confidence claims contradicted by source. Verified findings carry more weight than inferred findings, while participant counts and consensus eligibility remain mechanical and cannot be upgraded by confidence. For code-review-specific per-finding verification, use `/multi-review`.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
