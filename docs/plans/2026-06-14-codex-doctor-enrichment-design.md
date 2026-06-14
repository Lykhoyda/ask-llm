# Design — `ask-llm doctor` codex-diagnostics enrichment (#183)

**Date:** 2026-06-14 · **Status:** Approved (brainstorm) · **Issue:** #183 (consolidates the I1 thread from #131 → #139 → #145 → #151 → #152)

## Context

`runDiagnostics` (`packages/shared/src/doctor.ts`) probes each provider generically (`which` + `--version`) into a structured `DiagnosticReport`. codex ≥0.137 exposes `codex doctor --json` — a structured local health report (`{ schemaVersion, overallStatus, codexVersion, checks: { <id>: { category, status, summary, remediation } } }`) covering auth / config / git / app-server. Folding a compact summary of it into `ask-llm doctor` helps a user diagnose *why* codex second-opinions might fail (auth/config/install), which the version-only probe can't.

`codex doctor` reports **local install/auth/config health, not live API/quota state** (its `auth.credentials` reads `ok` even when the API quota is exhausted). So this complements the quota-fallback path; it does not duplicate it.

## Locked decisions (brainstorm)

1. **Scope: `codex doctor` only.** `codex plugin list --json` (codex *marketplace* plugins) is dropped as YAGNI — unrelated to ask-llm's `codex exec` usage.
2. **Auto + capability-probe.** When codex is available, attempt `codex doctor --json` and degrade **silently** on any failure (old codex without `--json` → non-zero exit; unparseable JSON; timeout; throw). No version parsing — the `≥0.137` requirement enforces itself by the probe succeeding. No opt-in flag.

## Architecture — generic `enrich` hook, codex specifics near codex

Preserves the provider-agnostic doctor (shared knows nothing about codex), mirroring the existing optional `probeAvailability?` hook on `ProviderSpec`.

| Package | Change |
|---|---|
| `@ask-llm/shared` (`doctor.ts`) | Add `ProviderEnrichment` type; optional `enrich?` on `ProviderSpec`; optional `enrichment?` on `ProviderProbe`; ~5 lines in `runDiagnostics` to call the hook for available CLI providers; rendering in `formatDiagnosticReport`. **Generic — no codex knowledge.** |
| `ask-codex-mcp` | Pure `parseCodexDoctorJson(stdout): ProviderEnrichment \| undefined` + `enrichCodexDoctor({ command, pathEnv }): Promise<ProviderEnrichment \| undefined>` (runs `codex doctor --json`, 5s timeout, resolved PATH). All codex specifics live here, beside `parseCodexJsonlOutput`. |
| `ask-llm-mcp` (`utils/providerSpecs.ts`) | One line: attach `enrich: enrichCodexDoctor` to the codex spec. |

### Types (shared)

```ts
export interface ProviderEnrichmentCheck {
  name: string;            // codex check id, e.g. "auth.credentials"
  status: CheckStatus;     // mapped to ask-llm's pass|warn|fail|skip
  summary: string;
  remediation?: string;
}
export interface ProviderEnrichment {
  heading: string;         // "codex doctor"
  overall: OverallStatus;  // codex overallStatus (ok|warning|error — same vocabulary)
  checks: ProviderEnrichmentCheck[];
}
```

`ProviderProbe` gains `enrichment?: ProviderEnrichment`.

### Control flow (`runDiagnostics`, CLI-provider branch)

After `available` is determined: if `available && spec.enrich`, `try { enrichment = await spec.enrich({ command, pathEnv: resolvedPath }) } catch { enrichment = undefined }`. Attach to the pushed `ProviderProbe`.

## Behavior

- **Informational only — does NOT affect `report.status` or the exit code.** codex in `warning` (e.g. "app-server not running") must not flip ask-llm's overall status or break `doctor`'s exit code. Preserves "default behavior unchanged".
- **Text mode = compact:** render codex `overall` + only **non-ok** checks (with remediation). When `enrichment` is absent, nothing is rendered (output identical to today).
- **`--json` = full:** the complete mapped `checks` list rides along in the report object for free (`runDoctor` already `JSON.stringify`s the report).

### Status mapping (codex → ask-llm)

codex check `status`: `ok→pass`, `warn`/`warning→warn`, `fail`/`error→fail`, `skip→skip`, unknown→`warn` (conservative). codex `overallStatus` (`ok|warning|error`) reuses ask-llm's identical `OverallStatus`.

### Text render shape

```
Providers:
  - Codex: available (codex-cli 0.139.0)
      path: /opt/homebrew/bin/codex
      codex doctor: WARNING
        ! mcp.servers: 1 server failed to start
            → run `codex mcp list` to inspect
```

## Testing (TDD)

1. `parseCodexDoctorJson` (codex-mcp, pure) — real-shape fixture → mapped enrichment; malformed/empty/non-JSON → `undefined`; status-mapping table.
2. `formatDiagnosticReport` (shared) — renders enrichment block; omits when absent; shows only non-ok checks; includes remediation arrow.
3. `runDiagnostics` (shared) — calls `spec.enrich` when available; `enrich` throwing → `enrichment` undefined (degrade) and provider still reported.

## Logistics

- **Changeset:** touches `packages/shared/src/**` → ADR-119's `check-shared-changeset.mjs` guard requires a `patch` changeset bumping **shared + all 5 MCPs**.
- **Estimate:** ~70–90 LOC incl. tests (the issue's "~40 LOC" didn't budget keeping shared generic across 3 packages).
