---
name: codex-pair
description: Pair with Codex using the host's supported lifecycle. On Claude Code and Pi, manages the proven opt-in per-edit review flow; on Cursor Agent, runs an explicit consent-gated iterative reviewer session through ask-codex without assuming Claude hooks or namespaces.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Use Codex as an explicit read-only reviewer while the host remains the editor. Apply `../pairing-contract.md`. Where the host supports the established per-edit integration, set up and report its status: the repository marker carries review context but is not, by itself, authorization on Pi. Preserve bounded file context, include-directory handling, reasoning effort, session continuity where supported, consent, cancellation, actionable relay, failure disclosure, and explicit host lifecycle limitations.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Pi requires project trust, this repository marker, and explicit user-owned allowlist consent through `/codex-pair`. Pairing is asynchronous in TUI/RPC/long-lived JSON modes, uses `tool_result`, and surfaces findings non-blockingly. One-shot print mode, blocking Stop-gate parity, and nested Fable execution are unsupported.

### Cursor Agent adapter

Cursor discovers this `SKILL.md` through its supported Agent Skills surface; `/codex-pair` attaches it as an explicit command. Do **not** use Claude Code's `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `CLAUDE_PLUGIN_ROOT`, `AskUserQuestion`, or plugin tool namespaces. This adapter is an on-demand iterative pairing session, not a claim that Claude hooks were registered in Cursor.

1. Read `../pairing-contract.md`. The Cursor plugin bundle registers only the unified `ask-llm` server; if the user separately installed `@ask-llm/codex-mcp`, prefer that deterministic `ask-codex` leaf. Resolve an exposed MCP tool whose exact leaf is `ask-codex`; do not assume its server prefix. When only the unified `ask-llm` leaf is registered, it may serve as the transport with `provider: "codex"` and every option (model, reasoning effort, include directories, session) pinned explicitly; its schema rejects unsupported combinations instead of stripping them and Codex runs read-only by default. Never make an unpinned generic call. If neither tool is exposed, stop with the recommended user-installed unified server:
   ```json
   {"mcpServers":{"ask-llm":{"command":"npx","args":["-y","@ask-llm/mcp"]}}}
   ```
   Save that as project `.cursor/mcp.json` or user `~/.cursor/mcp.json`, ensure `codex` is authenticated, reload the server from Cursor Settings → Tools & MCP or restart Cursor Agent, and invoke `/codex-pair` again. A split `codex` entry using `@ask-llm/codex-mcp` is an explicit user-installed alternative when only the `ask-codex` leaf is desired; keep one registration per server (the plugin already provides `ask-llm`, so do not add a second `ask-llm` entry merely to duplicate it).
2. Require both `model=<exact ID>` and `effort=low|medium|high|xhigh|max`; parse optional `include=dir1,dir2`. If model or effort is omitted, ask the user to choose it and stop before reading extra context, requesting consent, or calling a provider. Do not infer either value from the Cursor host environment: the MCP server may resolve different `ASK_CODEX_MODEL` or `ASK_CODEX_REASONING_EFFORT` values. Reject absolute, `..`, and `~` include paths; cap at 32. Build a bounded context manifest (20 KB/file, 100 KB/request) from task requirements, relevant project instructions, changed files, and tests. Do not send secrets or unrelated files.
3. Before the first provider call, show host=`Cursor Agent`, reviewer provider=`codex`, selected transport=`ask-codex` or unified `ask-llm`, exact user-supplied model, exact user-supplied reasoning effort, include directories, read-only behavior, data/quota boundary, and fresh persisted-session intent. Ask for explicit confirmation using Cursor's normal conversational approval surface. Refusal ends `cancelled` with no provider call.
4. First call exactly one of these protocol shapes, substituting the already disclosed explicit choices:
   ```json
   [
     {
       "tool": "ask-codex",
       "arguments": {
         "prompt": "<bounded reviewer prompt>",
         "model": "<required exact ID>",
         "reasoningEffort": "<required effort>",
         "includeDirs": ["<validated relative directory>"],
         "sessionId": "",
         "sandbox": "read-only"
       }
     },
     {
       "tool": "ask-llm",
       "arguments": {
         "provider": "codex",
         "prompt": "<bounded reviewer prompt>",
         "model": "<required exact ID>",
         "reasoningEffort": "<required effort>",
         "includeDirs": ["<validated relative directory>"],
         "sessionId": ""
       }
     }
   ]
   ```
   The prompt assigns Codex the independent reviewer role and requests actionable severity/file/line evidence. Capture the returned structured `sessionId`/Thread ID and actual model. Relay feedback before changing code; verify every finding against source and label it accepted, rejected, or deferred.
