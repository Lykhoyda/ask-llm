# Claude Routines

Reusable prompts for scheduled / on-demand Claude agents that maintain this repo.
Each routine is read-only investigation unless stated otherwise; wire via `/schedule`.

---

## Upstream-CLI drift tracker

**Purpose:** Track new releases of the CLIs this monorepo wraps (gemini-cli, codex,
agy, ollama) and report anything that breaks us or could improve us. Files a GitHub
issue **only on actionable findings** — otherwise records an audit note on the rolling
tracker (#139) so runs are auditable without recreating backlog noise (ADR-109 lesson).

**Scope:** read-only investigation + issue/comment creation only. Do NOT modify code or open PRs.

```
Dependency & upstream-CLI drift tracker (read-only investigation → issue ONLY on actionable findings)

1. CHECK NEW VERSIONS (record delta last-checked → latest per CLI):
   - gemini-cli: npm @google/gemini-cli + GitHub releases/CHANGELOG (google-gemini/gemini-cli)
   - codex: npm @openai/codex + GitHub releases (openai/codex)
   - antigravity (agy): GitHub releases (google-antigravity/antigravity-cli) — we now ship @ask-llm/antigravity-mcp
   - (optional) ollama: GitHub releases (ollama/ollama)
   Persist last-checked versions in rolling tracker issue #139 so each run is incremental.

2. MAP EACH CHANGE TO OUR CODE, classify BREAKING / IMPROVEMENT / NO-IMPACT.
   Changelogs are SECONDARY sources — verify every claim against the actual files (ADR-109):
   - gemini → packages/gemini-mcp/src/constants.ts (MODELS, CLI.FLAGS, OUTPUT_FORMATS, QUOTA/TIER/WORKSPACE_TRUST patterns) + utils/geminiExecutor.ts (stream-json event types, fallback)
   - codex  → packages/codex-mcp/src/constants.ts (MODELS, CLI.FLAGS, QUOTA_SIGNALS, ARCHIVED_SESSION_SIGNALS) + utils/codexExecutor.ts (JSONL event types)
   - agy    → packages/antigravity-mcp/src/constants.ts (CLI.FLAGS, OUTPUT_FORMATS, SLASH_COMMANDS_FLAG_MIN_VERSION) + utils/antigravityExecutor.ts (JSON envelope keys: response, usage.*_tokens, error)
   For flag checks, inspect every nested subcommand with its OWN help output (for example,
   `codex exec resume --help`, not only `codex exec --help`): child grammars may be narrower than parents.

3. BREAKING = any of: a flag we pass is removed/renamed (e.g. -p, --output-format, --json, --add-dir,
   --resume, --sandbox, --dangerously-skip-permissions); output shape change (JSON keys, JSONL/stream
   event types, new terminal events); default/fallback model renamed or removed (would 404); auth/quota
   error strings changed (breaks detection/fallback); min Node bump; for agy, a JSON envelope key
   change (response / usage / error) in --output-format json.

4. WATCH-LIST (flag immediately if RESOLVED — they un-gate work):
   - (retired 2026-08-04, #251: agy --output-format json adopted; transcript scraping deleted. The
     former #27466/#7 trigger fired — headless resume via conversation_id remains follow-up work.)
   - gemini-cli 2026-06-18 consumer cutoff: any change to API-key / enterprise behavior or error strings.

5. IMPROVEMENT = a new flag/capability we should adopt (e.g. a new model or a faster mode). List
   separately from breaking. Do not stop at "is our pinned model still
   valid?" — enumerate each provider's CURRENT model catalog every run (ai.google.dev/gemini-api/docs/models,
   OpenAI's model list, `agy models`) and diff it against our pinned defaults/fallbacks: a newly launched
   sibling model (newer/cheaper tier alongside our pin) is an IMPROVEMENT finding even when the pin still
   resolves (#244 — the 2026-07-23 run missed gemini-3.6-flash because it only checked the pin).

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
- The former watch-list un-gate trigger for `@ask-llm/antigravity-mcp` fired in #251 (structured
  output adopted, transcript scraping deleted); only the headless-resume follow-up remains open.
- Verification discipline (§2) follows ADR-109 — treat release notes as claims to confirm against
  our executor/constants, not as ground truth.
