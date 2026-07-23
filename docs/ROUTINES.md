# Claude Routines

Reusable prompts for scheduled / on-demand Claude agents that maintain this repo.
Each routine is read-only investigation unless stated otherwise; wire via `/schedule`.

---

## Upstream-CLI drift tracker

**Purpose:** Track new releases of the CLIs this monorepo wraps (gemini-cli, codex,
agy, ollama) and report anything that breaks us or could improve us — **including new
models we should adopt so our skills default to the latest, strongest/cheapest appropriate
model**. Files a GitHub issue **only on actionable findings** — otherwise records an audit
note on the rolling tracker (#139) so runs are auditable without recreating backlog noise
(ADR-109 lesson).

**Scope:** read-only investigation + issue/comment creation only. Do NOT modify code or open PRs.

```
Dependency & upstream-CLI drift tracker (read-only investigation → issue ONLY on actionable findings)

1. CHECK NEW VERSIONS (record delta last-checked → latest per CLI):
   - gemini-cli: npm @google/gemini-cli + GitHub releases/CHANGELOG (google-gemini/gemini-cli)
   - codex: npm @openai/codex + GitHub releases (openai/codex)
   - antigravity (agy): GitHub releases (google-antigravity/antigravity-cli) — we now ship @ask-llm/antigravity-mcp
   - (optional) ollama: GitHub releases (ollama/ollama)
   Persist last-checked versions in rolling tracker issue #139 so each run is incremental.
   Track BOTH the CLI version AND each provider's model catalog (see §5a) — a new model can ship
   independently of a CLI release (e.g. gemini-3.6-flash launched 2026-07-21 with no CLI bump).

2. MAP EACH CHANGE TO OUR CODE, classify BREAKING / IMPROVEMENT / NO-IMPACT.
   Changelogs are SECONDARY sources — verify every claim against the actual files (ADR-109):
   - gemini → packages/gemini-mcp/src/constants.ts (MODELS, CLI.FLAGS, OUTPUT_FORMATS, QUOTA/TIER/WORKSPACE_TRUST patterns) + utils/geminiExecutor.ts (stream-json event types, fallback)
   - codex  → packages/codex-mcp/src/constants.ts (MODELS, CLI.FLAGS, QUOTA_SIGNALS, ARCHIVED_SESSION_SIGNALS) + utils/codexExecutor.ts (JSONL event types)
   - agy    → packages/antigravity-mcp/src/constants.ts (CLI.FLAGS) + utils/transcriptReader.ts (transcript path + entry schema) + utils/antigravityExecutor.ts

3. BREAKING = any of: a flag we pass is removed/renamed (e.g. -p, --output-format, --json, --add-dir,
   --resume, --sandbox, --dangerously-skip-permissions); output shape change (JSON keys, JSONL/stream
   event types, new terminal events); default/fallback model renamed, removed, OR announced-deprecated
   (would 404 — cf. codex gpt-5.5-mini #194); auth/quota error strings changed (breaks detection/fallback);
   min Node bump; for agy, transcript path/schema change (.jsonl → .db).

4. WATCH-LIST (flag immediately if RESOLVED — they un-gate work):
   - gemini-cli #27466 (agy -p empty stdout) + antigravity-cli #7 (headless session id): if fixed,
     @ask-llm/antigravity-mcp self-heals onto stdout and can drop transcript-scraping → high value.
   - gemini-cli 2026-06-18 consumer cutoff: any change to API-key / enterprise behavior or error strings.

5. IMPROVEMENT = a new flag/capability/model we should adopt (e.g. agy gains real --output-format json, a
   new/faster/cheaper model). List separately from breaking.

   5a. NEW-MODEL SWEEP — do this EVERY run. A new model is an improvement even when our current pin still
       resolves (this is the check whose absence let gemini-3.6-flash slip past — #244). Enumerate each
       provider's CURRENT model catalog from an authoritative source and diff it against our pinned MODELS
       constants; our skills should default to the latest, strongest/cheapest appropriate model:
         - gemini → https://ai.google.dev/gemini-api/docs/models          vs  gemini-mcp constants.ts MODELS.PRO / MODELS.FLASH (+ FACTORY_DEFAULT_MODEL, QUOTA_EXCEEDED_SHORT hint)
         - codex  → OpenAI model list / GPT-5.x release notes / `codex --help`  vs  codex-mcp constants.ts MODELS.DEFAULT / PREFERRED / FALLBACK
         - agy    → `agy models` (live, preferred) or antigravity release notes  vs  antigravity-mcp constants.ts MODELS.DEFAULT / FALLBACK
         - ollama → https://ollama.com/library (informational — we don't pin an ollama model)
       When a newer sibling ships (new Flash/Pro/GPT generation, a cheaper tier): (a) file/adopt it as an
       IMPROVEMENT with the concrete constant to change, AND (b) flag the now-older pin as a future-breaking
       WATCH (it may be deprecated → 404). Verify the new id is actually accepted by the CLI we invoke
       (e.g. `gemini -m <id> -p ping`) before recommending the bump — a model can exist in the API but lag
       in the CLI's accepted set.

6. DEDUP before filing: search open issues + rolling tracker #139. If a matching open issue/thread
   exists, COMMENT the new delta — do NOT open a duplicate. Open a NEW issue only for an actionable
   BREAKING or IMPROVEMENT finding.

7. IF NOTHING ACTIONABLE: do NOT create an issue. Append a one-line "checked gemini X / codex Y / agy Z —
   no impact" note to tracker #139 (auditable runs without backlog noise — the ADR-109 lesson).

8. ISSUE FORMAT (when filing):
   - Title: "upstream: <cli> <newver> — <breaking|improvement> affecting <area>"
   - Body: versions checked (old→new per CLI) · verdict · table of `change → file:line → severity →
     recommended action` · improvement opportunities · what you verified against code/tests · labels.
   - Labels: kano:needs-triage + an effort:s|m|l estimate (per docs/KANO-TRIAGE.md).

SCOPE: read-only investigation + issue/comment creation only. Do NOT modify code or open PRs.
```

**Notes**
- The watch-list (§4) doubles as the un-gate trigger for `@ask-llm/antigravity-mcp`: when `#27466`
  closes, the transcript-scraping fallback can be dropped and the `experimental` framing removed.
- Verification discipline (§2) follows ADR-109 — treat release notes as claims to confirm against
  our executor/constants, not as ground truth.
- The new-model sweep (§5a) was added after the 2026-07-23 run classified gemini as "no impact" while
  Gemini 3.6 Flash had shipped two days earlier (#244): the old model check was breaking-only ("is our
  pin renamed/removed?") and never looked for *new* siblings to adopt. Run §5a as a first-class step, not
  a side effect of the version diff — new models often ship without a CLI release.
