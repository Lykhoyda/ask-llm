# Weekly default-model version watch

This file is the complete specification for the scheduled routine
`ask-llm: LLM default-model version watch` (weekly, Mondays 07:00 UTC). The
scheduled agent reads this file from the default branch and follows it exactly,
end to end. Read-only investigation → issue/comment creation only.

Ownership: this routine owns **default/fallback model version drift** — whether
the model ids this repo pins are still current, still available, and still what
each provider ships as its default. The Friday routine in `docs/ROUTINES.md`
(rolling tracker #139) owns CLI flag/output/auth drift; do not duplicate its
findings.

## Scope (hard constraint)

- Read-only investigation. The ONLY mutable surfaces are: comments on the
  rolling tracker issue, maintaining the `State` section in its body, and — only
  on an actionable finding — one new GitHub issue per finding.
- Never modify code, never open PRs, never edit provider/model defaults.
  Adopting a new model version always goes through the repository's review
  path: a triaged issue → a human-reviewed PR → an ADR in `docs/DECISIONS.md`
  (the #244 → ADR-138 → PR #248 pattern).
- Never close the tracker, never create a second tracker, never delete or edit
  existing comments.

## Step 1 — Locate the rolling tracker (continuity rule)

Maintain exactly one rolling tracker issue titled exactly
`LLM default model versions - weekly tracker`.

1. Search OPEN issues for that exact title. If found, use it.
2. Otherwise search CLOSED issues for that exact title. If found, reopen it and
   use it (a closed tracker hides the run log).
3. Only if neither exists, create it with that exact title and a body
   containing a `State` section (last-checked baseline per provider).

If the tracker cannot be located or created (API failure), stop: report the
error in the final message and write nothing else.

## Step 2 — Read baseline state

Read the tracker body's `State` section and the most recent run-log comment for
the per-provider `last-checked` baseline. First run ever (no `State` section):
treat every provider as unbaselined, establish the baseline this run, and add
the `State` section to the tracker body.

## Step 3 — Enumerate the repository's current pins

The constants files are the source of truth (docs mirror them; parity is
CI-enforced by `scripts/check-docs-drift.mjs`). Read the current values from:

| Provider | Pin location | Fields |
|---|---|---|
| gemini | `packages/gemini-mcp/src/constants.ts` | `FACTORY_DEFAULT_MODEL`, `MODELS.FLASH` (quota fallback) |
| codex | `packages/codex-mcp/src/constants.ts` | `FACTORY_DEFAULT_MODEL`, `MODELS.FALLBACK` |
| claude | `packages/claude-mcp/src/constants.ts` | `FACTORY_DEFAULT_MODEL`, `MODELS.FALLBACK` |
| grok | `packages/grok-mcp/src/constants.ts` | `FACTORY_DEFAULT_MODEL`, `REASONING_EFFORTS`, `GROK_HARNESSES`; enumerate xAI `GET /v1/models`, `grok models`, and relevant `agent --list-models` IDs separately |
| ollama | `packages/ollama-mcp/src/constants.ts` | `FACTORY_DEFAULT_MODEL` |
| antigravity | `packages/antigravity-mcp/src/constants.ts` | `MODELS.DEFAULT`, `MODELS.FALLBACK` |

`packages/llm-mcp/src/constants.ts` (`PROVIDERS.*.defaultModel`) is the
canonical registry threading these defaults into executors; verify it agrees
with the per-provider files and flag any disagreement as a finding.

## Step 4 — Enumerate provider catalogs and defaults

For each provider, establish two facts from the authoritative source: (a) what
the provider currently ships as its **default** for the surface this repo uses,
and (b) what is merely **available** in its catalog. "Default" means what the
provider's CLI or API selects when no model is specified, or what the provider
documents as the current/recommended model for that tier; "available" means
listed in the catalog at all. A newly available sibling of our pin is an
IMPROVEMENT candidate even when the pin still resolves — do not stop at "is our
pinned model still valid?" (`docs/ROUTINES.md` rule 5; the #244 lesson).

| Provider | Authoritative sources |
|---|---|
| gemini | Google model catalog (ai.google.dev/gemini-api/docs/models): tier defaults, GA vs preview status, deprecation notices |
| codex | OpenAI models documentation (platform.openai.com/docs/models) + openai/codex release notes for the CLI's shipped default |
| claude | Anthropic models overview (docs.anthropic.com). Note: this repo pins the floating aliases `opus`/`sonnet` — record which concrete version each alias currently resolves to |
| ollama | ollama.com library page for the pinned model family (availability only; there is no provider-side default) |
| antigravity | `agy models` CLI output is the ONLY acceptable evidence (ADR-137). If `agy` is not runnable in this environment, mark antigravity UNVERIFIED — never infer agy slugs from Google's web catalog |

ADR-137 / ADR-138 / ADR-154 rules (binding):

- agy slugs are evidence-pinned to agy's live catalog (ADR-137). The gemini and
  antigravity pins are independent even when their values look related: gemini's
  quota fallback moved to `gemini-3.7-flash` while agy's fallback deliberately
  stayed `gemini-3.5-flash` (ADR-154). Never recommend bumping both in sympathy;
  each needs its own provider-native evidence.
- Catalog presence is not proof of CLI acceptance (ADR-138: a catalog-listed
  model returned 404 through the CLI path, and a later probe failed pre-model on
  auth). Web-catalog evidence alone supports at most an IMPROVEMENT candidate;
  say explicitly which verification is still missing.
- Changelogs and release notes are SECONDARY sources (ADR-109 discipline):
  verify claims against the provider's own catalog/CLI before classifying.

Bounded run: consult only the sources in the table above, at most one retry per
source, no broader crawling. A source that still fails after the retry is
UNVERIFIED for this run.

## Step 5 — Classify per provider

- **NO-CHANGE** — pin still available, still the appropriate default/tier, no
  newer sibling; provider default unchanged. Requires successfully fetched
  evidence — a provider with failed evidence is UNVERIFIED, never NO-CHANGE.
- **IMPROVEMENT** — a newer sibling/default shipped alongside a still-valid
  pin, or the provider's default moved ahead of ours.
- **BREAKING-RISK** — our pinned id is renamed, removed, deprecation-dated, or
  no longer accepted (would 404 at dispatch or fallback time).
- **UNVERIFIED** — the authoritative source could not be checked this run
  (auth-gated, unreachable, CLI unavailable). Record what failed and why.

## Step 6 — Dedup before filing

Search open issues (including tracker #139 and its recent comments) for each
IMPROVEMENT / BREAKING-RISK finding. If a matching open issue or thread exists,
comment the new delta there — do NOT open a duplicate. Open a NEW issue only
for an actionable finding with no existing home.

## Step 7 — Report

Every run, regardless of outcome, append ONE run-log comment to the tracker:

```
YYYY-MM-DD — gemini <verdict> / codex <verdict> / claude <verdict> / ollama <verdict> / antigravity <verdict>
```

with a short line per non-NO-CHANGE provider (what changed or what could not be
verified, with links). Update the `State` section's last-checked baseline for
every provider that was successfully verified; leave UNVERIFIED providers'
baselines untouched. Do not pad a quiet run: all NO-CHANGE means the one-line
comment is the entire report.

## Step 8 — Issue format (actionable findings only)

- Title: `upstream: <provider> <model/version> — <breaking|improvement> affecting <package>`
- Body: current pin (file reference) → observed provider state · verdict ·
  evidence with links, explicitly separating verified facts from
  still-unverified claims · recommended action for a human (never applied by
  this routine).
- Labels: `kano:needs-triage` + an `effort:s|m|l` estimate (per
  `docs/KANO-TRIAGE.md`).
