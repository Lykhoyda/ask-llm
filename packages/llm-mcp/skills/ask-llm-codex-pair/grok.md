# Grok CLI per-edit pairing

Use this adapter on Grok CLI 1.0.70 or newer. The worker is Grok; the reviewer is Codex Sol by default (`gpt-6.1-sol`, high effort), or opt-in Claude Opus 5.5 (`claude-opus-5-5`). This is one hook with a reviewer setting. Cursor Agent's per-edit adapter and Codex CLI per-edit hooks are outside this integration.

## Setup

1. Resolve the installed `@ask-llm/mcp` package directory containing `scripts/grok-pair-watch.mjs`; call it `<package-root>`. Show the user the reviewer, model, selected CLI, file/command context transfer, and account quota boundary before enabling pairing. Reviewers use their authenticated CLIs. This adapter never invokes xAI's metered API. Authentication and billing remain properties of the selected CLI account.
2. With the user's consent, create `.codex-pair/context.md` containing project invariants and add `.codex-pair/` to the developer's ignore rules. Optional frontmatter selects the reviewer:

   ```markdown
   ---
   reviewer: codex
   ---
   Project invariants for the reviewer.
   ```

   Set `reviewer: claude` for Opus 5.5. Precedence is marker `reviewer`, then `CODEX_PAIR_REVIEWER`, then `codex`. Unknown settings refuse without calling a reviewer. A reviewer cannot review its own family's edits: selecting Claude in the Claude Code hook refuses. Existing Claude Code defaults and debounce behavior are unchanged. Codex model/effort/fallback settings retain their existing meaning; the Claude option always pins Opus 5.5, has no fallback, and uses marker `timeoutMs`, then `ASK_CLAUDE_TIMEOUT_MS`, then 600 seconds.
3. Have the user register the following as their own `~/.grok/hooks/ask-llm-pair.json`, replacing `<package-root>` with the absolute installed directory. With a custom `GROK_HOME`, use `$GROK_HOME/hooks/ask-llm-pair.json`. Setup does not install this file automatically. Keep only one pair hook registration; this adapter replaces any imported Claude pair hook for Grok.

   ```json
   {
     "hooks": {
       "PostToolUse": [{
         "matcher": "search_replace|run_terminal_command",
         "hooks": [{
           "type": "command",
           "command": "node \"<package-root>/scripts/grok-pair-watch.mjs\"",
           "timeout": 1800
         }]
       }]
     }
   }
   ```

4. Restart Grok and inspect `/hooks`. Global hooks run in headless `grok -p`; a project-scoped `.grok/hooks/` registration needs folder trust first. Explain that a trust grant covers the folder's other trust-gated integrations too. Tests must use private isolated `HOME` and `GROK_HOME`; never edit real hook or trust files to test this adapter.

## Review and lifecycle

```text
search_replace        -> read resulting file -> shared review prompt
run_terminal_command  -> command text only   -> shared review prompt
                                              |
                           Codex or Claude review (foreground)
                                              |
                           PostToolUse additionalContext -> Grok's next step
```

Grok ignores the guide's `async` field. The adapter reviews synchronously, ignoring debounce settings on this host, and prints `hookSpecificOutput.additionalContext` before exiting. The turn waits for review; there is no detached delivery or Stop gate. `PostToolUse` cannot undo an edit. Verify and address findings before continuing.

Shell events expose the command text as given, **no diff or resulting file contents**. Every `run_terminal_command` is eligible because the adapter cannot reliably infer which shell programs edit files. Commands may fail or make no edits. The prompt states this limit; oversized commands receive a partial view. Shell state/logs use the synthetic path `[shell command]` under the event cwd. Include/ignore patterns apply to that path, not inferred shell targets. File reviews retain the shared file context cap and adaptive context behavior.

The marker, pause sentinel, auto-pause/resume, failure counters, cache, review format, concern hashes and log all use `.codex-pair/`. Pause and resume via the corresponding portable skills. Acknowledgements use the same file-scoped hash as the Claude Stop gate (`hashConcernBody(relativePath + ':' + concernText)`), and suppress Grok's advisory output for that concern; logs retain the original review. Read the log for the concern text, compute the hash with `scripts/lib/state.mjs`, then use the ack skill with a user-owned reason. Shell acknowledgements use the relative synthetic path. Review failures surface as failures, never successful coverage. Codex quota fallback retains the existing disclosed Terra route; Claude failure never switches reviewer.

Report host=Grok CLI, reviewer, exact requested model, observed fallback if any, state, latest verdict and coverage (`file` or `command-text`). Keep pause/resume/ack names under `codex-pair` for compatibility; selecting Claude does not create another feature or state directory.
