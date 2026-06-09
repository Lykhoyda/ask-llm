# codex-pair Stop-gate (MVP) — Design

**Date:** 2026-06-09
**Issue:** [#142](https://github.com/Lykhoyda/ask-llm/issues/142) — codex-pair is advisory-only; HIGH findings can be silently ignored.
**Status:** Design (brainstormed; refined with an external critique from Antigravity / Gemini 3.5 Flash).
**Relationship:** Complements ADR-096 (in-turn repetition escalation) with a hard turn-end boundary. Re-introduces a `Stop` hook that ADR-048 removed — but on a fundamentally different mechanism (see §7).

---

## 1. Problem & goal

codex-pair reviews every edit (`PostToolUse`) and appends findings to `<project>/.codex-pair/log.jsonl`. The findings are **advisory only** — in a long session, HIGH findings get silently ignored (issue #142's field repro: ~250 HIGH log lines, none engaged with during the session).

**Goal (MVP):** make HIGH findings *un-ignorable* by blocking the agent from ending a turn while unaddressed HIGHs remain — **without** re-creating the failures that got the old Stop hook removed (ADR-048: per-turn latency, quota burn, untracked-file blind spot, surprise blocking).

## 2. Locked decisions (from brainstorming)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | **MVP only** | Ledger / significance-gating / debounce are follow-up ADRs. |
| Posture | **Opt-in, default OFF** (`blockOn: HIGH`) | No surprise blocking for existing users (ADR-048 lesson); the issue frames `blockOn` as opt-in; a blocking gate is `kano:reverse` for some → make opt-out. |
| Ack identity | **content hash**, file-scoped | Reuses `hashConcernBody` (shared with ADR-096); file-scoping avoids collisions (§4, flaw E). |
| Gate source | **log-derived**, reconciled against present reality | The log records every edited file (no `git diff` untracked blind spot), but must be reconciled (§3) because a file's status changes via channels the log never sees. |

## 3. Gating algorithm

The Stop hook runs at every turn-end. Core principle: **the `log.jsonl` is an append-only memory of edits, not a live view of current state** — so before gating, reconcile each logged file against present reality (does it exist? is it clean vs HEAD? was the last review even valid?).

```
Stop hook fires (stdin = Stop payload):
  # Fast-path exit (cheap, sync, before heavy imports) — §6
  markerDir = findMarkerUp(cwd)            # walk up for .codex-pair/
  if !markerDir: exit 0 (allow)
  blockOn = parseFrontmatter(context.md).blockOn
  if blockOn !== "HIGH": exit 0 (allow)    # opt-in gate

  # Build candidate set from the log
  entriesByFile = group(readLogJsonl(markerDir), by .file, keep latest per file)

  # Reconcile against present reality
  gitDirty = parseGitPorcelain(`git status --porcelain` in repo)   # set of modified+untracked paths; null if not-a-repo/git-missing
  blocking = []
  for (file, latest) in entriesByFile:
    if !existsSync(file): continue                       # [A] deleted/renamed → drop
    if latest.verdict in {error, skipped, retried, broker_fallback}:
        continue                                         # [C] indeterminate latest → fail-open for this file (do NOT fall back to stale history)
    if gitDirty !== null and file not in gitDirty: continue   # [B] clean vs HEAD (reverted/branch-switched) → drop
    for h in latest.concerns.high:
        key = hashConcernBody(relPath(file) + ":" + h)   # [E] file-scoped ack identity
        if key not in acks: blocking.push({file, h, key})

  if blocking.empty: exit 0 (allow)
  else: print JSON {"decision":"block","reason": formatBlockMessage(blocking)}; exit 0
```

### Edge cases resolved (from the Antigravity critique)

- **[A] Deletion/rename trap.** A file flagged HIGH then deleted is never re-reviewed, so its latest log entry stays HIGH forever → would block on a non-existent file. **Fix:** skip files where `!existsSync(file)`.
- **[B] Git revert / branch-switch over-gating.** `git checkout -- <file>` / branch switch doesn't fire `PostToolUse`, and `.codex-pair/` is gitignored so the log persists across branches → blocked on a clean workspace. **Fix:** `git status --porcelain` as a *subtractive filter* — drop files that are clean vs HEAD. This is **not** ADR-048's mistake: porcelain lists untracked files (`??`) too, so there is no untracked blind spot; it is an *additional* filter on log-derived candidates, not the primary scope. If not in a git repo (or git missing), the filter is skipped (the existence + log checks still gate).
- **[C] Transient error blocks the fix.** You edit to fix a HIGH, but the review rate-limits/times-out → a new `error`/`skipped` entry lands. The naïve "latest *real* entry" rule would skip back to the prior HIGH and block despite the fix. **Fix:** if the *latest* entry for a file is indeterminate (`error`/`skipped`/`retried`/`broker_fallback`), treat the file as indeterminate and **fail-open for that file** — do not fall back to historical states.
- **[E] Global ack collision.** Two files with identical concern text (e.g. `"Unused import 'useState'"`) produce the same `hashConcernBody(text)`; one ack silently suppresses a real HIGH elsewhere. **Fix:** key acks on `hashConcernBody(relPath + ":" + concernText)`.
- **[D] Cross-file fix + cache staleness (documented).** A HIGH in File A fixed by editing File B leaves A's latest entry `concerns`; touching A hits the 10-min cache → re-logs the same HIGH as `cached`. **MVP:** the block message advises making a real edit to A (or that a future `--no-cache` ack-clear is deferred).
- **[F] LLM wording drift (documented).** A re-review may reword the same issue → new hash → ack bypassed → re-block. **MVP:** accept (re-ack), document the limitation; text-normalization before hashing is deferred.

## 4. Components

1. **`scripts/codex-pair-stop-gate.mjs`** — the Stop hook. Reads the Stop payload from stdin, runs the algorithm, prints the block JSON or exits 0.
2. **`scripts/lib/stop-gate.mjs`** — pure, unit-testable functions: `selectLatestEntries(logLines)`, `reconcile(entries, {existsFn, gitDirty})`, `collectUnackedHighs(entries, acks)`, `formatBlockMessage(blocking)`. No I/O — the hook injects `existsSync`/git output so tests are deterministic.
3. **`scripts/lib/state.mjs`** — add `acksPath(markerDir)`, `readAcks(markerDir)`, `addAck(markerDir, key, {reason})`. (Reuses the existing `.codex-pair/state/` dir.)
4. **`skills/codex-pair-ack/SKILL.md`** — `/codex-pair-ack <hash> "<reason>"` (modeled on `codex-pair-pause`): walk up for the marker, append to `acks.json`.
5. **`hooks/hooks.json`** — add a `Stop` block referencing `${CLAUDE_PLUGIN_ROOT}/scripts/codex-pair-stop-gate.mjs`.
6. **`.gitignore`** — `acks.json` lives under the already-ignored `.codex-pair/` (per-developer, like the marker).

## 5. Block message format

```
🚫 codex-pair: 2 unaddressed HIGH finding(s) (blockOn: HIGH). Fix them, or defer each with /codex-pair-ack.

  [a1b2c3] src/auth.ts
    onSubmit awaits the RTK Query mutation without .unwrap() — failures are treated as success.
  [d4e5f6] src/screens/Delete.tsx
    navigation.replace() runs after a swallowed .catch() — failed deletes look successful.

To defer a finding (stale / pre-existing / out-of-scope):
  /codex-pair-ack a1b2c3 "pre-existing, tracked in #88"

(If you fixed a finding by editing a DIFFERENT file, make a real edit to the flagged file so it gets re-reviewed — an identical re-touch hits the review cache.)
```

## 6. Performance & error handling

- **Fast-path exit.** The hook runs every turn-end. Before importing heavy modules (parsers, zod), do the cheap sync checks: marker present? `blockOn: HIGH`? If not → `exit 0`. Only then load the gate logic. Target `<100ms` even when active (local file reads + one `git status` subprocess; **no LLM calls**).
- **Fail-open, always & loudly.** Any error (missing/corrupt log, parse failure, git error) → emit a visible warning to **stderr** and `exit 0`:
  `[codex-pair] WARNING: stop-gate failed (<error>). Allowing turn end — HIGH findings may remain.`
  A gate that blocks turns on its *own* bug is worse than no gate (ADR-048 humility).

## 7. Why this is not the ADR-048 Stop hook

| ADR-048 (removed) | This gate |
|-------------------|-----------|
| Ran a **fresh `gemini -p` review** every Stop → 5–20 LLM calls/session, 60s/turn latency, quota burn | **Zero LLM calls** — reads already-logged findings + one local `git status` |
| `git diff HEAD` **silently skipped untracked files** (false coverage) | Log-derived candidates (covers untracked) + `git status --porcelain` (lists `??`) |
| **Unsolicited** per-turn blocking | **Opt-in** (`blockOn: HIGH`), default OFF |
| Per-turn firing was a *bug* for "session review" | Per-turn firing is the *desired* semantic for a per-turn gate |

ADR-048 explicitly left the door open: *"If a future Claude Code version exposes a true SessionEnd event, the feature can be reintroduced cleanly."* SessionStart/SessionEnd now exist (ADR-090/093); this gate uses `Stop` deliberately because the goal is to gate *each turn*, not the session.

## 8. Testing

- **Config consistency** (`manifest.test.ts`): `hooks.json` declares a `Stop` hook → `${CLAUDE_PLUGIN_ROOT}/scripts/codex-pair-stop-gate.mjs`; the script exists; `/codex-pair-ack` skill has valid frontmatter (name matches dir, description present, `user_invocable: true`). Add `codex-pair-ack` to `skills-and-agents.test.ts` expected-skills.
- **Unit** (`stop-gate.test.ts`, pure functions, no live codex): latest-entry selection; **[C]** indeterminate latest → file dropped (no fallback to stale HIGH); **[A]** missing file dropped (injected `existsFn`); **[B]** clean-vs-HEAD dropped, dirty/untracked kept (injected git-porcelain set); **[E]** file-scoped ack matching (same text on two files → independent acks); `blockOn` parse (HIGH gates, none/unset advisory); empty/corrupt log → no block; block-message formatting.
- **No SMOKE-gated live tests** — the gate reads logs only.

## 9. Explicitly out of scope (follow-up ADRs)

`open.json` open-findings ledger with auto-close on reconcile; edit-significance gating (skip whitespace/import/i18n); debounce-to-quiescence; MED/LOW gating; default-ON posture; concern-text normalization for drift (F); `--no-cache` ack-clear for cross-file fixes (D).
