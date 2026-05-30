# Upstream-Issue Consolidation & Fix Roadmap (2026-05-30)

> **For agentic workers:** Each story block below is executed live with TDD (write failing test → run → implement → pass → `/multi-review` → smoke). Steps use checkbox (`- [ ]`) syntax for tracking. This doc is the canonical Roadmap and task tracker for draining the 21-issue backlog.

**Goal:** Consolidate the 21 open GitHub issues into 5 actionable story blocks, fix every actionable item with a `/multi-review` gate per fix and a smoke-test gate per block, and close each issue via its fix PR.

**Architecture:** The backlog is 19 self-authored "upstream-CLI audit" check-ins (a process artifact, not user bugs) + 2 codex-pair feature reports. Most "breakages" the audits cite are already shipped; the genuine open work is a small set of root-cause defects verified directly against the executors/constants. We fix by root cause, not by audit.

**Tech stack:** Yarn workspaces monorepo, TypeScript ESM (Node16), Vitest, Biome. Providers: `gemini` CLI 0.44.1, `codex` CLI 0.135.0.

**Review/smoke tooling:** `/multi-review` is driven via the built plugin binaries `node packages/claude-plugin/dist/run.js` (gemini) + `codex-run.js` (codex), piping the diff. Smoke = `yarn build && yarn smoke` (+ targeted `yarn test`).

---

## Issue routing (21 → 5 blocks + drained)

| Disposition | Issues | Action |
|---|---|---|
| **Block 1 · Parser defensiveness** | #57, #114, #116, #117 | fix → PR `Closes` |
| **Block 2 · Quota/fallback freshness** | #127, #131 | fix → PR `Closes` |
| **Block 3 · Flag/contract cleanup** | #37, #38, #52, #75 (#54 → not planned) | fix → PR `Closes`; #54 closed (infeasible `--ignore-env`) |
| **Block 4 · Capability adoption** | #59, #102 | fix → PR `Closes` |
| **Block 5 · codex-pair reliability** | #74, #96 | fix → PR `Closes` |
| **Close now — verified already shipped** | #27, #35 | close `completed` (refs below) |
| **Close now — pure audit-cadence noise** | #24, #25, #28, #39 | close `not planned` (folded here) |

