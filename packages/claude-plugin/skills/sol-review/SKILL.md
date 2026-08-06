---
name: sol-review
description: Review the current code changes specifically with OpenAI GPT-5.6 Sol. Use when the user asks for a Sol review, says "review with Sol", wants a model-pinned Codex review, or invokes /sol-review.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Gather a bounded diff and context brief, request a read-only Codex review explicitly pinned to `gpt-5.6-sol` with `reasoningEffort: "high"`, verify findings against source, and disclose any model or transport fallback. Do not silently substitute another provider.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Call `ask-codex` with `model: "gpt-5.6-sol"`, `reasoningEffort: "high"`, and `sandbox: "read-only"`; apply only the portable contract in `../../agents/sol-reviewer.md` and disclose fallback metadata.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Sol Code Review

Run a read-only, precision-first review explicitly pinned to GPT-5.6 Sol at high reasoning effort.

## Workflow

1. Run `git status --short`, `git diff`, and `git diff --cached`.
2. Include untracked files the user wants reviewed with `git add -N <path>` so their contents appear in the diff without staging them.
3. If the combined diff is empty, report that there are no changes to review.
4. Read the root and file-scoped `CLAUDE.md` files plus any ADRs cited by changed code.
5. Preflight the transport: check whether an `ask-codex` MCP tool is available in the current session (the name may be plugin-namespaced, e.g. `mcp__plugin_ask-llm_codex__ask-codex`). Subagents do not always inherit the session's MCP servers, so treat availability here as advisory only. If no MCP tool resolves, confirm the `codex` CLI is on `PATH` (`command -v codex`); if neither transport exists, stop and tell the user to install one instead of launching the agent.
6. Launch the `sol-reviewer` agent with the diff and a compact context brief containing the changed files, applicable conventions, referenced ADRs, the user's requested review focus, and the preflight result (which transport to expect).
7. Return the agent's validated findings without adding unverified issues.

The reviewer must call `ask-codex` with `model: "gpt-5.6-sol"` and `reasoningEffort: "high"`, or, when no `ask-codex` MCP tool is available in the subagent context, use the sanctioned CLI fallback defined in the agent (`codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" -s read-only --ignore-user-config --ignore-rules --skip-git-repo-check`). This explicit pin distinguishes `/sol-review` from `/codex-review`, which follows the configured Codex default. Both fallback kinds must be disclosed in the report: a Terra quota fallback means the requested Sol review did not complete on Sol, and a CLI transport fallback means the review ran through `codex exec` rather than MCP.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
