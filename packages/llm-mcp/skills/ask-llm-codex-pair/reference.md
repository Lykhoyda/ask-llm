# Codex pair reference

The hook surfaces HIGH and MED concerns to Claude on the next turn and logs everything to `.codex-pair/log.jsonl`. The hook details below describe Claude Code; use the host adapter for other lifecycles.

## When to use this vs `/codex-review`

The decision is about **code characteristics**, not project domain. Any project — payments, infra, parsers, plugins, this very repo — has both kinds of code; the recall-first hook earns its keep wherever there's a category of bug that "looks fine but runs wrong."

| Use `/codex-review` (precision-first) | Use codex-pair (recall-first) |
|---|---|
| Routine PR review | Code with hidden invariants the model can't infer from one file |
| Glue code, simple CRUD, refactors | Code where latent bugs cost more than per-edit review |
| You want one comprehensive report | Code evolving fast under written constraints (spec, protocol, ADR) |
| You're cost-sensitive | State coordination, concurrency, anything order-sensitive |
| Default for everything | The "looks fine, runs wrong" failure mode would be expensive to catch later |

## How to enable it

**Per-project opt-in.** Create a file named `.codex-pair/context.md` in your project root with project context for the reviewer:

```markdown
# .codex-pair/context.md

This is a payment-processing service. All currency calculations must use
integer cents internally (floating-point loses precision on every charge).
Concurrent requests are real. URL inputs are untrusted.

[Add domain invariants Codex can't infer from one file in isolation.
Examples —
 Security: "all routes check user.role before any state read".
 Specs: "protocol XYZ frame format must include version byte".
 State: "cart syncs to localStorage on every mutation".
 Concurrency: "this handler must be idempotent under retry".]
```

The hook is always loaded by the plugin, but **self-gates on this file's presence**. No file → silent no-op (zero codex calls, zero cost). File present → every Edit/Write/MultiEdit triggers a codex review.

The marker file's *presence* is the switch; its *content* is the context codex needs to review intelligently. One artifact, two purposes.

**Keep `.codex-pair/` out of git** — gitignore it. The marker is per-developer opt-in: each contributor's review context is their own (model preference, severity threshold, project rules they care about). One developer iterating on prompt wording shouldn't dirty the shared history. The hook itself is project policy (it ships in the plugin); the marker is the per-developer activation switch. Per [ADR-092](../../../../docs/DECISIONS.md), every state artifact (marker, log, cache, ignore globs, pause sentinel, inflight locks) nests under the single directory, so one `.gitignore` line covers everything — including any future state files added later:

```
.codex-pair/
```

To onboard a new contributor, point them at this skill (or `apps/docs/plugin/hooks.md`) to write their own marker — or share a template via a separate (committed) `.codex-pair.example/context.md` they can copy and tweak locally.

## How to pause or disable

| Goal | How |
|---|---|
| Temporarily for this project (keep marker, keep project context) | `/codex-pair-pause` (resume with `/codex-pair-resume`) |
| Per-file/per-directory | Add patterns to `.codex-pair/ignore` (gitignore-style globs) |
| Permanently for this project | `rm -rf .codex-pair/` |
| Just this session | `/plugin disable ask-llm` |
| Just this command | `CODEX_PAIR_DISABLED=1 <whatever command>` |

`/codex-pair-pause` writes a `.codex-pair/state/paused` sentinel that the hook checks on every Edit/Write/MultiEdit; while present, the hook exits silently with a `verdict:"skipped"` log entry naming the pause. `/codex-pair-resume` removes the sentinel (and the consecutive-failure counter, so a resumed project doesn't re-pause on the next single failure). The pause is per-project and per-developer — the single `.codex-pair/` gitignore entry already covers the sentinel (and every other state file) per [ADR-092](../../../../docs/DECISIONS.md).

**Auto-pauses self-heal** (2026-07-02 design): a quota auto-pause expires after `CODEX_PAIR_QUOTA_PAUSE_TTL_MS` (default 6h); a failures auto-pause expires after `CODEX_PAIR_FAILURES_PAUSE_TTL_MS` (default 24h) or immediately when the plugin version changed since the pause was written. Expiry is checked at SessionStart (with a reminder or auto-resume notice injected into context) and on every edit. Manual pauses never auto-expire.

## Behavior when active

```
Claude edits src/billing/charge.ts
        │
        ▼
  PostToolUse hook fires
        │
        ├─ Walk up from cwd looking for .codex-pair/context.md
        │
        ├─ NOT FOUND → exit silently (no codex call, no log)
        │
        └─ FOUND → read marker content as project context
                   ▼
                   Run codex review with HIGH/MED/LOW grading
                   ▼
                   Surface HIGH+MED to stderr (Claude reads next turn)
                   ▼
                   Log every call to .codex-pair/log.jsonl (incl. NONE verdicts)
```

## Cost characteristics

See [Codex Pair cost characteristics](https://lykhoyda.github.io/ask-llm/advanced/codex-pair#cost-characteristics) for usage, file-size handling, and caching.

## Output format

When codex surfaces concerns to Claude, they appear as system reminders on the next turn, prefixed with `[codex-pair]` and the file path. The full per-call log (including PASS verdicts and timing) is in `.codex-pair/log.jsonl` alongside the marker.

Example concern surface:

```
[codex-pair] src/billing/charge.ts

[HIGH] Monetary values are modeled as floating-point numbers
src/billing/charge.ts:12: `price` accepts arbitrary JS numbers for money,
which violates the stated requirement that currency uses integer cents.
Use integer minor units such as `priceCents: z.number().int().nonnegative()`.
```

## Configuration and evidence

Read the docs site for [configuration knobs and marker overrides](https://lykhoyda.github.io/ask-llm/advanced/codex-pair#configuration-knobs), [Stop gate behavior](https://lykhoyda.github.io/ask-llm/advanced/codex-pair#stop-gate-opt-in), and [benchmark evidence](https://lykhoyda.github.io/ask-llm/advanced/codex-pair).
