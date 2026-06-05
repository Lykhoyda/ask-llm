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

- **Every new issue** gets `kano:needs-triage` until categorized; replace it with the right `kano:*` once triaged, and add an `effort:*`.
- Quadrant reading: `must-be`+`effort:s` → do now; `attractive`/`performance`+`effort:l` → schedule deliberately; `kano:indifferent` → defer/close/consolidate.
- Useful queries:
  - Close/consolidate candidates: `gh issue list --label kano:indifferent`
  - Quick wins: `gh issue list --label "kano:must-be" --label "effort:s"`
  - Big bets: `gh issue list --label "kano:attractive" --label "effort:l"`

## Current triage (2026-06-05)

| Issue | Kano | Effort | Note |
|-------|------|--------|------|
| #139 — upstream-CLI compatibility (root audit) | `must-be` | `s` | The one canonical compat tracker to keep |
| #141 / #143 / #145 — sync follow-ups | `indifferent` | `s` | Consolidation candidates — fold into #139 or the roadmap (cf. ADR-109's audit-cadence retirement) |
| #142 — codex-pair Stop-hook gate | `attractive` | `l` | Delighter hardening the flagship; findings already surface, this makes HIGHs un-ignorable; needs design |