5. At meaningful checkpoints, call the same tool with the captured `sessionId`, same model/effort, and bounded delta. On `ask-codex`, keep `sandbox: "read-only"`; unified `ask-llm` has no sandbox input and is read-only by default, so do not send an unsupported sandbox field. Omit `includeDirs` on resumed calls because `codex exec resume` does not support them (every Codex transport — split `ask-codex`, unified `ask-llm`, and Pi — rejects that combination at the shared executor instead of dropping the directories); never silently strip them from the first call. If no session ID was returned, stop with a session diagnostic instead of pretending continuity.
6. A Cursor interrupt cancels the MCP request. Report `cancelled` and never retry another tool/model/provider. Preserve earlier feedback on later failure and report `failed (partial)`. On success report `completed` with host, provider, requested/actual model, effort, session reuse count, context/include directories, accepted/rejected/deferred actions, and any reported Codex quota fallback. Never conceal fallback or rewrite a model.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# /codex-pair — setup and status dashboard

`/codex-pair` is a user-invocable command that orchestrates setup-and-status for the codex-pair PostToolUse hook. The HOOK runs automatically on every Edit/Write/MultiEdit when a project opts in via `.codex-pair/context.md`; this COMMAND is what you invoke to set up that opt-in (first time) or check the hook's current state (any time).

The hook empirically catches bugs earlier across any codebase and any task type — the improvement is task-agnostic per the [ADR-077](../../../../docs/DECISIONS.md) 4-task benchmark and the [ADR-095](../../../../docs/DECISIONS.md) lived-experience replication. Reference documentation on what the hook does, its cost characteristics, and its configuration knobs is in the second half of this file (below the Instructions section).

> **Note on what the hook is for:** the bug classes and example domains in the reference section below describe what codex-pair *catches in other projects* — they're benchmark fixtures, not properties of `ask-llm` itself. ask-llm is a CLI bridge between MCP clients and LLM CLIs with no money handling, no auth paths, no user-facing security surface. codex-pair runs against this repo for dogfooding (and continues to catch real bugs — see ADR-095).

## Instructions

### Phase 1: Detect current state

1. Locate the marker by walking up from `process.cwd()` looking for `.codex-pair/context.md`. Stop at `$HOME` or filesystem root.

   ```bash
   dir=$(pwd); while [ "$dir" != "/" ] && [ "$dir" != "$HOME" ]; do
     if [ -f "$dir/.codex-pair/context.md" ]; then echo "$dir"; break; fi
     dir=$(dirname "$dir")
   done
   ```

   Set `MARKER_DIR` to the result. Empty result means no marker exists.

2. If `MARKER_DIR` is set, check whether the pause sentinel exists:
   ```bash
   [ -f "$MARKER_DIR/.codex-pair/state/paused" ] && echo "PAUSED" || echo "ACTIVE"
   ```

3. If `MARKER_DIR` is set and state is ACTIVE, read the last 5 log entries:
   ```bash
   tail -n 5 "$MARKER_DIR/.codex-pair/log.jsonl" 2>/dev/null | jq -c '{ts: .timestamp, verdict: .verdict, file: .file, concerns: .concerns}'
   ```

4. If `.codex-pair/ignore` exists, read it for the active patterns.

### Phase 2: Branch on detected state

- **No marker found** → execute Phase 3 (setup)
- **Marker found, state = PAUSED** → execute Phase 4 (paused dashboard)
- **Marker found, state = ACTIVE** → execute Phase 5 (active dashboard)

### Phase 3: Interactive setup (no marker found)

1. Tell the user: "codex-pair is not yet configured for this project. Setting up now."

2. Auto-detect project context by reading what's already available:
   - `package.json` (name, description, dependencies — infers language/framework)
   - `README.md` first 50 lines (project purpose statement)
   - `pyproject.toml` / `Cargo.toml` / `go.mod` if present (non-Node projects)

   You (Claude) already have this context in your tools — use Read to fetch the files, then synthesize a one-paragraph project-purpose summary.

3. Draft a `.codex-pair/context.md` from the detected context. Structure:
   ```markdown
   # .codex-pair/context.md

   <one-paragraph project-purpose summary derived from README/package.json>

   ## Domain invariants Codex can't infer from a single file

   <draft 3-5 bullet-point invariants based on what you found. Examples
   to seed thinking — pick the ones that match what this actual project
   does, drop the ones that don't, add others if obvious>

   - <invariant 1 you inferred>
   - <invariant 2 you inferred>
   - <invariant 3 you inferred>
   ```

