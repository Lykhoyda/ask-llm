# Gemini Tier-Discontinuation Guidance — Design Spec (2026-06-05)

**Status:** 📋 Designed (brainstormed 2026-06-05). Dual external review — **Codex** and **Gemini** (`gemini-3-flash-preview`) — both returned **"ship with changes"**; all findings incorporated below. Implements **#140 P0**. Not yet implemented.

**Goal:** When Gemini CLI's backend stops serving a user's tier on **2026-06-18** (free / Google AI Pro / Ultra; Code Assist Standard/Enterprise exempt), surface an **actionable, date-gated in-product message** instead of a raw 401/403/quota error. The binary still installs and launches — the failure is *account/backend access* — so the goal is purely to translate the dominant post-cutoff failure into guidance.

**Verified premise:** Confirmed against the [Google Developers Blog announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) + corroborating press ([The Register](https://www.theregister.com/ai-ml/2026/05/20/bye-bye-gemini-cli-google-nudges-devs-toward-antigravity/), gemini-cli discussion #27274). Antigravity CLI is the closed-source successor, a **separate `agy` Go binary** (not a `gemini` flag).

## Decisions (settled in brainstorming + dual review)

1. **Date-gated heuristic, not exact-string match.** The exact post-cutoff error string is unknowable until a real user hits it on 2026-06-19, so detection keys off the **cutoff date + error class**, not a literal string. A future PR can tighten with the real string without changing the contract.
2. **Keep the Flash fallback; the fallback TRIGGER stays narrow.** Only genuine quota signals (`QUOTA_PATTERNS`: `RESOURCE_EXHAUSTED`, `TerminalQuotaError`, "exhausted your capacity") trigger the Flash retry — unchanged, so enterprise users who hit real Pro quota post-cutoff keep their fallback. The **broadened access/auth patterns drive ONLY the tier-note enrichment**, so a 401/403 enriches immediately via the existing `else`/throw branch with **no wasted Flash call** (auth errors never matched `QUOTA_PATTERNS` to begin with). *(Gemini #1, reconciled with the user's "keep fallback" choice.)*
3. **Split classify from format.** New `classifyGeminiCliError(rawMessage) → 'workspaceTrust' | 'quota' | 'tierAccess' | 'operational' | 'unknown'`. The note-appender is a **pure formatter**. Classification runs on **raw** errors, **never** the composed fallback string (`"PRO quota exceeded, FLASH fallback also failed: <X>"` hard-codes "quota" and would false-positive on a Flash *timeout*). *(Codex #1/#2, the catch.)*
4. **PREPEND the note**, not append. The actionable guidance is a visible header; the raw error follows as "technical details." Appending buries the lead under verbose `stream-json` error output in MCP clients. Idempotent via a stable prefix marker (no double-prepend across catch layers). *(Gemini #3, Codex #6.)*
5. **Hedged wording + explicit `agy` non-support.** The message says the cutoff is the **likely** cause (not a definitive diagnosis — enterprise users still hit genuine auth/billing errors), and states plainly that **`ask-gemini-mcp` does not yet support Antigravity (`agy`)** — use `agy` directly or switch to `ask-codex`/`ask-ollama`. Do not present `agy` as a drop-in. *(Codex #3, Gemini #4.)*
6. **UTC cutoff.** `GEMINI_TIER_CUTOFF = 2026-06-18T00:00:00Z` (explicit `Z`, not `new Date("2026-06-18")` which is UTC-midnight and can fire June 17 locally). Overridable via `ASK_GEMINI_TIER_CUTOFF`; an invalid value falls back to the default (never disables silently in a surprising way). *(Codex #5, Gemini #5.)*
7. **P0 only.** Antigravity (`agy`) provider/executor and a CI version-pin (P1), plus ask-llm-mcp degraded-probe and sponsorship copy (P2), are deferred until the surface settles / we have post-cutoff data.

## Why this is bounded

The expensive machinery already exists and is reused: the `geminiExecutor.ts` catch flow, the `isWorkspaceTrustError → throw actionable message (no Flash)` precedent, and `QUOTA_PATTERNS`/Flash fallback. Net-new is a small classifier, a pure formatter, two call-site enrichments, a constants block, and docs — **no change to the fallback control flow**.

## Architecture & data flow

```
catch (error):                                            (geminiExecutor.ts ~:558)
  classification = classifyGeminiCliError(rawError)
  workspaceTrust  → throw WORKSPACE_TRUST_REQUIRED         (unchanged, :561)
  quota & not Flash → Flash fallback                        (trigger = narrow QUOTA_PATTERNS only)
        fallback fails → cls = classify(rawFlashError)        (Pro is quota by construction at :584,
                                                               so discriminate on the FLASH failure class)
                         throw new Error(formatTierNote(<composed msg>, cls, now, cutoff))   (:584)
  else              → throw new Error(formatTierNote(rawError, classification, now, cutoff))  (:587)
```

`formatTierNote(message, classification, now, cutoff)` — pure formatter:
- returns `message` unchanged unless **`now ≥ cutoff`** AND **classification ∈ {`quota`, `tierAccess`}** AND the note marker is not already present;
- otherwise returns `<TIER_DISCONTINUED header>\n\n<message>` (**prepend**).

`classifyGeminiCliError(raw)` — pure classifier, on a RAW single error:
- `workspaceTrust` if `WORKSPACE_TRUST_PATTERNS` match;
- `quota` if `QUOTA_PATTERNS` match (drives the Flash-fallback trigger);
- `tierAccess` if `TIER_ACCESS_PATTERNS` match (403, `PERMISSION_DENIED`, 401, `UNAUTHENTICATED`, `forbidden`, "not authorized", "access denied", "does not have access", `subscription`, `plan`, `tier`, "Code Assist", `Standard`, `Enterprise`, `billing`, "not available", `disabled`) — word-boundary regex for numeric/word codes;
- `operational` for timeout/parse/spawn signals; `unknown` otherwise.

## Components

| File | Change |
|------|--------|
| `packages/gemini-mcp/src/constants.ts` | Add `TIER_ACCESS_PATTERNS`; `GEMINI_TIER_CUTOFF` (`2026-06-18T00:00:00Z`, `ASK_GEMINI_TIER_CUTOFF` override, invalid→default); `ERROR_MESSAGES.TIER_DISCONTINUED` (hedged "likely caused by", names the cutoff + 3 paths: Code Assist Standard/Enterprise · switch to `ask-codex`/`ask-ollama` · Antigravity `agy` migration link **with explicit "not yet supported by this MCP server"**); a stable prefix marker constant for idempotency. |
| `packages/gemini-mcp/src/utils/geminiExecutor.ts` | New pure `classifyGeminiCliError(raw)` + pure `formatTierNote(message, classification, now, cutoff)`; wire at `:584` (classify the **raw Flash** error — the Pro error is `quota` by construction here, so the Flash failure class is the discriminator) and `:587` (classify the raw error). No fallback-flow change. |
| `packages/gemini-mcp/src/__tests__/…` | Classifier units + formatter units + **executor catch-flow integration tests** (below). |
| `README.md` + `apps/docs/providers/gemini.md` | Cutoff banner: gemini-cli stops serving free/Pro/Ultra on 2026-06-18; works for Code Assist Standard/Enterprise; **npm package still installs/launches — failure is account/backend, don't reinstall**; **Antigravity is a separate migration path, not a drop-in**; point others to `ask-codex`/`ask-ollama`; link the blog. |
| `packages/gemini-mcp/CHANGELOG.md` | Patch entry documenting the upstream transition + the new guidance. |

## Error handling

Silent-safe throughout: classification is pure and total (`unknown` default); `formatTierNote` is a no-op unless the date+class gate passes; invalid `ASK_GEMINI_TIER_CUTOFF` → default cutoff; idempotent (skip if marker already present). The fallback control flow and the workspace-trust path are untouched.

## Testing

- **Classifier units:** each class maps correctly; `403`/`PERMISSION_DENIED` → `tierAccess`; `RESOURCE_EXHAUSTED` → `quota`; timeout/parse → `operational`; word-boundary (e.g. `"401"` in a path segment doesn't false-match where avoidable).
- **Formatter units:** pre-cutoff → unchanged even for tierAccess/quota; post-cutoff + tierAccess → prepended note; post-cutoff + quota → prepended; post-cutoff + operational → unchanged; idempotent (no double-prepend); UTC boundary; invalid env cutoff → default.
- **Executor catch-flow integration** (mock `executeCommand`): workspace-trust unchanged; **pre-cutoff quota still triggers Flash fallback**; post-cutoff Pro-quota + Flash-quota → note appears **once**; post-cutoff Pro-quota + Flash-**timeout** → **no** note; post-cutoff **raw auth (401/403)** → note **and asserts Flash fallback was NOT invoked**; post-cutoff raw parse/timeout → no note; `ASK_GEMINI_TIER_CUTOFF` override; invalid env.
- **No live smoke possible** (can't trigger the real backend cutoff). Manual verification path: `ASK_GEMINI_TIER_CUTOFF=2020-01-01` forces "post-cutoff" — run a gemini call that 401/403s and confirm the prepended note.

## Out of scope (explicit)

Antigravity (`agy`) provider/executor; CI version-pin against the last free-tier gemini-cli; ask-llm-mcp degraded-probe; sponsorship copy. **Separate finding (own issue):** `gemini-3.5-flash` (the configured `MODELS.FLASH`) returned `404 ModelNotFoundError` during this session's live test while `CLAUDE.md` documents `gemini-3-flash-preview` — a possible fallback-model misconfiguration to verify and file independently of #140.

## Review provenance

- **Codex** (`gpt-5.x`, 19k tokens): caught the **composed-string false-positive** at `:584`; proposed classify-from-format; UTC cutoff; idempotency; executor-level tests.
- **Gemini** (`gemini-3-flash-preview`): **prepend not append** (buried-lead UX); prioritize **`403`/`PERMISSION_DENIED`**; the **Antigravity caveat belongs in the error message**, not just docs; narrow fallback trigger so auth doesn't waste a Flash call.
- Both independently demanded `403`/`PERMISSION_DENIED` and a UTC cutoff. Combined, the design is materially stronger than after a single review — the multi-LLM "debate the plan" workflow doing its job. (Gemini Pro `gemini-3.1-pro-preview` was `429 MODEL_CAPACITY_EXHAUSTED` server-side during the session; the critique ran on `gemini-3-flash-preview`.)
