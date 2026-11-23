# Ask LLM transport on hosts other than Claude Code and Pi

`ask-llm setup` registers the Ask LLM MCP server as `ask-llm` in each host. Each host adds its own prefix to tool names (Claude Code shows `mcp__ask-llm__ask-llm`), so match a tool by its server and leaf name, never by prefix.

## Codex calls

Use the first rung that can honor every field the call needs. Read the chosen tool's input schema first: a tool that lacks a needed field is skipped, never called with fewer fields. A call that fails on one rung is reported as a failure; it is never retried on a later rung.

1. For read-only calls, an exposed `ask-codex` tool; for `sandbox: "workspace-write"`, an exposed `ask-codex-write` tool (from `@ask-llm/codex-mcp`, including the Claude plugin's bundled `codex` server). Pass `prompt`, the exact `model`, `reasoningEffort` and `sandbox` the skill names, plus `includeDirs` and `preferred` when used.
2. Otherwise the `ask-llm` server's `ask-llm` tool with `provider: "codex"` and the same fields. Read its input schema before the first call. If any of `reasoningEffort`, `includeDirs`, `preferred` or `sandbox` is missing, stop and say this Ask LLM server is too old for the workflow and `npm install -g @ask-llm/mcp` updates it; never call it with fewer fields.
3. Otherwise, only when neither tool is exposed, run the Codex CLI: `codex exec --ephemeral --skip-git-repo-check --sandbox <sandbox> -m <model> -c model_reasoning_effort="<effort>" --add-dir <dir> -` with one `--add-dir` per requested directory and the prompt on stdin. If it fails with a quota or usage-limit error, repeat the same command once with the same prompt and options (including `--ephemeral`), changing only the model to `-m gpt-6.1-terra`, and disclose that fallback; report any other failure as is. The CLI cannot express `preferred`, so a call that needs it stops here instead. Say in the result that it ran through the Codex CLI because Ask LLM's server was not available.

If none of the three is available, stop and tell the user to run `ask-llm setup`. Always report the transport used, the requested model, and the model the response reports, including any quota fallback.

### Strict read-only Codex calls

When brainstorm requires one attempt, use the same schema-aware ladder with these pins:

1. Prefer an exact `ask-codex` read-only leaf advertising `model`, `reasoningEffort`, `sandbox`, `noFallback` and `includeDirs` if needed. Pass the exact ID, `reasoningEffort: "high"`, `sandbox: "read-only"` and `noFallback: true`. Omit `sessionId`.
2. Otherwise use the registered `ask-llm` leaf if it advertises Codex and every pin above plus `preferred` and `includeDirs`. Pass `provider: "codex"`, `preferred: false` and explicit `includeDirs` (empty when none). Use it even if a stale split leaf was exposed.
3. If either leaf is exposed and neither is capable, stop and ask the user to upgrade the relevant package and restart the host or MCP connection. An advertised but disconnected tool still counts as exposed. If neither leaf is exposed and local CLI is permitted, disclose CLI transport and make one foreground call to `bash <ask-llm-brainstorm skill directory>/codex-strict.sh <exact-id> high` with the bounded prompt on stdin. Allow time for high reasoning effort and treat timeout as terminal. This helper uses one read-only ephemeral `codex exec --json` run and validates the terminal event. If additional directories are required, use a compatible tool.

After selecting a rung, its failure ends the consultation. Relay the model as selected, the effort as configured, and any error from that rung. Reject a fallback or a different selected model. The ordinary review ladder above remains the route for calls that do not require this strict contract.

## Other providers

Call the provider's own tool when exposed (`ask-gemini`, `ask-grok`, `ask-ollama`, `ask-antigravity`), otherwise the `ask-llm` tool with an explicit `provider`. Pass every field the skill or the user specifies, such as an exact `model`, `reasoningEffort` or `includeDirs`, checked against the tool's input schema: when the provider's own tool lacks one (for example `ask-antigravity` has no `model`), use `ask-llm` instead, and when neither can honor it, stop and name the field. There is no CLI fallback: if neither tool is exposed, stop and tell the user to run `ask-llm setup`.

## Several providers at once

Read the exposed `multi-llm` tool's input schema before dispatch. Compare the requested provider list with its `providers` item enum. Report each unsupported selection as unavailable, and retain the supported subset in the requested order. If the tool is absent or the subset is empty, report that no selected provider can be dispatched, tell the user to run `ask-llm setup`, and stop without a tool call.

Otherwise make one `multi-llm` call with the common `prompt` and the explicit supported `providers` subset, even when only one provider remains. It dispatches in parallel and returns each dispatched provider's result, including failures. Present those results together with the unavailable selections in the original requested order. Label a panel with missing or failed participants as partial; a single successful answer is not multi-provider consensus. If no provider succeeds, report failure without a panel synthesis.
