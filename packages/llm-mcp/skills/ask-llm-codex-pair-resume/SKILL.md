---
name: ask-llm-codex-pair-resume
description: Resume codex-pair for this project after a previous pause. Removes `.codex-pair/state/paused` and clears failure state. Review resumes on the next supported file edit; missing state is a no-op.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Remove the project-local pause sentinel and clear the consecutive-failure counter. The next supported edit can be reviewed.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Run `/codex-pair-resume` or remove the sentinel and failure counter as described in the portable contract.

### Other hosts adapter

From the project, run `node "<package-root>/scripts/codex-pair-log.mjs" resume`, using the installed `@ask-llm/mcp` package directory. The CLI finds the project marker and records the transition. Done when the command confirms the resume or reports there was no pause. Show any previous auto-pause details the command prints.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

From the project, run the plugin's command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-pair-log.mjs" resume
```

Done when the command confirms the resume or reports there was no pause. Show any previous auto-pause details the command prints.
<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
