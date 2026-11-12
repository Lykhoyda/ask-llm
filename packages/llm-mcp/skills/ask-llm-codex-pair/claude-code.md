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

Continue with step 2 when no marker is found, otherwise step 3.

Done when the marker search has selected setup or status.

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
   ---
   blockOn: false
   ---
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

   Done when the draft contains `blockOn: false` (advisory review), that summary and 3–5 project-specific invariants.

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

6. Run step 3 for the created marker.

   Done when the command's status output has been shown.

Done when setup was cancelled without writing a marker, or the confirmed marker exists and step 3's output has been shown.

## 3. Show status

Run the plugin's status command from the project and show its output:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-pair-log.mjs" --status
```

It resolves the same configuration as the hook, including marker/environment/default effort precedence, `blockOn`, disabled and pause state, and recent reviews. Existing markers stay advisory unless they opt in with `blockOn: HIGH`.

Done when the command's output has been shown, including its state, resolved configuration and recent reviews (or the absence of reviews).

## Stop gate: `blockOn`

Only when `.codex-pair/context.md` frontmatter says `blockOn: HIGH` does the Stop gate block turn-end on an unacknowledged HIGH finding or a review still in flight. This is a once-per-turn guard: the next Stop in the same turn passes. A finding stops counting when its file changes, disappears or is clean against HEAD. Otherwise the gate only surfaces pending text.

For hook behavior, configuration and cost, read [reference.md](reference.md).
<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
