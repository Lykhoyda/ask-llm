---
name: multi-review
description: This skill should be used when the user asks to "review my code with multiple providers", "get reviews from Antigravity and Codex", "multi-provider review", "review changes", or wants independent code reviews from both Antigravity and Codex in parallel.
user_invocable: true
---

# Multi-Provider Code Review

Run independent code reviews from Antigravity and Codex in parallel, **verify** each finding against the source, then present combined consensus / unique / rejected sections so the user sees what really matters and what was a false positive. (Gemini is one command away via the `gemini-reviewer` agent or `/gemini-review` if you want it in the mix.)

## Why verification matters

Confidence scores are not an oracle. In a real session on 2026-04-17, Gemini returned two findings at 95/100 confidence that were factually wrong (a `z.enum([])` claim that ignored an existing fallback, and an "MCP SDK doesn't support outputSchema" claim that was contradicted by the actual `.d.ts`). Both would have caused a mis-fix if accepted at face value. **Always verify before presenting.**

## Two kinds of verification — pick the right skill

This skill verifies **review findings** — the bugs each provider claims it found. Phase 3 reads the file at the cited line and checks whether each finding is real before presenting it.

That is different from verifying **assistant claims** — the statements the assistant made in its prior turn ("I added retry logic," "I bumped the threshold to 16384"). For that, use `/codex-verify`. It dispatches the `codex-verifier` agent, decomposes the assistant's last message into atomic claims, and proves or disproves each with deterministic evidence. It returns a CONFIDENCE grade on a five-point ladder (`PERFECT | VERIFIED | PARTIAL | FEEDBACK | FAILED`) — `PARTIAL` and `FAILED` are first-class verdicts, surfacing gaps in your verification harness rather than hiding them under a confident-looking number.

