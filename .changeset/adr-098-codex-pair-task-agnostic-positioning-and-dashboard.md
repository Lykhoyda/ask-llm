---
"@ask-llm/plugin": patch
---

# ADR-098 — codex-pair task-agnostic re-positioning + `/codex-pair` user-invocable dashboard

Two coupled documentation + UX changes for the codex-pair surface:

## 1. Task-agnostic re-framing across 5 documentation surfaces

Every place that described codex-pair's value via the ADR-077 four-task
benchmark's specific probe domains ("float-money precision, validation
bypass, edge-case clamping") in sentences like "Use codex-pair when handling
money / security-sensitive code" caused LLMs reading the ask-llm codebase
as project context to hallucinate that ask-llm itself has money handling
and auth paths. ask-llm is a CLI bridge between MCP clients and LLM CLIs
with none of that code.

The rewrite replaces domain-specific framing with code-characteristic
language ("code with hidden invariants the model can't infer from one
file", "code where latent bugs cost more than per-edit review", the
"looks fine, runs wrong" failure-mode class). The recall improvement is
explicitly attributed as task-agnostic — measured across four
structurally different fixtures (todo CRUD, URL shortener, RFC-spec
implementation, stateful business logic), not just one. Each surface
that lives in the LLM-readable corpus now includes an explicit "ask-llm
itself is a CLI/MCP bridge with none of these properties; codex-pair
runs here for dogfooding" disclaimer. Empirical numbers (2/10 → 7/10
→ 10/10) are preserved verbatim — only surrounding framing changes.

Surfaces touched: `packages/claude-plugin/skills/codex-pair/SKILL.md`,
`packages/claude-plugin/README.md`, `apps/docs/plugin/hooks.md`,
`apps/docs/plugin/skills.md`, `apps/docs/plugin/overview.md`.

## 2. `/codex-pair` user-invocable dashboard

`codex-pair/SKILL.md` flips from `user_invocable: false` to `true` with
a Phase 1–5 orchestration block at the top:

- **Phase 1**: Detect state (marker walk, pause sentinel check, recent
  log tail)
- **Phase 2**: Branch on detected state
- **Phase 3** (no marker → setup): Auto-detect project context by
  reading `README.md` + `package.json` + alternative manifests; draft a
  `.codex-pair/context.md` with project-purpose summary + 3-5 inferred
  domain invariants; use `AskUserQuestion` with the draft as the
  recommended option's `preview` field so the user sees content before
  deciding; ASK before modifying `.gitignore`
- **Phase 4** (paused): Structured status table with paused-since
  timestamp + resume instruction
- **Phase 5** (active): Structured status table with marker
  model + surface threshold + cost-per-review estimate + last 5 reviews
  summary + active ignore/include patterns + pause instruction

The existing hook reference documentation (when-to-use, cost
characteristics, output format, configuration knobs, empirical
justification) moves below the orchestration block but is unchanged
in substance — it serves as Claude's reference for explaining hook
behavior to users mid-orchestration.

Zero new code under `scripts/` — the entire orchestration uses Claude's
existing tool surface (Bash, Read, AskUserQuestion). Plugin test count
unchanged at 313 (no new code to test; the orchestration is natural-
language phase instructions, structural pinning would over-couple).
Lint clean across 6 workspaces.
