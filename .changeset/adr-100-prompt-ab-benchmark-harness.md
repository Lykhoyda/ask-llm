---
"@ask-llm/plugin": patch
---

# ADR-100 — codex-pair prompt A/B benchmark harness

Scaffolds an empirical validation harness for prompt-template changes
at `packages/claude-plugin/scripts/benchmark/`. Built initially to
validate ADR-099 (Karpathy baseline principles), but reusable for any
future prompt change.

## What's in the harness

```
packages/claude-plugin/scripts/benchmark/
├── README.md                       # usage + decision rule
├── prompt-ab.mjs                   # driver
├── lib/
│   ├── render-prompt.mjs           # mirrors lib/prompt.mjs substitution
│   ├── invoke-codex.mjs            # spawns codex exec --json, parses JSONL
│   ├── score.mjs                   # keyword-based probe matching
│   └── report.mjs                  # markdown report generator
├── fixtures/
│   ├── README.md
│   ├── 01-overcomplication/        # Simplicity rule
│   ├── 02-drive-by-refactor/       # Surgical scope rule
│   ├── 03-orphan-imports/          # Surgical scope rule
│   └── 04-hidden-assumption/       # Hidden assumptions rule
└── templates/
    ├── pre-baseline.txt            # main's prompt as of ADR-098
    └── baseline.txt                # ADR-099's prompt with Karpathy block
```

## Methodology

1. Each fixture has three files: `code.ts` (sent to codex), `context.md`
   (marker context), `probes.json` (ground-truth `should_flag` entries).
2. The driver renders each fixture against both templates, invokes real
   `codex exec --json`, scores findings against probes via keyword
   match (≥2 keyword hits per probe), emits a markdown comparison.
3. Decision rule for ADR-099 validation: ship if recall delta ≥ +10 pp
   AND extra-finding delta ≤ +1/fixture; otherwise execute ADR-099's
   documented two-file rollback.

## Cost

~$0.40 per full benchmark run (4 fixtures × 2 arms × ~$0.05/review).

## What this is NOT

- NOT a runtime change — the harness is standalone tooling under
  `scripts/benchmark/` with no imports from the runtime layer
- NOT auto-run on PRs — manual invocation only until variance data
  justifies a CI gate
- NOT tested by vitest — one-off maintainer scripts, exercised
  manually when run; lint covers syntax via Biome

Plugin test count unchanged at 313; lint clean across 6 workspaces.

## Forward use

Future prompt changes (severity-vs-urgency, structured-output tweaks,
baseline rule extensions) can vendor a new template snapshot into
`templates/` and re-run against the same fixtures + decision rule.
The harness itself is the durable artifact; ADR-099 is the first
use-case.

Run with:
```bash
node packages/claude-plugin/scripts/benchmark/prompt-ab.mjs \
  --out benchmark-report.md
```