| Question | Skill |
|---|---|
| "Are there bugs in this diff?" | `/multi-review` (finds new issues, verifies each finding before presenting) |
| "Did the assistant actually do what it claimed?" | `/codex-verify` (decomposes the assistant's claims, proves each against state) |

The two skills compose. Run both when you want both questions answered; do not merge their outputs.

## Instructions

### Phase 1: Gather and prepare the diff

1. Get the working-tree state:
   - `git status --short` to see what's modified/added/deleted
   - For untracked files the user wants reviewed, run `git add -N <files>` so they appear in `git diff` (intent-to-add)
   - Combine `git diff` (unstaged) and `git diff --cached` (staged) into a single diff

2. **Filter the diff** — exclude noise that providers don't need:
   - Pathspec exclusions: `:!docs/` `:!apps/docs/` `:!*.md` `:!yarn.lock` `:!*.lock` `:!*.png` `:!*.jpg` `:!*.svg`
   - Example: `git diff -- ':!docs/' ':!*.md' ':!yarn.lock'`
   - The user's own ADR/docs additions are not what they want providers to review

3. **Size-check the diff:**
   - Measure: `wc -c diff.patch`
   - **< 50KB**: send as-is
   - **50–150KB**: warn the user "this is a large diff, providers may take 5–15 min" and continue
   - **> 150KB**: tell the user, ask whether to truncate (head -c 150000) or split by package, do NOT silently send a giant payload
   - **Empty**: stop and inform the user "no changes to review"

4. **Create a Context Brief** — a compact manifest that makes the handoff reproducible. Put it before the diff in every reviewer prompt; do not use it as an excuse to paste more raw files by default.

```markdown
## Context Brief

Intent:
- User request:
- Review mode: multi-review
- Providers: <list the actual providers selected for this run>

Scope:
- Base ref:
- Changed files:
- Included files/docs:
- Excluded files/docs and reason:
- Diff bytes:

Repository signals:
- Relevant package/workspace:
- CLAUDE.md files read:
- ADRs/docs read:

Risk focus:
- Security:
- Data loss:
- Concurrency/state:
- API/contract:
- Tests/build:

Open questions:
- Items not verified before dispatch:
```

Keep the brief tiny for simple diffs. Escalate detail when the diff is over 50KB, spans more than 5 files, crosses package boundaries, includes untracked files, references ADRs/specs, or depends on conversation context the external providers cannot see.

### Phase 2: Dispatch (with fallback)

**Preferred: launch both reviewer agents in parallel** using the Agent tool in a single message:
- `antigravity-reviewer` agent with the Context Brief + diff content
- `codex-reviewer` agent with the Context Brief + diff content
- Each agent performs its own multi-phase pipeline: Context → Prompt → Validation → Report

> `antigravity-reviewer` requires `agy` installed + logged in and the Antigravity MCP server registered. If it's unavailable it will say so — present the codex-only result and note "antigravity skipped (agy not available)" rather than failing the whole review. To include Gemini instead/as well, also launch the `gemini-reviewer` agent.

**Fallback when reviewer agents are unavailable** (e.g., plugin not installed in this Claude Code session): dispatch directly via the project's `dist/antigravity-run.js` and `dist/codex-run.js` runner binaries using the **ADR-050 dispatch pattern** (single foreground blocking Bash call, direct backgrounding, per-PID `wait`, 25-min timeout):

```bash
GMCPT_TIMEOUT_MS=1500000 node ${CLAUDE_PLUGIN_ROOT}/dist/antigravity-run.js "$REVIEW_PROMPT" < diff.patch > /tmp/mr-antigravity.out 2> /tmp/mr-antigravity.err &
agy_pid=$!

GMCPT_TIMEOUT_MS=1500000 node ${CLAUDE_PLUGIN_ROOT}/dist/codex-run.js "$REVIEW_PROMPT" < diff.patch > /tmp/mr-codex.out 2> /tmp/mr-codex.err &
codex_pid=$!

agy_rc=0; wait $agy_pid || agy_rc=$?
codex_rc=0; wait $codex_pid || codex_rc=$?
```

Set the Bash tool's `timeout` parameter to **600000ms** (10-min max). For diffs > 50KB, expect both providers to take real wall time — this is normal.

Do NOT use raw `agy -p`, `gemini -p`, or `codex exec` — those bypass the project's quota/transcript handling, Codex stdin handling (ADR-042), and PATH resolution (ADR-047). Use the runner binaries.

### Phase 3: Verify each finding before presenting

For every finding from either provider at confidence ≥ 80:

1. Read the file at the cited line (use the Read tool)
2. Check whether the claim is actually true:
   - "X function doesn't exist" → verify via Grep
   - "Y line crashes when Z" → trace the actual code path
   - "ADR-NNN is contradicted" → read the ADR
3. Mark each finding as one of:
   - **VERIFIED** — claim holds against source
   - **REJECTED** — false positive (with brief explanation of what the provider missed)
   - **UNVERIFIABLE** — cannot confirm without runtime / external info; present as-is with a note

### Phase 4: Resilient failure handling

When a provider fails (timeout, capacity exhaustion, exit code ≠ 0, 0-byte output):
- Do NOT silently drop it from the synthesis
- Surface the failure inline: "Antigravity failed (exit 1): <first 3 lines of stderr>"
- If both providers failed, say so explicitly and surface both stderr — don't pretend you have findings
- A single-provider review is still useful — present what you have, note what's missing

### Phase 5: Present the synthesis

```markdown
## Multi-Provider Review

**Context used:**
- Included: <files / packages>
- Excluded: <files / patterns and reason>
- Diff bytes: <N>

**Verified by both providers (highest confidence):**
- ⟨finding⟩ — Antigravity: 92, Codex: 88. Verified at <file>:<line>.

**Verified by Antigravity only:**
- ⟨finding⟩ — Confidence 85. Verified at <file>:<line>.

**Verified by Codex only:**
- ⟨finding⟩ — Confidence 90. Verified at <file>:<line>.

**Rejected (false positives caught during verification):**
- ⟨finding⟩ — Provider claimed X at <file>:<line>, but source shows Y. Skipped.

**Unverifiable:**
- ⟨finding⟩ — Cannot confirm without runtime; flagging for user attention.

**Provider stats:**
- Antigravity: ⟨N⟩ findings, ⟨V⟩ verified, ⟨R⟩ rejected. Status: ⟨ok | failed: ⟨reason⟩⟩
- Codex: ⟨N⟩ findings, ⟨V⟩ verified, ⟨R⟩ rejected. Status: ⟨ok | failed: ⟨reason⟩⟩
```

If you have to truncate either provider's response or skip verification due to time pressure, **say so** in the output. Hidden compromises mislead the user.