**Verified-shipped refs (for closing #27/#35):**
- Gemini workspace-trust env: `geminiExecutor.ts:421-424` co-emits `GEMINI_CLI_TRUST_WORKSPACE` (≥0.42) + `GEMINI_TRUST_WORKSPACE` (≤0.41), tested `geminiExecutor.test.ts:725-812`. (#27)
- Codex reasoning tokens: `codexExecutor.ts:65,77` maps `reasoning_output_tokens`→`thinkingTokens`, tested `codexExecutor.test.ts:173-216`. (#35)

---

## Block 1 · Parser event-coverage defensiveness  (Tier C — #57, #114, #116, #117)

**Defect:** Both JSONL/stream-json parsers use `if`-chains with no default branch, so new upstream event types fall through silently. Verified: `codexExecutor.ts` handles only `thread.started`/`item.completed`/`turn.completed`/`error` — **no `turn.failed`**; the `error` branch stringifies the whole event instead of preferring `parsed.message` (breaks `isQuotaError()`); `geminiExecutor.ts` streaming parser handles `init`/`message`/`result`/`error` with **no default branch**.

**Files:** `packages/codex-mcp/src/utils/codexExecutor.ts`, `packages/gemini-mcp/src/utils/geminiExecutor.ts`, tests in each package's `utils/__tests__/`, `scripts/smoke-test.sh`.

- [x] **1a · codex `turn.failed`** — `CodexTurnFailed` branch extracts `error?.message` (`codexExecutor.ts`); failed/quota turns now propagate + trigger fallback. Tests: "throws on turn.failed", "falls back when a turn.failed event carries a quota signal".
- [x] **1b · codex `error` `.message` extraction** — `error` branch prefers `parsed.message` over `JSON.stringify`. (Verified the audit's "breaks isQuotaError" claim was overstated; real gap was 1a. This is the clean-error-message fix.) Test: "surfaces the error event's message field".
- [x] **1c · gemini default branch** — `RECOGNIZED_STREAM_EVENT_TYPES` set + `Logger.debug` for unknown types (`geminiExecutor.ts`). Test: "logs unrecognized stream-json event types".
- [~] **1d · pin versions** — **skipped**: a hard CLI-version gate in `scripts/smoke-test.sh` would make CI brittle; the live smoke gate already exercises the real CLIs. (audit hygiene, not a defect)
- [x] **Gate:** codex 49 / gemini 109 green → `/multi-review` clean (both providers, 0 findings) → live smoke green (22.6s gemini / 10.4s codex) → PR `Closes #114 #116 #117 #57`.

## Block 2 · Quota / fallback freshness  (Tier G — #127, #131)

**Defect:** Quota detection is a frozen substring list and the Flash fallback is a frozen model literal, so the safety net rots. Verified: codex `QUOTA_SIGNALS = ["rate_limit_exceeded","quota_exceeded","429","insufficient_quota"]` (`constants.ts:2`) — missing workspace credit / spend-cap strings; gemini `FLASH` default still `gemini-3-flash-preview` (`constants.ts:32`) with the preview model also hardcoded in `QUOTA_EXCEEDED_SHORT` (`constants.ts:9`) — GA `gemini-3.5-flash` exists.

- [x] **2a · codex quota signals** — added lowercase `out of credits` + `spend cap` to `QUOTA_SIGNALS` (covers all 4 codex-0.134 workspace usage-limit messages); 2 tests assert credit/spend-cap errors trigger the `gpt-5.5-mini` fallback.
- [x] **2b · gemini Flash → GA** — `FLASH` default + `QUOTA_EXCEEDED_SHORT` → `gemini-3.5-flash`; `ASK_GEMINI_FALLBACK_MODEL` override preserved; current-state docs (README + apps/docs) updated (historical CHANGELOG/DECISIONS left intact); tests pin the new default. **GA model name validated live** (`gemini -m gemini-3.5-flash` exit 0).
- [x] **2c · fallback semantics** — characterization test confirms `usage.fellBack === true` after a Flash fallback is intact (no code change needed; this *verifies* #116's concern).
- [x] **Gate:** codex 48 / gemini 109 green → `/multi-review` clean (both providers confirmed the new substrings are tighter than the existing `429` signal) → live smoke green (gemini 112 / codex 51) → PR `Closes #127 #131`.

## Block 3 · Flag / contract drift cleanup  (#37, #38, #52, #54, #75)

**Defect (LIVE BUG):** the executor migrated `--full-auto` → `--sandbox workspace-write`, but `packages/claude-plugin/agents/brainstorm-coordinator.md:71,97` **still spawns `codex exec --full-auto`** — a no-op trap on codex ≥0.128 that silently drops the workspace-write sandbox. Plus two cheap guards.

- [x] **3a · kill `--full-auto`** in `brainstorm-coordinator.md:71,97` → `codex exec --sandbox workspace-write` (codex 0.135 *removed* the flag → it was erroring, not just degrading; logged in BUGS.md). Stale `apps/docs/providers/codex.md` corrected. Grep-guard test asserts no agent ships `--full-auto`. **Validated live** (`codex exec --sandbox workspace-write -` exit 0).
- [x] **3b · `-m` guard** — model-pinning guard tests assert args always include `-m <model>` (codex + gemini); removed dead unused `CLI.DEFAULTS.MODEL` (#75's latent-risk cleanup, confirmed 0 usages repo-wide).
- [~] **3c · gemini `--ignore-env`** — **deferred**: the flag does not exist in gemini 0.44.1 (`gemini --help` has no ignore/env flag). Won't add a nonexistent flag.
- [x] **Gate:** plugin 330 / codex 49 / gemini 111 green → `/multi-review` clean (Gemini 100, Codex 95 — verified the invocation vs codex-cli 0.135.0) → live smoke green (gemini 114 / codex 52) → PR `Closes #37 #38 #52 #75`. **#54 closed not-planned** (its only concrete item was `--ignore-env`, infeasible; rest speculative).

## Block 4 · Capability adoption  (Tier E — #59, #102)

**Defect:** upstream features not yet adopted. `ask-codex-edit` via codex `--output-schema` on `exec resume` is the top cross-audit unblock (mirrors `ask-gemini-edit` changeMode, reuses `@ask-llm/shared` chunker). NOTE: `ask-codex-edit` is design-heavy — **brainstorm before implementing.**

- [ ] **4a · `ask-codex-edit`** via `codex exec --output-schema` (brainstorm design first).
- [ ] **4b · codex `--add-dir`** parity with gemini `--include-directories`.
- [ ] **4c · `codex doctor` hint** in the fallback-failure error (`codexExecutor.ts:~212`).
- [ ] **4d · surface codex `reasoning`/`error` item types** in output; **4e · bump documented min codex version**.
- [ ] **Gate:** tests → `/multi-review` per item → smoke → PR(s) `Closes #102 #59`.

## Block 5 · codex-pair reliability  (Tier D+F — #74, #96)

**Defect:** codex-pair's review signal fails to reach the consumer. #96 Bug 1: next-turn `[codex-pair]` systemMessage never surfaces (verified surfacing path at `codex-pair-watch.mjs:188`). #96 Bug 2: reviews fire on intermediate file states (verify ADR-087/088 debounce covers it). #96 Enh 2: compact verdict-count header. #74: hook not auto-invoked after install — Claude Code session-state limitation, doc-only.

- [ ] **5a · #96 Bug 1** — diagnose + fix next-turn surface emission (repro from issue body first; this is an existing `BUGS.md` entry).
- [ ] **5b · #96 Bug 2** — verify debounce resolves intermediate-state reviews; if not, per-file settle timer.
- [ ] **5c · #96 Enh 2** — verdict-count header in `buildVerdictMessage` (gated on 5a).
- [ ] **5d · #74** — document full-restart-after-install in plugin install instructions; close.
- [ ] **Gate:** tests → `/multi-review` → smoke → PR `Closes #96 #74`.

---

## Self-review (spec coverage)

Every one of the 21 issues maps to a block or a close-now bucket (table above). The two design-heavy items (`ask-codex-edit`) are flagged for brainstorming before code. Each block has a `/multi-review` gate per fix and a `yarn build && yarn smoke` gate before its PR. Internal-doc obligations per CLAUDE.md: `ROADMAP.md` updated to point here; `DECISIONS.md` gets ADR-109 (this consolidation); `BUGS.md` gets the live `--full-auto` bug (Block 3a).
