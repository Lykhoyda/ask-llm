# Benchmark fixtures (ADR-100)

Each fixture is a self-contained scenario crafted to exercise one of
the Karpathy-baseline rules from ADR-099. Each directory contains:

- **`code.ts`** — the file content sent to codex for review. Starts
  with a comment block restating the task that was supposedly given to
  Claude, so codex has the same context a real edit would have.
- **`context.md`** — marker-file content sent as `projectContext` in
  the rendered prompt.
- **`probes.json`** — the ground-truth expectations: `should_flag`
  entries are findings codex SHOULD raise (true positives); `should_not_flag`
  entries are things codex should NOT raise (negative probes for noise).

## Fixture index

| Fixture | Tests | Why this exercises the rule |
|---|---|---|
| `01-overcomplication` | Simplicity | Implements `getFullName` via a single-use interface, factory class, runtime null checks against TypeScript types, and unused configurability params — every kind of "code beyond what was asked" |
| `02-drive-by-refactor` | Surgical scope | Bug fix to `parsePagination` correctly applied, but the diff also includes an unrelated function rename, a reformatted constants block, and a history comment — all changes that should be in a separate PR |
| `03-orphan-imports` | Surgical scope | Removes `formatV1` correctly, but leaves `decodeBase64` and `logger` imports orphaned (no longer used by anything in the file) |
| `04-hidden-assumption` | Hidden assumptions | Implements `firstAvailableSlot` correctly for an already-sorted input, but the task asked for the "earliest" slot — depends on an unstated sort-order invariant. Should either sort internally or document the requirement. |

## Adding a new fixture

Create a new directory under `fixtures/` with the three files. The
driver auto-discovers any directory containing all three. Naming
convention: `NN-short-slug/` where `NN` is a two-digit sequence and
`slug` describes the rule being exercised.
