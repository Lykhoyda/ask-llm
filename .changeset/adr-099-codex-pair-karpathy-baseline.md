---
"@ask-llm/plugin": patch
---

# ADR-099 — codex-pair Karpathy baseline principles in review prompt

Adds a new `## Baseline review principles` section to the codex-pair
review prompt template at `packages/claude-plugin/prompts/review.txt`,
adapting three diff-evaluable rules from the Karpathy CLAUDE.md
(https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md):

1. **Simplicity** — flag features beyond what was asked, single-use
   abstractions, unrequested configurability, impossible-scenario error
   handling, 200-line code that could be 50.

2. **Surgical scope** — flag drive-by refactors of unrelated adjacent
   code, style refactors mixed with substantive logic edits, orphan
   imports/variables/functions, style drift from the file's existing
   conventions.

3. **Hidden assumptions** — flag behavior depending on unstated
   invariants the next reader can't see, simpler alternatives the diff
   didn't consider when obvious, multiple valid interpretations of the
   task with one silently picked.

The fourth Karpathy rule (Goal-Driven Execution) was intentionally
excluded — it's a metaprocess rule about how to approach a task with
no concrete evaluation target on a code diff. Tracked as a candidate
for separate CLAUDE.md inclusion in a follow-on.

## Why universal (Option A) over project-scoped opt-in

The baseline is intentionally on for every opted-in project: same
review criteria everywhere, regardless of whether the project supplied
a marker. Project-specific invariants in `.codex-pair/context.md`
take precedence per the section's framing ("Treat violations as MED or
HIGH findings unless a project-context rule below explicitly overrides
them"), so projects retain the ability to override baseline behavior
without removing it.

## Cost + cache impact

- ~360 tokens per review of prompt overhead (~$0.0015 at current
  codex pricing — negligible vs the $0.04–0.07 per-review codex spend)
- Cache invalidation is one-time per project on the first edit after
  upgrade because the prompt content change → cache key change. Each
  opted-in project pays one extra codex spawn per file on the first
  post-upgrade edit, then back to normal cache-hit rates.

## What's unchanged

The hook source (`codex-pair-watch.mjs`) is byte-identical. This is a
prompt-only change. ADR-077 silent-on-error, ADR-082 cache key shape,
ADR-087 inflight lock, ADR-089 golden-fixture contract — all unchanged
in mechanism (the golden fixture content is updated to match the new
template, preserving the byte-identical pin).

Plugin test count unchanged at 313; lint clean across 6 workspaces.

## Reversibility

Two file edits + one test-assertion update if empirical follow-on
shows the baseline doesn't earn its keep. ADR-099 documents the
reversal cost up front.
