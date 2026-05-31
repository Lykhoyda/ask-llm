# ask-codex-edit — Design Spec (2026-05-31)

**Status:** Design — awaiting user approval before implementation (closes #102, the Block-4 headline deferred during the 2026-05-30 consolidation).

**Goal:** Add an `ask-codex-edit` MCP tool that gets Codex to **propose** precise, applyable code edits — symmetric with the existing `ask-gemini-edit`, but using codex's `--output-schema` to return schema-validated JSON instead of prose, eliminating the brittle regex parser.

## Decisions (settled in brainstorming)

1. **Propose, don't apply.** Codex returns structured edits; **Claude applies them**. Honors the project's "external LLM reads/proposes, Claude edits" core, mirrors `ask-gemini-edit`, and avoids codex-vs-Claude write conflicts.
2. **Search/replace edit shape.** Each edit is `{ file, startLine?, oldCode, newCode, description? }` — maps 1:1 onto the existing `ChangeModeEdit`, so the shared chunker + translator are reused unchanged.
3. **Edit existing files only (v1).** New-file creation, deletion, whole-file rewrites, and apply-in-sandbox are explicitly out of scope.

## Why this is bounded

The `@ask-llm/shared` `changeMode` pipeline is three stages: **parse** (regex over Gemini's prose → `ChangeModeEdit[]`), **chunk** (`chunkChangeModeEdits`), **translate** (`formatChangeModeResponse`). Codex's `--output-schema` returns conforming JSON directly, so `ask-codex-edit` **skips the regex parser** (the fragile stage) and feeds straight into the stable chunk + translate stages. Net new code is "a JSON schema + a JSON→`ChangeModeEdit[]` mapper + a thin tool," reusing ~⅔ of the machinery.

## Architecture & data flow

```
Claude → ask-codex-edit { prompt, model?, includeDirs?, sessionId? }
  → executeCodexCLI({ …, editMode: true })
      1. write CODEX_EDIT_SCHEMA (a JSON Schema) to a temp file (trap-cleaned, like the pre-commit hook's tempfile)
      2. codex exec [resume <id>] --skip-git-repo-check --ignore-user-config --ignore-rules
             --sandbox read-only --output-schema <tmp> --json -m <model>   [prompt via stdin]
      3. codex's final agent_message is JSON: { edits: [ { file, startLine?, oldCode, newCode, description? } ] }
      4. parseCodexEdits(json) → ChangeModeEdit[]    (compute oldEndLine/newStartLine/newEndLine from line counts,
                                                       exactly like parseChangeModeOutput; startLine defaults to 1)
  → chunkChangeModeEdits(edits) + formatChangeModeResponse(...)   (shared, UNCHANGED)
  → CHANGEMODE-style output → Claude applies via exact-text-match
```

**Sandbox note:** `--sandbox read-only` — codex must *read* repo files to propose accurate `oldCode`, but never writes (Claude applies). This sidesteps the workspace-write surface entirely for this tool.

## Components / files

| File | Change |
|---|---|
| `packages/codex-mcp/src/constants.ts` | New `CLI.FLAGS.OUTPUT_SCHEMA = "--output-schema"`, `SANDBOX_READ_ONLY = "read-only"`; new `CODEX_EDIT_SCHEMA` (JSON Schema object) |
| `packages/codex-mcp/src/utils/codexExecutor.ts` | `editMode?: boolean` on `CodexExecutorOptions`; in editMode → write schema temp file + add `--output-schema`/read-only sandbox to `buildArgs`; `parseCodexEdits(rawJson) → ChangeModeEdit[]`; reuse quota fallback + sessionId; temp-file cleanup in `finally` |
| `packages/codex-mcp/src/tools/ask-codex-edit.tool.ts` | **New** tool mirroring `ask-gemini-edit`: schema `{ prompt, model?, includeDirs?, sessionId? }`; calls executor in editMode; runs the shared chunk+translate (`processCodexEditOutput`, mirroring gemini's `processChangeModeOutput`) |
| `packages/codex-mcp/src/tools/index.ts` | Register `askCodexEditTool` |
| `packages/codex-mcp/src/utils/__tests__/codexExecutor.test.ts` + a tool test | TDD coverage (below) |

Reused from `@ask-llm/shared` (no changes): `ChangeModeEdit`, `chunkChangeModeEdits`, `formatChangeModeResponse`, `summarizeChangeModeEdits`, `validateChangeModeEdits`, the fetch-chunk cache.

## Edit schema (`--output-schema` file)

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "edits": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "file":        { "type": "string", "description": "Repo-relative path to an existing file" },
          "startLine":   { "type": "integer", "description": "1-based line where oldCode begins" },
          "oldCode":     { "type": "string", "description": "Exact existing text to replace" },
          "newCode":     { "type": "string", "description": "Replacement text" },
          "description": { "type": "string", "description": "One-line rationale" }
        },
        "required": ["file", "oldCode", "newCode"]
      }
    }
  },
  "required": ["edits"]
}
```

The prompt prefix instructs codex: *propose edits as search/replace against existing files; `oldCode` must be an exact, unique substring of the current file; do not invent files.*

## Error handling

- **Malformed JSON** (shouldn't occur with `--output-schema`, but defensive): throw `Codex edit output was not valid JSON: <first 200 chars>`.
- **Empty `edits`**: return a friendly "Codex proposed no edits for this request." (not an error).
- **`oldCode` not found at apply time**: Claude's `Edit` surfaces it; the translator already instructs exact-match. v1 does not pre-validate matches against disk (codex ran read-only on the same tree).
- **Quota**: reuse `isQuotaError` → `gpt-5.5-mini` fallback (editMode flows through the same try/catch).
- **Temp schema file**: written under `os.tmpdir()`, removed in a `finally` (mirrors the plugin pre-commit hook's trap-cleanup discipline).

## Testing (TDD)

1. `parseCodexEdits` maps `{edits:[…]}` → `ChangeModeEdit[]` with correct computed end-lines (and startLine default).
2. `parseCodexEdits` on empty `{edits:[]}` → `[]` → tool emits the "no edits" message.
3. `buildArgs` in editMode includes `--output-schema <path>` + `--sandbox read-only` (and NOT `workspace-write`).
4. `ask-codex-edit` tool returns CHANGEMODE-formatted output for a multi-edit JSON.
5. Quota error in editMode → fallback to `MODELS.FALLBACK`.
6. Large edit set → chunked output (reuses `chunkChangeModeEdits`; assert chunk headers).
7. `includeDirs` → `--add-dir` still threaded in editMode (cache key includes it).
8. **Live smoke:** real `codex exec --output-schema <tmp>` on a tiny fixture returns JSON conforming to the schema and parses to ≥1 edit.

## Out of scope (v1)

New-file creation · file deletion · whole-file rewrites · codex applying edits in-sandbox · cross-file rename refactors. Each can be a focused follow-up once the core propose-and-apply flow is proven.

## Gate

Implementation will follow the same loop as Blocks 1–5: TDD (RED→GREEN per test above) → `/multi-review` → live smoke → signed PR that `Closes #102`.
