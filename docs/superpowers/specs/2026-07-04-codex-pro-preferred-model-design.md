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
  as an unavailable/unentitled model (not a quota 429). The design therefore
  triggers the downgrade on **both** an availability rejection and a quota
  error, so it is robust regardless of which class Codex returns. The exact
  rejection *string* was not captured (would require a live run on this account);
  catching both predicates removes the need to know it.

## Design

### The 3-tier ladder

The executor today has a 2-tier *downward* quota ladder. This design stacks one
*upward-preferred* tier on top, gated behind an explicit opt-in so default
behavior is unchanged:

```
PREFERRED (gpt-5.5-pro) ─[unavailable OR quota]→ DEFAULT (gpt-5.5) ─[quota]→ FALLBACK (gpt-5.4-mini)
        │                                              │
  only when opt-in `preferred:true`          existing behavior, unchanged
```

The bottom edge (`DEFAULT → FALLBACK`) is the current, already-tested quota
fallback — untouched. The new edge (`PREFERRED → DEFAULT`) is the only added
branch.

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
   a primary-leg catch: if the primary attempt fails and
   `isModelUnavailableError(err) || isQuotaError(err)`, downgrade to
   `MODELS.DEFAULT` and retry; below that, the existing `DEFAULT → FALLBACK`
   quota leg still applies. When `preferred` is falsy, behavior is byte-for-byte
   unchanged.
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
{ codex exec --sandbox workspace-write -m gpt-5.5-pro - < "$workdir/prompt.md" \
  || codex exec --sandbox workspace-write -m gpt-5.5 - < "$workdir/prompt.md"; } \
  > "$workdir/codex.out" 2> "$workdir/codex.err" &
pid_codex=$!
```

- Pro accounts: the first attempt succeeds; the fallback never runs.
- Non-Pro accounts: `-m gpt-5.5-pro` **fails fast** (a request-time
  availability rejection, seconds), then `-m gpt-5.5` runs.
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

Brainstorm (Path B) uses literal `gpt-5.5-pro`/`gpt-5.5` in the bash template
(the raw path bypasses the executor and its env resolution, matching how the
antigravity model is already restated literally in the same template).

## Tests

- **Executor unit tests** (`packages/codex-mcp/src/utils/__tests__`):
  - `preferred:true`, preferred model succeeds → runs `gpt-5.5-pro`, `fellBack: false` (used the intended top model).
  - `preferred:true`, preferred model unavailable → downgrades to `gpt-5.5`, succeeds, `fellBack: true` (a downgrade occurred).
  - `preferred:true`, preferred quota → `gpt-5.5` → `gpt-5.5` quota → `gpt-5.4-mini` (full ladder).
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
   unverified (no live Pro/non-Pro run captured). Mitigation: catch both
   `isModelUnavailableError` and `isQuotaError` on the primary leg; if neither
   matches in practice, add the observed substring to `MODEL_UNAVAILABLE_SIGNALS`
   (a one-line, drift-guarded change).
2. **Slug rename** by OpenAI. Mitigation: `ASK_CODEX_PREFERRED_MODEL` override
   (Path A) and a single literal in the brainstorm template (Path B).
```
