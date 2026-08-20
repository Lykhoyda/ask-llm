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
5. Preflight the transport through the shipped executable contract:
   - Search the current tool surface for the exact `ask-codex` leaf tool. The executable correlates its client-assigned server prefix with an active `@ask-llm/codex-mcp` registration; similarly named tools and tools from unrelated servers are not authoritative.
   - Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/sol-review-transport.mjs" --plugin-dir "${CLAUDE_PLUGIN_ROOT}" --cli-path "$(command -v codex || true)"`, adding `--tool "<resolved tool name>"` only when the exact `ask-codex` tool resolved. Mirror any session-local `--mcp-config`, `--settings`, `--setting-sources`, and `--strict-mcp-config` flags so the nested inventory sees the same configuration as the active session.
   - Preserve the returned `state`, `diagnostic`, `remediation`, and `fallbackDisclosure`. The executable reads `claude mcp list` with that session context: `missing-registration` means that active inventory has no supported registration; `unavailable` means it contains the registration but the current tool surface does not expose a usable tool, reports failed health, or the MCP invocation failed; `inventory-unavailable` means the active inventory could not be inspected, so registration and service health are unknown. Do not collapse those states into a generic "no MCP" message. If `transport` is null, stop and show the executable remediation instead of launching the agent.
   - Parent availability remains advisory because subagents do not always inherit the session's MCP servers. The reviewer's fallback runner re-reads the active inventory and reclassifies the absent subagent tool before executing the CLI fallback.
6. Launch the `sol-reviewer` agent with the diff and a compact context brief containing the changed files, applicable conventions, referenced ADRs, the user's requested review focus, and the complete preflight result.
7. Return the agent's validated findings without adding unverified issues.

The reviewer must call `ask-codex` with `model: "gpt-5.6-sol"` and `reasoningEffort: "high"`, or use the shipped CLI fallback runner when no usable `ask-codex` MCP tool is available or its invocation fails at the transport/service boundary. That runner executes the sanctioned `codex exec -m gpt-5.6-sol -c model_reasoning_effort="high" -s read-only --ignore-user-config --ignore-rules --skip-git-repo-check` contract and relays its result unchanged. This explicit pin distinguishes `/sol-review` from `/codex-review`, which follows the configured Codex default. Both fallback kinds must be disclosed in the report: a Terra quota fallback means the requested Sol review did not complete on Sol, and a CLI transport fallback must report missing registration, registered-service unavailability, or an unreadable inventory without claiming a state that could not be determined.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
