---
name: ask-llm-codex-pair-pause
description: Pause codex-pair for this project without removing `.codex-pair/context.md`. Writes the shared `.codex-pair/state/paused` sentinel. Use during noisy refactors, hook dogfooding, or other temporary review pauses.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Create the project-local `.codex-pair/state/paused` sentinel. A manual pause stays in effect until an explicit resume.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Run `/codex-pair-pause` or create the sentinel as described in the portable contract.

### Other hosts adapter

From the project, run `node "<package-root>/scripts/codex-pair-log.mjs" pause`, using the installed `@ask-llm/mcp` package directory. The CLI finds the project marker and records the transition. Done when the command confirms the pause or reports an existing pause. Show any error.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

From the project, run the plugin's command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-pair-log.mjs" pause
```

Done when the command confirms the pause or reports an existing pause. Show any error. If the project does not ignore `.codex-pair/`, suggest adding it to the developer’s ignore rules.
<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
