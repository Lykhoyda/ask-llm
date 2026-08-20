# TOON doctor pilot evidence

Issue #270 pilots TOON on exactly one surface: the structured, read-only `ask-llm-mcp doctor` CLI report. This is an opt-in presentation layer, not a transport migration.

## Selection evidence

Measurements were taken before implementation with GPT-4o tokenization (`js-tiktoken`). Model answer prose was excluded when measuring metadata candidates.

| Candidate | Current bytes | Estimated tokens | Selection result |
|---|---:|---:|---|
| Live `doctor --json` provider/readiness report | 8,155 | 2,174 | **Selected**: largest structured payload, uniform provider/check rows, and useful before single-provider, comparison, and review workflows |
| Representative session usage JSON | 1,020 | 353 | Rejected: already small and cannot explain unavailable providers or failed calls |
| Representative multi-provider comparison metadata | 404 | 139 | Rejected: small after prose is excluded; changing its textual rendering would touch an MCP tool response adjacent to model prose |
| Representative structured review payload | 390 | 104 | Rejected: small and part of the stable machine-review contract; changing it would violate this pilot's transport boundary and risk overlap with #271 |

Commands used for the baseline:

```bash
node packages/llm-mcp/dist/cli.js doctor --json
# 8,155 bytes; 2,174 GPT-4o tokens before implementation

node --import tsx --input-type=module <<'EOF'
# Construct representative usage, comparison metadata, and the existing
# review-success fixture; measure Buffer.byteLength and js-tiktoken.
EOF
# usage 1,020/353; comparison metadata 404/139; review 390/104
```

Doctor won because one truthful availability/readiness report supports all of these decisions without touching their result transports:

- **single provider:** is the requested provider usable?
- **multi-provider comparison:** which configured providers can participate, and which are unavailable?
- **review:** are reviewer CLI/auth/config checks actionable before dispatch?
- **partial:** available and unavailable providers remain separate rows; `providersOmitted` is always explicit.
- **empty:** zero providers/checks are explicit aggregates and empty arrays.
- **failure:** overall `error`, failed checks, fixes, and exit 1 remain intact.

## Contract

```bash
ask-llm-mcp doctor                         # unchanged human text
ask-llm-mcp doctor --json                  # unchanged full DiagnosticReport JSON
ask-llm-mcp doctor --format json           # explicit equivalent
ask-llm-mcp doctor --format toon           # bounded TOON v1 pilot
ask-llm-mcp doctor --format toon --full    # full-output escape hatch
ask-llm-mcp doctor --help
```

The schema identifier is `ask-llm.doctor`, `schemaVersion: 1`. The bounded form contains:

- status, timestamp, pre-computed provider/check aggregates;
- all provider rows in registry order, with four fields: provider, availability, version, detail;
- non-pass top-level checks and non-pass/non-skip enrichment checks;
- definitive empty arrays and zero counts;
- omission counts, per-field truncation records with original UTF-8 byte sizes, and next-step help.

Bounded defaults are 20 top-level checks, 20 provider enrichment checks, and 240 UTF-8 bytes per message/fix/summary/remediation. UTF-8 truncation never cuts a code point. `--full` removes those caps, restores pass/skip checks and direct path fields, and preserves the upstream order. Provider rows are never omitted, so `availability: unavailable` cannot be confused with omission.

Unknown/missing/conflicting flags exit 2. Errors are one structured JSON document on stderr, or TOON when `--format toon` was explicitly selected:

```text
schema: ask-llm.doctor
schemaVersion: 1
format: toon
status: error
error:
  code: unknown_argument
  message: Unknown doctor argument
  hint: Run ask-llm-mcp doctor --help.
```

The bounded format removes direct resolved-PATH/provider-path fields and discloses how many were omitted. It does not probe or expose any data the existing doctor report did not already contain. No prompts, model answers, session IDs, MCP payloads, or machine envelopes enter this surface. Full TOON and JSON retain the existing diagnostic path visibility by explicit request.

## Benchmark

### Live report

One live report on the development environment had five provider rows, one unavailable provider, Codex enrichment, 19 enrichment checks, and actionable failures. Values below came from six interleaved runs per format; latency includes the identical provider/version/enrichment probes.

| Format | Bytes | GPT-4o tokens | Byte change vs JSON | Token change vs JSON | Median end-to-end latency |
|---|---:|---:|---:|---:|---:|
| Existing full JSON | 8,156 | 2,174 | — | — | 3,977.9ms |
| Bounded TOON | 2,328 | 719 | **-71.5%** | **-66.9%** | 3,990.1ms |
| Full TOON | 6,010 | 1,784 | -26.3% | -17.9% | 3,932.2ms |

The 12.2ms bounded-vs-JSON median difference is within probe variability (observed live ranges overlap). Deterministic serialization benchmarks below show the actual formatter overhead is about 0.02ms.

### Representative workflows

Run:

```bash
yarn benchmark:toon-doctor
```

The fixtures are sanitized snapshots of current doctor shapes. “Single-provider” means one of the five configured providers is available, not that unavailable providers disappear. Parser reliability runs both `JSON.parse` and the official strict TOON decoder 100 times per case.

