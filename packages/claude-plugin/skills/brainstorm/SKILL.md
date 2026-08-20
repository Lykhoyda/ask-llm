---
name: brainstorm
description: Send a topic to multiple LLM providers concurrently after the current host model forms an independent view, then synthesize all findings. Usage /brainstorm [providers] <topic>. External providers default to antigravity,codex. Example /brainstorm antigravity,codex,ollama "review this architecture"
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

The current host model must form and record an independent analysis before seeing external answers. Then send the same bounded topic and Context Brief concurrently to the selected providers, cross-check claims against source where possible, and synthesize consensus, unique insights, contradictions, rejected false positives, and confidence. Report the actual host model/providers and disclose possible same-family overlap.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

The current Pi host model completes its independent view first, records its actual provider/model, and only then calls native `ask-multi`. Do not claim the host is Claude Opus or that the coordinator has an isolated context.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Multi-LLM Brainstorm

Consult multiple external LLM providers simultaneously on a topic while Claude Opus performs its own independent research in parallel, then synthesize the findings from all participants.

## Instructions

### Phase 1: Parse arguments

- If the first argument looks like a comma-separated provider list (e.g., `antigravity,codex` or `gemini,codex,grok,ollama`), use those as the external providers
- If no provider list is given, default to `antigravity,codex`
- Valid external providers: `gemini`, `codex`, `grok`, `ollama`, `antigravity`
- `grok` requires `XAI_API_KEY` for the default API harness or official Grok Build auth with `ASK_GROK_HARNESS=grok-cli`; it may consume metered/plan usage and never falls back
- `antigravity` requires `agy` installed + logged in; if it's unavailable the coordinator surfaces that and continues with the other providers
- Everything after the provider list (or all args if no list) is the topic
- Claude Opus is always a participant — it's not in the provider list because it runs inside the coordinator

### Phase 2: Determine and prepare the brainstorm topic

- If the user provided a topic directly, use it
- If the context is about code changes, gather the relevant diff:
  - `git status --short` first to see what's modified/added/deleted
  - `git add -N <new-files>` for untracked files the user wants included
  - `git diff` + `git diff --cached` combined
  - **Filter noise**: exclude `:!docs/` `:!apps/docs/` `:!*.md` `:!yarn.lock` `:!*.lock` `:!*.png` from the pathspec — providers don't need to review your ADR/doc additions
  - **Size-check**: if combined diff > 150KB, ask the user before sending (the providers will take 5–15 min on payloads that large)
- If the context is a design/plan, gather the relevant documentation or conversation context
- If no topic is clear, ask the user what they'd like to brainstorm about
- Create a compact **Context Brief** before launching the coordinator. Keep it tiny for simple topics; add detail when the request is architecture/design/security/concurrency/migration related, spans packages, references external specs, or depends on conversation context external providers cannot see.

```markdown
## Context Brief

Intent:
- User request:
- Brainstorm mode:
- Providers: <list the selected providers for this run>

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

Launch with: the topic, the selected external providers list, the Context Brief, and any gathered context (diff/files/docs).

The coordinator handles:
- Phase 3B: its own Claude Opus research (reads actual files, traces code, uses WebFetch/WebSearch on referenced external docs) — runs FIRST so Claude doesn't anchor on external responses
- Context Brief update: after Phase 3B, records verified files/docs and unverified assumptions before external dispatch
- Phase 3A: external provider dispatch via a single blocking foreground Bash call (ADR-050 dispatch pattern)
- Phase 4: synthesis — consensus, unique insights, contradictions across all participants
- Verified findings (backed by Claude's file reads) are weighted higher than inferred ones
- Failed providers are surfaced inline with their stderr, not silently dropped

### Phase 4: Present the coordinator's synthesis

Pass through the coordinator's structured output. If the coordinator returned a partial result (some providers failed), present what landed and explicitly note what's missing — don't paraphrase or hide compromises.

## Important — verification matters

Confidence scores are not an oracle. The coordinator's Phase 3B exists specifically because external LLMs can return high-confidence findings that turn out to be factually wrong (a real example from 2026-04-17: Gemini returned 95/100-confidence claims that were contradicted by the actual `.d.ts` file). Claude's "Verified" findings carry more weight than external "Inferred" findings precisely for this reason.

If you want a code-review-specific version of this with explicit per-finding source verification, use `/multi-review` instead.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
