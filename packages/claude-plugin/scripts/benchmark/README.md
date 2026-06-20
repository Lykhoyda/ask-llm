# codex-pair prompt A/B benchmark (ADR-100)

Empirical harness for validating prompt-template changes. Built initially
to test ADR-099 (Karpathy baseline principles), but reusable for any
future prompt change that wants empirical justification before shipping.

## What this measures

For each fixture, the driver:

1. Renders the review prompt twice — once against the **pre-baseline**
   template (current production prompt without the Karpathy block) and
   once against the **baseline** template (ADR-099's version with the
   block).
2. Invokes `codex exec --json` with each rendered prompt against the
   same fixture file + context.
3. Parses the verdict JSON and matches findings against the fixture's
   `probes.json` ground truth.
4. Aggregates **recall** (true positives caught / total ground-truth
   probes) and **extra findings** (findings not matching any probe —
   either real concerns the probes didn't anticipate, or noise).

The headline output is a markdown report with a per-fixture caught /
missed / extra breakdown and an aggregate recall delta.

## Decision rule

Ship the prompt change to `prompts/review.txt` permanently if:

- **Recall delta ≥ +10 percentage points** (the baseline catches a
  meaningfully larger fraction of ground-truth probes than the
  pre-baseline prompt does)
- **Extra-finding delta ≤ +1 per fixture on average** (the baseline
  doesn't add overwhelming noise)

If recall regresses or noise jumps, the ADR-099 rollback path applies
(two file edits + one test-assertion update; documented in ADR-099's
Consequences section).

## Usage

```bash
# Full run (all fixtures, both arms)
node packages/claude-plugin/scripts/benchmark/prompt-ab.mjs \
  --model gpt-5.5 \
  --out benchmark-report.md

# Single-fixture quick check
node packages/claude-plugin/scripts/benchmark/prompt-ab.mjs \
  --fixtures 01-overcomplication \
  --out single-report.md

# Cheaper model for sanity
node packages/claude-plugin/scripts/benchmark/prompt-ab.mjs \
  --model gpt-5.4-mini \
  --timeout-ms 60000
```

## Cost

- Per fixture per arm: one `codex exec` review (~$0.04–0.07 at current
  gpt-5.5 pricing)
- Four fixtures × two arms = ~$0.40 per full run
- Variance is high (codex sometimes returns longer responses); budget
  $1 per careful run to absorb retries

## Output interpretation

The report has three layers:

1. **Aggregate table** — recall percentages per arm, plus a one-line
   recall-delta and extra-finding-delta verdict line that mechanically
   checks against the decision rule.
2. **Per-fixture sections** — for each fixture and each arm, the list
   of probes caught (✅), missed (❌), and extra findings (⚠️ — these
   require manual judgment whether they're real concerns or noise).
3. **Token usage** — the per-fixture input/output token counts. Useful
   for cost analysis if the prompt grows further.

## Limitations

- **Keyword-based probe matching is crude.** A real finding that uses
  different vocabulary than the probe's `keywords` array will be
  flagged as missed. Tune keywords as needed when you see this happen.
  Future enhancement: LLM-judge mode that asks gemini "did this finding
  match this probe?" — costs another ~$0.01 per evaluation but better
  signal.
- **Four fixtures is small.** Sample size is sufficient to see large
  effects but won't reveal subtle improvements. Add more fixtures as
  you encounter representative bug patterns in the wild — see
  `fixtures/README.md` for the contribution shape.
- **Codex is non-deterministic.** Run the benchmark twice and you'll
  see modest variance per fixture. Wide swings (>30% recall delta on a
  single fixture) suggest the fixture is borderline and should be
  refined rather than accepted as signal.
- **The fixtures are not the ADR-077 four-task benchmark.** ADR-077's
  fixtures live on `experiment/codex-pair-poc` and exercise *bug
  detection* (float-money precision etc.). These ADR-100 fixtures
  exercise *prompt-rule detection* (does the Karpathy baseline change
  what codex flags?). Different questions; both empirical.

## Adding fixtures

See `fixtures/README.md`. Three files per fixture: `code.ts`,
`context.md`, `probes.json`. The driver auto-discovers any directory
under `fixtures/` containing all three.

## Related ADRs

- **ADR-099** — codex-pair Karpathy baseline principles in review prompt
- **ADR-077** — original codex-pair POC + four-task benchmark
- **ADR-089** — externalized prompt template + golden fixture invariant
- **ADR-100** — this benchmark harness (the document you should read for
  methodology rationale)