4. Use `AskUserQuestion` to confirm before writing. Question shape:
   > "Here's a draft `.codex-pair/context.md` for your project. Should I create it as-is, let you edit it first, or skip setup?"
   >
   > Options: **Create as drafted** (recommended) | **Show me the draft to edit** | **Cancel setup**
   >
   > Include the full drafted content as the `preview` field on the recommended option so the user sees it before deciding.

5. On user confirmation:
   - `mkdir -p .codex-pair`
   - Write `.codex-pair/context.md` with the confirmed content
   - Check `.gitignore` for an existing `.codex-pair/` line; if missing, ASK the user whether to append it (don't modify `.gitignore` without consent — they may have an intentional reason for the current state, or want global gitignore instead).

6. Confirm setup with a status table (same format as Phase 5 below):
   ```
   ✓ codex-pair active for <MARKER_DIR>
   Next Edit/Write/MultiEdit will trigger a Codex review.
   Pause with `/codex-pair-pause` · Resume with `/codex-pair-resume`
   ```

### Phase 4: Paused dashboard

Read the sentinel file:
```bash
cat "$MARKER_DIR/.codex-pair/state/paused" 2>/dev/null
```

If the sentinel is **non-empty** it is an auto-pause written by the hook (quota exhaustion or consecutive failures — see #176). Parse its JSON body and render:

```
codex-pair status — <MARKER_DIR>

  State:          AUTO-PAUSED ⏸
  Paused since:   <at field from JSON>
  Kind:           <kind field: "quota" or "failures">
  Reason:         <reason field>
  Resets ~        <resetHint field>  (omit this line if resetHint is absent)

To resume:  /codex-pair-resume
To remove:  rm -rf <MARKER_DIR>/.codex-pair
```

If the sentinel is **empty** it is a manual pause. Render:

```
codex-pair status — <MARKER_DIR>

  State:          PAUSED ⏸
  Paused since:   <mtime of .codex-pair/state/paused>
  Pause reason:   <last entry in log.jsonl with verdict:"skipped" + reason starting with "paused"> (if available)

To resume:  /codex-pair-resume
To remove:  rm -rf <MARKER_DIR>/.codex-pair
```

### Phase 5: Active dashboard

Render a status table:

```
codex-pair status — <MARKER_DIR>

  State:           ACTIVE ✓
  Marker model:    <model from frontmatter of context.md, or "default (gpt-5.6-sol)">
  Surface threshold: <surfaceThreshold from frontmatter, or "med">
  Cost/review:     varies by Codex plan and workload / ~13–50s wall-clock

  Recent reviews (last 5):
  <timestamp>  <verdict>  <file>  <H#/M#/L# concerns>
  <timestamp>  <verdict>  <file>  <H#/M#/L# concerns>
  ...

  Ignore patterns active: <count from .codex-pair/ignore, or "none">
  Include patterns active: <count from .codex-pair/include, or "none — reviewing all files">

To pause:    /codex-pair-pause
To exclude a file pattern: append to <MARKER_DIR>/.codex-pair/ignore
To restrict to specific paths: create <MARKER_DIR>/.codex-pair/include
```

If recent reviews include any verdicts of `error`, `spawn_failed`, or `timeout`, add a "Recent failures" subsection with the reason field of the most recent failure.

## Reference: hook behavior, when to use, configuration

(Everything below this point is reference documentation for the underlying PostToolUse hook — read this when you need to explain the hook to the user, when sizing whether the hook is worth enabling, or when configuring it via env vars or frontmatter.)

The hook surfaces HIGH and MED concerns to Claude on the next turn; logs everything to `.codex-pair/log.jsonl`. **Empirically catches a class of bug that confidence-filtered review structurally suppresses** — the recall improvement holds across structurally different task types (see ADR-077 for the precision-vs-recall data).

## When to use this vs `/codex-review`

The decision is about **code characteristics**, not project domain. Any project — payments, infra, parsers, plugins, this very repo — has both kinds of code; the recall-first hook earns its keep wherever there's a category of bug that "looks fine but runs wrong."

| Use `/codex-review` (precision-first) | Use codex-pair (recall-first) |
|---|---|
| Routine PR review | Code with hidden invariants the model can't infer from one file |
| Glue code, simple CRUD, refactors | Code where latent bugs cost more than per-edit review (~$0.04–0.07) |
| You want one comprehensive report | Code evolving fast under written constraints (spec, protocol, ADR) |
| You're cost-sensitive (~$0.04/review) | State coordination, concurrency, anything order-sensitive |
| Default for everything | The "looks fine, runs wrong" failure mode would be expensive to catch later |

The empirical finding from the 4-task benchmark (four structurally different task types — CRUD, parsing, RFC-spec implementation, stateful logic): `/codex-review`'s "confidence ≥ 80" filter structurally suppresses **looks-fine-runs-wrong** bugs — code that compiles, lints, and type-checks but produces wrong results at runtime because of an implicit invariant the model couldn't infer from a single file. codex-pair's HIGH/MED/LOW threshold catches them. Different classes of bug, not the same class with different completeness. **The recall improvement is task-agnostic** — measured across all four task types, not just one.

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

**Do NOT commit the `.codex-pair/` directory** — gitignore it. The marker is per-developer opt-in: each contributor's review context is their own (model preference, severity threshold, project rules they care about). One developer iterating on prompt wording shouldn't dirty the shared history. The hook itself IS project policy (it ships in the plugin); the marker is the per-developer activation switch. Per [ADR-092](../../../../docs/DECISIONS.md), every state artifact (marker, log, cache, ignore globs, pause sentinel, inflight locks) nests under the single directory, so one `.gitignore` line covers everything — including any future state files added later:

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

- Usage varies by Codex plan and workload (`gpt-5.6-sol` with reasoning tokens)
- ~13–50s per file wall-clock
- Files >20 KB skipped (override with `CODEX_PAIR_MAX_FILE_BYTES`)
- node_modules, dist, lockfiles, images skipped automatically
- A 50-edit session = ~$2–3.50 + ~10–40 cumulative minutes of codex latency

For the typical opted-in project (small surface where review depth matters), this is acceptable. For routine refactor work, leave the marker file out.

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

## Configuration knobs (env vars)

| Variable | Default | Effect |
|---|---|---|
| `CODEX_PAIR_DISABLED` | unset | Set to `1` to bypass the hook entirely (kill switch) |
| `CODEX_PAIR_MAX_FILE_BYTES` | `20000` | Skip files larger than this many bytes |
| `ASK_CODEX_TIMEOUT_MS` | `800000` | Per-call codex timeout (inherited from @ask-llm/codex-mcp, ADR-074) |
| `ASK_CODEX_REASONING_EFFORT` | `medium` | Codex reasoning effort for continuous per-edit reviews; `/codex-review` and `/brainstorm` default to `high` instead. |
| `ASK_CODEX_DEBOUNCE_MS` | `15000` | Settle window: a burst of edits to one file within this window is collapsed into a single review of the settled state (ADR-112). Set to `0` to disable debounce and review every edit synchronously. |
| `ASK_CODEX_DEBOUNCE_MAX_MS` | `60000` | Hard cap from the first edit of a burst — forces a review even under a continuous edit stream. |
| `CODEX_PAIR_QUOTA_PAUSE_TTL_MS` | `21600000` (6h) | Quota auto-pauses self-heal after this long. |
| `CODEX_PAIR_FAILURES_PAUSE_TTL_MS` | `86400000` (24h) | Failure auto-pauses self-heal after this long, or immediately on a plugin-version change. |

Both debounce knobs are also settable per-marker via `context.md` frontmatter (`debounceMs` / `debounceMaxMs`), which takes precedence over the env vars. With debounce on (the default), a review fires shortly *after* you stop editing a file and its verdict surfaces on your next edit or next prompt (via the `UserPromptSubmit` drain) — not synchronously on the triggering edit. Set `debounceMs: 0` in the marker frontmatter for the old synchronous behavior.

## Empirical justification

The design decisions in this skill (HIGH/MED/LOW grading, marker-file gate, complement-not-replacement positioning) come from a 4-task benchmark documented in detail at branch `experiment/codex-pair-poc` and in [ADR-077](../../../../docs/DECISIONS.md). The benchmark deliberately picked four **structurally different task types** so the result would generalize, not be a fluke of one domain — a todo CRUD endpoint, a URL shortener, an RFC-spec implementation (JSON Patch RFC 6902), and a stateful business-logic module. The headline 3-arm comparison from task 4:

```
Claude alone:                    2/10 probes pass
Claude + /codex-review:          7/10
Claude + codex-pair:            10/10
```

The three probes `/codex-review` missed exemplified the "looks fine, runs wrong" class the precision filter suppresses — numeric-precision drift, cross-cutting validation gaps, edge-case bounds errors. **The improvement reproduced across all four tasks**, not just the headline one — confirming the recall gain is task-agnostic. Wherever a project has implicit correctness invariants the model can't infer from a single file in isolation (and most projects do, somewhere), codex-pair catches them earlier than a confidence-filtered review on a finished PR.

Subsequent lived-experience audit ([ADR-095](../../../../docs/DECISIONS.md)) confirmed the benchmark holds in real flow: codex-pair flagged 32 unique bugs during a single dense broker-implementation session in this very repo, including 2 BLOCKING bugs that `/multi-review` independently re-caught 5+ hours later. The benchmark is reproducible empirical evidence; ADR-095 is the field replication.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
