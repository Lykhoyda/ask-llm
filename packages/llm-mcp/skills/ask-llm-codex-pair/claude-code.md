<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
# Claude Code: setup and status

These Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code.

`/codex-pair` orchestrates setup and status for the codex-pair PostToolUse hook. The hook runs automatically on every Edit/Write/MultiEdit when the project opts in via `.codex-pair/context.md`; invoke this command for first-time setup or to check the current state.

## 1. Detect current state

1. Locate the marker by walking up from `process.cwd()` looking for `.codex-pair/context.md`. Stop at `$HOME` or filesystem root.

   ```bash
   dir=$(pwd); while [ "$dir" != "/" ] && [ "$dir" != "$HOME" ]; do
     if [ -f "$dir/.codex-pair/context.md" ]; then echo "$dir"; break; fi
     dir=$(dirname "$dir")
   done
   ```

   Set `MARKER_DIR` to the result. Empty result means no marker exists.

   Done when `MARKER_DIR` holds the found directory or is empty after the search.

2. If `MARKER_DIR` is set, check whether the pause sentinel exists:
   ```bash
   [ -f "$MARKER_DIR/.codex-pair/state/paused" ] && echo "PAUSED" || echo "ACTIVE"
   ```

   Done when the sentinel check reports PAUSED or ACTIVE, or there is no marker.

3. If `MARKER_DIR` is set and state is ACTIVE, read the last 5 log entries:
   ```bash
   tail -n 5 "$MARKER_DIR/.codex-pair/log.jsonl" 2>/dev/null | jq -c '{ts: .timestamp, verdict: .verdict, file: .file, concerns: .concerns}'
   ```

   Done when the available last five entries have been read for an active marker; skip for a paused or absent marker.

4. If `.codex-pair/ignore` exists, read it for the active patterns.

   Done when the existing ignore patterns have been read or the file is absent.

Continue by state:

- **No marker found** → step 2 (setup).
- **Marker found, state = PAUSED** → step 3 (paused dashboard).
- **Marker found, state = ACTIVE** → step 3 (active dashboard).

Done when the marker search and, where present, pause state, recent reviews and ignore patterns have been read and the matching branch has been selected.

## 2. Set up (no marker found)

1. Tell the user: "codex-pair is not yet configured for this project. Setting up now."

   Done when the setup notice has been shown.

2. Auto-detect project context by reading what's already available:
   - `package.json` (name, description, dependencies — infers language/framework)
   - `README.md` first 50 lines (project purpose statement)
   - `pyproject.toml` / `Cargo.toml` / `go.mod` if present (non-Node projects)

   You (Claude) already have this context in your tools — use Read to fetch the files, then synthesize a one-paragraph project-purpose summary.

   Done when a one-paragraph purpose summary is derived from the available project files.

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

   Done when the draft contains that summary and 3–5 project-specific invariants.

4. Use `AskUserQuestion` to confirm before writing. Question shape:
   > "Here's a draft `.codex-pair/context.md` for your project. Should I create it as-is, let you edit it first, or skip setup?"
   >
   > Options: **Create as drafted** (recommended) | **Show me the draft to edit** | **Cancel setup**
   >
   > Include the full drafted content as the `preview` field on the recommended option so the user sees it before deciding.

   Done when the user has chosen create, edit or cancel.

5. On user confirmation:
   - `mkdir -p .codex-pair`
   - Write `.codex-pair/context.md` with the confirmed content
   - Keep `.codex-pair/` out of git. Check `.gitignore` for an existing `.codex-pair/` line; if missing, ask the user whether to append it and modify it only with consent — they may have an intentional reason for the current state, or want global gitignore instead.

   Done when the confirmed marker is written and the user's choice about `.gitignore` has been applied.

6. Confirm setup with a status table (same format as the active dashboard below):
   ```
   ✓ codex-pair active for <MARKER_DIR>
   Next Edit/Write/MultiEdit will trigger a Codex review.
   Pause with `/codex-pair-pause` · Resume with `/codex-pair-resume`
   ```

   Done when the activation notice and active status table below have been shown for the created marker.

Done when setup was cancelled without writing a marker, or the confirmed marker exists and the active status table in step 3 has been shown.

## 3. Show status

### Paused dashboard

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

Done when the dashboard shows PAUSED or AUTO-PAUSED with the sentinel's available details and resume guidance.

### Active dashboard

Render a status table:

```
codex-pair status — <MARKER_DIR>

  State:           ACTIVE ✓
  Marker model:    <model from frontmatter of context.md, or "default (gpt-6.1-sol)">
  Reasoning effort: high (override with ASK_CODEX_REASONING_EFFORT)
  Surface threshold: <surfaceThreshold from frontmatter, or "med">
  Cost/review:     varies by Codex plan and workload

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

If recent reviews include any verdicts of `error`, `spawn_failed`, `timeout`, or `unparsed`, add a "Recent failures" subsection with the reason field of the most recent failure.

Done when the status table shows State ACTIVE and the marker's model (or its stated default), recent reviews, ignore/include counts, and any recent failure reason.

## Stop gate: `blockOn`

Only when `.codex-pair/context.md` frontmatter says `blockOn: HIGH` does the Stop gate block turn-end on an unacknowledged HIGH finding or a review still in flight. This is a once-per-turn guard: the next Stop in the same turn passes. A finding stops counting when its file changes, disappears or is clean against HEAD. Otherwise the gate only surfaces pending text.

For hook behavior, configuration and cost, read [reference.md](reference.md).
<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
