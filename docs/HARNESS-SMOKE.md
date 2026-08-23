# Local harness smoke gate

Harness-facing changes must pass the local-only pre-PR gate:

```bash
yarn prepr:harness
```

This is the canonical command. It owns the immutable install, dependency-ordered build, lint, complete test suite, deterministic harness smoke, cleanup, and evidence format. The deterministic mode uses fake transports and never reads credentials, starts sessions, or calls a model. CI keeps its existing build/lint/test checks; live smoke is additive, local-only, and never required by CI.

## Result vocabulary

Every surface receives exactly one result:

- `PASS` — the selected harness kept the exact model and read-only options, reported truthful selected-only/observed attribution, did not fallback, and did not mutate the repository.
- `FAIL` — invocation, timeout, exit, model, fallback, option, mutation, redaction, or cleanup contract failed.
- `SKIP_UNAVAILABLE` — the optional executable/surface is absent. This is never printed as green. Pi's `/grok-pair` is an intentional unavailable surface under ADR-147.
- `SKIP_NOT_AUTHORIZED` — the executable exists, but the contributor did not authorize that live surface/model or its local catalog requires authentication.

The matrix covers Claude Code `/brainstorm`, `/codex-pair`, and `/grok-pair`; Cursor Agent's pair skills and exact `/brainstorm` participant route; Pi's `/skill:brainstorm`, `/skill:codex-pair`, native provider adapter, and explicit `/grok-pair` exclusion; direct Codex CLI brainstorm/pair routes; and direct Grok Build brainstorm/pair routes.

## Optional live mode and cost boundary

Live mode can consume subscription quota or metered spend. It is refused unless both the global acknowledgement and individual surface authorization are present:

```bash
export ASK_LLM_HARNESS_SMOKE_LIVE=1
export ASK_LLM_HARNESS_SMOKE_AUTHORIZED='cursor-agent:/codex-pair,grok-cli:/brainstorm-route'
export ASK_LLM_HARNESS_SMOKE_CURSOR_CODEX_MODEL='exact-id-from-agent-list-models'
export ASK_LLM_HARNESS_SMOKE_GROK_MODEL='exact-id-from-grok-models'
yarn prepr:harness --live
```

Use `ASK_LLM_HARNESS_SMOKE_AUTHORIZED=all` only when intentionally authorizing every installed leg. Exact IDs are mandatory; the runner never invents, normalizes, or substitutes one. Model variables are:

- `ASK_LLM_HARNESS_SMOKE_CLAUDE_MODEL`
- `ASK_LLM_HARNESS_SMOKE_CURSOR_GROK_MODEL`
- `ASK_LLM_HARNESS_SMOKE_CURSOR_CODEX_MODEL`
- `ASK_LLM_HARNESS_SMOKE_PI_MODEL` (exact `provider/model`)
- `ASK_LLM_HARNESS_SMOKE_CODEX_MODEL`
- `ASK_LLM_HARNESS_SMOKE_GROK_MODEL`

Authoritative discovery is read-only: executable `--version`; `agent --list-models`; `pi --list-models`; `grok models`; Codex's CLI-maintained local `models_cache.json`; and Claude Code's local CLI/plugin contract. Claude Code does not expose a model-catalog command, so its exact model must always be supplied explicitly.

The runner does **not** login/logout, approve trust, install/update tools, change billing/limits, write global configuration, use Cursor `--force`/`--trust`, or use writable sandboxes. Prompts are private `0600` files in an OS temp directory; sessions are disabled where the host supports that; raw outputs remain in memory; credentials, prompts, sessions, and outputs are never written to the repository or printed as PR evidence. The temp tree is removed on normal completion, invocation failure, and invocation timeout.

## Mutation and fallback policy

Each scenario snapshots `git status --porcelain=v1 -z --untracked-files=all` before invocation and compares it afterward. Any delta fails the suite. Every live command uses the strongest documented read-only surface: Claude read tools only, Cursor `--mode ask`, Pi read-only tools with an ephemeral session, Codex `--sandbox read-only`, and Grok Build's read-only one-turn/no-subagent/no-memory/no-web flags.

A nonzero exit, timeout, lost model option, unexpected served model, fallback disclosure, writable/trust flag, or repository delta is `FAIL`. There is no retry and no cross-harness/model fallback: retries would hide the exact route that the gate exists to prove.

## Troubleshooting

1. Run the fast deterministic layer alone: `yarn smoke:harness`.
2. Confirm the executable and authoritative catalog command manually. Do not login or alter trust as part of the smoke gate.
3. If a catalog needs authentication, leave the leg `SKIP_NOT_AUTHORIZED`; authenticate separately only if that is already your intended local account setup.
4. Raise the per-process timeout only when needed: `ASK_LLM_HARNESS_SMOKE_TIMEOUT_MS=180000`.
5. After any `FAIL`, inspect the harness locally. The gate intentionally redacts raw output; do not paste credentials, prompts, session IDs, or full responses into a PR.

## PR evidence

Paste only:

```text
- yarn prepr:harness — PASS
- Harness smoke: PASS=<n> FAIL=0 SKIP_UNAVAILABLE=<n> SKIP_NOT_AUTHORIZED=<n>
- Optional live authorization: <scenario IDs and exact requested IDs, or "not run">
```

Never attach raw output, temp files, credentials, prompts, or session records.