| Workflow | JSON bytes | TOON bytes | Saved | JSON tokens | TOON tokens | Saved | JSON format ms | TOON format ms | Parser reliability |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| single-provider | 1,300 | 989 | 23.9% | 423 | 332 | 21.5% | 0.002 | 0.027 | 100/100 |
| multi-provider comparison | 1,454 | 980 | 32.6% | 465 | 339 | 27.1% | 0.002 | 0.019 | 100/100 |
| review readiness | 1,712 | 1,170 | 31.7% | 500 | 381 | 23.8% | 0.002 | 0.024 | 100/100 |
| empty | 385 | 735 | -90.9% | 139 | 255 | -83.5% | 0.001 | 0.013 | 100/100 |
| partial | 1,317 | 1,094 | 16.9% | 412 | 359 | 12.9% | 0.002 | 0.022 | 100/100 |
| unavailable | 1,289 | 1,129 | 12.4% | 401 | 369 | 8.0% | 0.002 | 0.022 | 100/100 |
| failure | 1,173 | 1,091 | 7.0% | 369 | 358 | 3.0% | 0.005 | 0.021 | 100/100 |
| truncation | 4,362 | 1,414 | 67.6% | 630 | 382 | 39.4% | 0.002 | 0.028 | 100/100 |

Both formats require one command/turn. Clarity was assessed against five yes/no questions: overall status visible, provider attribution preserved, unavailable distinct from omitted, truncation disclosed, and next action present. Bounded TOON scored 5/5 in every fixture. Full JSON scored 3/5 in rich reports (attribution and status are present, but omission is implicit, truncation is absent, and next commands are not contextual) and 4/5 in failure fixtures where `fix` supplies the action.

The empty synthetic case is deliberately unfavorable: fixed version/disclosure/help fields cost more than a tiny empty JSON object. That gap, plus modest savings for small failures, is why TOON remains negotiated rather than becoming the default.

## Compatibility evidence

- `doctor` default text is unchanged.
- `doctor --json` still writes `JSON.stringify(report, null, 2)` and retains its exit behavior.
- `diagnose` MCP structured content/resources are untouched.
- MCP/JSON-RPC registration, tool schemas, and content are untouched.
- `machine` and `machine-schema` remain one-document JSON contracts.
- Model answer prose remains prose.
- No daemon, background work, Bun migration, generic formatter, or repository-wide serialization change was added.

Behavioral coverage:

```bash
yarn vitest run packages/llm-mcp/src/__tests__/toonDoctor.test.ts
# 18 tests passed: negotiation, JSON alias, parser, error, empty, partial,
# unavailable, ordering, attribution, privacy, truncation, and --full
```

## AXI ten-principle audit

This audit distinguishes the bounded pilot from repository-wide gaps; gaps become follow-ups rather than scope expansion.

| # | Principle | Result | Concrete evidence |
|---:|---|---|---|
| 1 | Token-efficient output | **Pass (pilot)** | Live `doctor`: 2,174 → 719 estimated tokens; `yarn benchmark:toon-doctor` records every representative case, including regressions on tiny empty output. Other MCP text surfaces were not migrated. |
| 2 | Minimal default schemas | **Pass (pilot)** | `providers[5]{provider,availability,version,detail}` has four fields; output from `doctor --format toon` shows one shared tabular header. |
| 3 | Content truncation | **Pass (pilot); gap elsewhere** | Tests bound UTF-8 to 240 bytes, report `originalBytes`, and prove `--full`. Existing comparison/review prose surfaces do not consistently disclose text truncation; audit separately before changing them. |
| 4 | Pre-computed aggregates | **Pass** | `summary` emits total/available/unavailable/omitted and shown-check counts, avoiding a second parsing/counting turn. Existing `multi-llm` and usage reports also pre-compute success/failure and token totals. |
| 5 | Definitive empty states | **Pass** | Empty test decodes zero aggregates plus `providers: []`, `checks: []`, `providerChecks: []`, and `truncations: []`; usage already says “No LLM calls recorded”. |
| 6 | Structured errors and exit codes | **Pass (pilot); gap at root dispatcher** | `doctor --format toon --wat` produces `error.code: unknown_argument`, hint, empty stdout, and exit 2. `machine` already uses 0/2/3. However, `ask-llm-mcp --help` and an unknown top-level command currently start provider detection/MCP instead of rejecting the command. Follow-up: add a top-level dispatcher contract in a separate issue. No mutations are in this pilot. |
| 7 | Ambient context | **Pass** | TOON is explicit opt-in and doctor runs only on demand. No integration, probe, daemon, or background work was added. |
| 8 | Content first | **N/A for no-argument MCP server; pass for REPL/doctor** | No-argument execution is the stdio MCP server transport, so terminal live-data output would corrupt the protocol. `repl` shows provider content/banner; `doctor` immediately shows live diagnostics. |
| 9 | Contextual disclosure | **Pass (pilot)** | Every bounded result carries exact full/JSON/docs next steps; structured errors carry `ask-llm-mcp doctor --help`. |
| 10 | Consistent help | **Pass (pilot); repository gap** | `doctor --help` documents formats and `--full`; REPL has `/help`. Probe evidence: `ask-llm-mcp --help` and `ask-llm-mcp unknown-command` both timed out after beginning `agy --version`, with no help. Follow-up: top-level/subcommand help without provider loading. |

### Follow-up recommendations

1. Add a separate, reviewed top-level CLI dispatcher/help contract; do not silently fold it into this output pilot.
2. Audit truncation disclosure in comparison/review textual surfaces while leaving model prose as prose.
3. Re-evaluate default TOON only after field usage shows that the live 67% saving outweighs empty/small-payload regressions and client parser availability.
4. If another surface is piloted, benchmark it independently; do not generalize `toonDoctor.ts` into a repository serialization framework.
