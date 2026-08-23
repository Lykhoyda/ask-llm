# Issue Triage — Kano + Effort Labels

Issues are triaged on two axes (mirrors the scheme used in `rn-dev-agent`): **Kano** (is it worth doing?) and **effort** (what does it cost?). Together they sort the backlog into value/effort quadrants.

## Kano — is it worth doing?

| Label | Meaning | Default action |
|-------|---------|----------------|
| `kano:must-be` | Core promise; absence causes strong dissatisfaction | Do it — table stakes |
| `kano:performance` | Satisfaction scales with degree (more is better) | Prioritize by ROI |
| `kano:attractive` | Delighter; not missed when absent | Schedule deliberately |
| `kano:indifferent` | No satisfaction signal | Defer / close / consolidate |
| `kano:reverse` | More of it dissatisfies a segment | Guard / make opt-out |
| `kano:needs-triage` | Not yet categorized | **Default for new issues** — categorize, then replace |

## Effort — what does it cost?

| Label | Meaning |
|-------|---------|
| `effort:s` | < half a day |
| `effort:m` | ~1–3 days |
| `effort:l` | > 3 days / needs design |

## Convention

- **Every new delivery issue** gets `kano:needs-triage` until categorized; replace it with the right `kano:*` once triaged, and add an `effort:*`.
- Recurring automation trackers and release-incident trackers may remain outside Kano while they are open for repeated runs or external recovery evidence; list those exceptions explicitly below.
- Quadrant reading: `must-be`+`effort:s` → do now; `attractive`/`performance`+`effort:l` → schedule deliberately; `kano:indifferent` → defer/close/consolidate.
- Useful queries (run through the repository's GitHub wrapper):
  - Close/consolidate candidates: `gh-axi issue list --state open --label kano:indifferent`
  - Quick wins: `gh-axi issue list --state open --label "kano:must-be" --label "effort:s"`
  - Big bets: `gh-axi issue list --state open --label "kano:attractive" --label "effort:l"`

## Current triage (2026-08-23)

This table is the complete open, Kano-labeled delivery backlog as verified from GitHub. Empty quadrants are intentional: there are currently no open `kano:attractive`, `kano:indifferent`, or `kano:reverse` issues.

| Issue | Kano | Effort | Evidence-based next action |
|-------|------|--------|----------------------------|
| [#282 — unified diagnose rejects provider enrichment](https://github.com/Lykhoyda/ask-llm/issues/282) | `must-be` | `s` | Add the promised enrichment shape to the output schema and retain the diagnostic data |
| [#280 — CLI help/version/invalid args start the MCP server](https://github.com/Lykhoyda/ask-llm/issues/280) | `must-be` | `s` | Handle discovery and invalid arguments before server startup, with behavioral coverage |
| [#266 — unified transport in plugin workflows](https://github.com/Lykhoyda/ask-llm/issues/266) | `must-be` | `l` | Preserve exact provider/model and all provider-specific options through the unified fallback path |
| [#281 — codex-pair false injection findings for glyphs](https://github.com/Lykhoyda/ask-llm/issues/281) | `performance` | `m` | Reproduce legitimate glyph-heavy content separately from genuine injected instructions |
| [#268 — agy 1.1.11 read-only diagnostics](https://github.com/Lykhoyda/ask-llm/issues/268) | `performance` | `m` | Capture the live structured payload before adopting quota/model probes |
| [#283 — hard-isolate Antigravity reviews](https://github.com/Lykhoyda/ask-llm/issues/283) | `needs-triage` | `l` | Complete Kano classification, then compare isolation designs before implementation |

## Open operational trackers outside Kano

| Issue | Why it remains open | Merge evidence already delivered |
|-------|---------------------|----------------------------------|
| [#257 — release workflow failure](https://github.com/Lykhoyda/ask-llm/issues/257) | Closure requires a green recovery run plus external npm, MCP Registry, and unified-release verification | [PR #260](https://github.com/Lykhoyda/ask-llm/pull/260) shipped selective, exact, retry-safe Registry recovery (ADR-139) |
| [#272 — weekly default-model tracker](https://github.com/Lykhoyda/ask-llm/issues/272) | This is the rolling issue for recurring model-watch runs, not a one-shot delivery item | [PR #275](https://github.com/Lykhoyda/ask-llm/pull/275) restored the missing routine specification that had blocked the recorded run |

The prior 2026-06-14 snapshot is delivery history, not a live queue: its sole tracker, [#183](https://github.com/Lykhoyda/ask-llm/issues/183), is closed and shipped. Current priorities are owned by [`docs/ROADMAP.md`](ROADMAP.md); this file owns label meaning and the evidence-backed backlog view.
