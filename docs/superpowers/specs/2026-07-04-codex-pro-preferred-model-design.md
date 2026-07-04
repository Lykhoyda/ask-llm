# Codex review/brainstorm preferred model (`gpt-5.5-pro`) — design

- **Date:** 2026-07-04
- **Status:** Approved (design) — pending implementation plan
- **ADR (to be filed on implementation):** ADR-132
- **Scope:** `packages/codex-mcp`, `packages/claude-plugin` (not `packages/shared` → no all-five-MCP changeset)

## Problem

`/codex-review` and `/brainstorm` currently run Codex on `gpt-5.5` (the codex-mcp
`FACTORY_DEFAULT_MODEL`). ChatGPT **Pro** subscribers have access to a
stronger model, `gpt-5.5-pro` ("maximum reasoning or quality when latency and
cost matter less"). These two commands are exactly the "independent second
opinion" workflows where the extra reasoning is worth the latency/cost, so they
should opportunistically prefer `gpt-5.5-pro` when the account is entitled to it
and transparently fall back to `gpt-5.5` when it is not.

## Goal

For `/codex-review` and `/brainstorm` only:

- Use `gpt-5.5-pro` when the Codex account is entitled to it.
- Otherwise fall back to `gpt-5.5` with no hard error and no user action.
- Keep the existing `gpt-5.5 → gpt-5.4-mini` quota fallback intact beneath it.
- Make the preferred model env-overridable (escape hatch if OpenAI renames it).

## Non-goals

- Changing the default model for the raw `ask-codex` MCP tool, `codex-pair`
  (per-edit hot path), `/multi-review`, or `/codex-verify`. They stay on
  `gpt-5.5`. (The mechanism is reusable, so opting any of them in later is a
  one-line change — explicitly out of scope for this iteration.)
- Any change to `packages/shared`.

## Findings (model-id investigation, 2026-07-04)

Evidence gathered from the local Codex CLI (v0.142.5) resolves the model-id
question and confirms the fallback is load-bearing, not hypothetical:

- **The correct slug is `gpt-5.5-pro`.** OpenAI's own model reference shipped
  inside Codex (`~/.codex/skills/.system/openai-docs/references/latest-model.md`)
  lists `gpt-5.5-pro` as "Maximum reasoning or quality when latency and cost
  matter less". Slug naming is consistent between that doc and Codex's `-m`
  slugs (`gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini` all match), so `gpt-5.5-pro` is a
  valid `-m` value.
- **`gpt-5.5-pro` is entitlement-gated.** `codex doctor` reports this machine is
  on a ChatGPT plan (`auth mode chatgpt`), and its server-fetched
  `~/.codex/models_cache.json` lists only four selectable slugs: `gpt-5.5`,
  `gpt-5.4`, `gpt-5.4-mini`, `codex-auto-review`. `gpt-5.5-pro` is **absent** from
  that account's available set — it appears only in the docs reference. A
  ChatGPT Pro subscriber's model cache would include it.
- **Implication:** on a non-Pro account, `codex exec -m gpt-5.5-pro` is rejected
  as an unavailable/unentitled model. The exact rejection *string* was not
  captured (would require a live run on this account), and the repo's existing
  detectors (`isModelUnavailableError`, `isQuotaError`) are **narrow substring
  matchers** — neither is guaranteed to match an arbitrary entitlement-rejection
  phrasing. Relying on them would risk a hard failure for the exact non-Pro users
  the feature protects. The design therefore does **not** signal-match on the
  preferred leg: any primary-leg failure downgrades to the base model
  (see "The 3-tier ladder"). Correctness does not depend on knowing the string;
  the string only matters for optional telemetry (§Open risks).

## Design

### The 3-tier ladder

The executor today has a 2-tier *downward* quota ladder. This design stacks one
*upward-preferred* tier on top, gated behind an explicit opt-in so default
behavior is unchanged:

```
PREFERRED (gpt-5.5-pro) ─[ANY primary failure]→ DEFAULT (gpt-5.5) ─[quota]→ FALLBACK (gpt-5.4-mini)
        │                                              │
  only when opt-in `preferred:true`          existing behavior, unchanged
```

The bottom edge (`DEFAULT → FALLBACK`) is the current, already-tested quota
fallback — **still quota-gated, untouched**. The new top edge
(`PREFERRED → DEFAULT`) is the only added branch, and it is **unconditional**:
because the preferred tier is opportunistic/best-effort, *any* failure of the
preferred attempt (entitlement rejection, quota, transient error) downgrades to
the base default rather than signal-matching a specific string. This is what
makes the fallback robust to an unverified rejection phrasing, and it makes
Path A symmetric with Path B's unconditional `||`. A downgrade emits a WARN log
with the failure reason so a misconfigured `ASK_CODEX_PREFERRED_MODEL` (e.g. a
typo) surfaces in logs instead of silently always-downgrading.

### Path A — `/codex-review` (executor-backed)

`/codex-review` → `codex-reviewer` agent → `mcp__codex__ask-codex` →
`executeCodexCLI()`.

1. **`packages/codex-mcp/src/constants.ts`** — add to `MODELS`:
   ```ts
   PREFERRED: process.env.ASK_CODEX_PREFERRED_MODEL || "gpt-5.5-pro",
   ```
2. **`packages/codex-mcp/src/utils/codexExecutor.ts`** — add
   `preferred?: boolean` to `CodexExecutorOptions`. When `preferred` is true and
   no explicit `model` was supplied, the primary model is `MODELS.PREFERRED`. Add
   a primary-leg catch that runs **after** the existing archived-session guard:
   on *any* failure of the preferred attempt, WARN-log the reason and retry once
   with `MODELS.DEFAULT`; below that, the existing (quota-gated) `DEFAULT →
   FALLBACK` leg still applies. The downgrade is intentionally **not**
   signal-matched — see "The 3-tier ladder" for why. When `preferred` is falsy,
   behavior is byte-for-byte unchanged.
3. **`packages/codex-mcp/src/tools/ask-codex.tool.ts`** — add an opt-in
   `preferred?: boolean` arg (default off; described as "prefer the
   higher-reasoning model and fall back automatically"), forwarded to the
   executor. The `model` param contract is unchanged (still "do not set unless
   the user asks").
4. **`packages/claude-plugin/agents/codex-reviewer.md`** and
   **`skills/codex-review/SKILL.md`** — instruct the `ask-codex` call to pass
   `preferred: true`.

**Rejected alternative:** an env-only trigger with no tool arg. Rejected because
the MCP server is long-lived and shared, so a process-global env var cannot
distinguish a review call from a `codex-pair` call within the same server
process. The per-call `preferred` arg is the correct granularity.

### Path B — `/brainstorm` (raw `codex exec` in a backgrounded bash job)

The `brainstorm-coordinator` deliberately backgrounds `codex exec` in a bash
job (ADR issue #23 — sub-agent teardown SIGKILLs background jobs, so the dispatch
block is fragile and must stay minimal). It never touches `executeCodexCLI`, so
it cannot inherit Path A's ladder.

Change the codex leg to a grouped, unconditional bash fallback:

```bash
codex_pref="${ASK_CODEX_PREFERRED_MODEL:-gpt-5.5-pro}"
codex_base="${ASK_CODEX_MODEL:-gpt-5.5}"
{ codex exec --sandbox workspace-write -m "$codex_pref" - < "$workdir/prompt.md" \
  || codex exec --sandbox workspace-write -m "$codex_base" - < "$workdir/prompt.md"; } \
  > "$workdir/codex.out" 2> "$workdir/codex.err" &
pid_codex=$!
```

- The `${ASK_CODEX_PREFERRED_MODEL:-gpt-5.5-pro}` / `${ASK_CODEX_MODEL:-gpt-5.5}`
  shell defaults give Path B the **same env-overridability as Path A** — the
  slug-rename escape hatch covers both commands, not just review.
- Pro accounts: the first attempt succeeds; the fallback never runs.
- Non-Pro accounts: `-m "$codex_pref"` **fails fast** (a request-time
  availability rejection, seconds), then `-m "$codex_base"` runs.
- `prompt.md` is a **file**, not a pipe, so both attempts can re-read stdin.
- The `{ ...; }` group is backgrounded as one job so `pid_codex=$!` and the
  existing `wait "$pid_codex"` capture the whole leg's exit code.

**Rejected alternatives:**
- **Route brainstorm's codex leg through the plugin `ask-codex-run` binary**
  (so it shares Path A's ladder). Architecturally cleaner (one fallback
  implementation, zero drift), but injects a new `${CLAUDE_PLUGIN_ROOT}` binary
  invocation and a dependency-resolution risk into the exact fragile
  background-lifecycle block ADR issue #23 warns about. Not worth the risk for a
  single provider leg.
- **Signal-matching bash fallback** (retry only on a matched availability
  string). Would duplicate `MODEL_UNAVAILABLE_SIGNALS` outside TypeScript,
  violating the repo's single-source-of-truth culture (ADR-128). The
  unconditional `||` matches no string, so it introduces no drift.

**Accepted caveat:** if a Pro run genuinely *times out* (rather than
fails-fast), the sequential retry runs `gpt-5.5` afterward, which could approach
the 600s Bash tool cap and get the whole dispatch killed. This is rare (pro
unavailability fails fast; genuine timeouts are the exception), and the
coordinator already degrades gracefully on a failed codex leg. Documented, not
mitigated, in v1.

## Configuration summary

| Knob | Default | Effect |
|------|---------|--------|
| `ASK_CODEX_PREFERRED_MODEL` | `gpt-5.5-pro` | Primary model for the preferred tier (Path A). Escape hatch if the slug is renamed or a user wants a different high model. |
| `ASK_CODEX_MODEL` | `gpt-5.5` | Unchanged. Base default; second rung of the ladder. |
| `ASK_CODEX_FALLBACK_MODEL` | `gpt-5.4-mini` | Unchanged. Quota fallback; third rung. |

Brainstorm (Path B) reads the same two env vars via shell `${VAR:-default}`
expansion in the bash template, so both `ASK_CODEX_PREFERRED_MODEL` and
`ASK_CODEX_MODEL` apply to `/brainstorm` as well as `/codex-review`.
`ASK_CODEX_FALLBACK_MODEL` (the mini quota rung) is executor-only and does not
apply to the raw brainstorm path.

## Tests

- **Executor unit tests** (`packages/codex-mcp/src/utils/__tests__`):
  - `preferred:true`, preferred model succeeds → runs `gpt-5.5-pro`, `fellBack: false` (used the intended top model).
  - `preferred:true`, preferred fails with an **arbitrary/unknown error string**
    (not a quota or known-unavailable signal) → still downgrades to `gpt-5.5`,
    succeeds, `fellBack: true`. This is the key regression guard for finding-1:
    the downgrade must not depend on signal matching.
  - `preferred:true`, preferred quota → `gpt-5.5` → `gpt-5.5` quota → `gpt-5.4-mini` (full ladder).
  - `preferred:true`, preferred fails → `gpt-5.5` fails with a **non-quota** error
    → error surfaced (the base→mini rung stays quota-gated; a real error is not
    masked by a third attempt).
  - `preferred:false`/absent → identical to today (regression guard).
  - Explicit `model` supplied with `preferred:true` → explicit model wins (no override).
- **Tool-contract drift test** (`packages/codex-mcp/src/tools/__tests__`): assert
  the new `preferred` arg exists and defaults off; `FACTORY_DEFAULT_MODEL` pin
  unchanged.
- **llms.txt / llms-full.txt**: document the `preferred` arg on `ask-codex`.

## Docs & process (per project CLAUDE.md)

- **ADR-132** in `docs/DECISIONS.md`: preferred-model tier for review/brainstorm,
  the 3-tier ladder, the two-path split, and rejected alternatives.
- **`docs/PROVIDER-PARITY.md`**: record that codex has a review-tier ladder that
  the other providers do not.
- **`docs/ROADMAP.md`**: dated run entry. **`docs/BUGS.md`**: only if a bug surfaces.
- **Changeset** covering `ask-codex-mcp` (feature) and `@ask-llm/plugin`
  (agent/skill/coordinator changes). Not a `packages/shared` change → the
  all-five-MCP changeset rule (ADR-119) does not apply.
- **Postman:** N/A — no HTTP backend endpoints in this repo.

## Open risks

1. **Exact rejection string** for an unentitled `gpt-5.5-pro` request is
   unverified. This is **no longer a correctness risk** — the preferred leg
   downgrades unconditionally, so an unknown string still falls back. Residual
   impact is telemetry only: a WARN log will carry the raw reason. If we later
   want to distinguish "expected: not entitled" from "unexpected: real error" in
   logs/metrics, capture the live string and add it to `MODEL_UNAVAILABLE_SIGNALS`
   (a one-line, drift-guarded change). Not required to ship.
2. **Slug rename** by OpenAI. Mitigation: `ASK_CODEX_PREFERRED_MODEL` (with
   `ASK_CODEX_MODEL` as base) overrides **both** paths — Path A via the executor,
   Path B via `${VAR:-default}` shell expansion in the brainstorm template.
