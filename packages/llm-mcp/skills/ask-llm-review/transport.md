# Ask LLM transport on hosts other than Claude Code and Pi

`ask-llm setup` registers the Ask LLM MCP server as `ask-llm` in each host. Each host adds its own prefix to tool names (Claude Code shows `mcp__ask-llm__ask-llm`), so match a tool by its server and leaf name, never by prefix.

## Codex calls

Use the first rung that is available. A call that fails on one rung is reported as a failure; it is never retried on a later rung.

1. An exposed `ask-codex` tool (from `@ask-llm/codex-mcp`, including the Claude plugin's bundled `codex` server). Pass `prompt`, the exact `model`, `reasoningEffort` and `sandbox` the skill names, plus `includeDirs` and `preferred` when used.
2. Otherwise the `ask-llm` server's `ask-llm` tool with `provider: "codex"` and the same fields. Read its input schema before the first call. If any of `reasoningEffort`, `includeDirs`, `preferred` or `sandbox` is missing, stop and say this Ask LLM server is too old for the workflow and `npm install -g @ask-llm/mcp` updates it; never call it with fewer fields.
3. Otherwise, only when neither tool is exposed, run the Codex CLI: `codex exec --sandbox <sandbox> -m <model> -c model_reasoning_effort="<effort>" -` with the prompt on stdin. Say in the result that it ran through the Codex CLI because Ask LLM's server was not available.

If none of the three is available, stop and tell the user to run `ask-llm setup`. Always report the transport used, the requested model, and the model the response reports, including any quota fallback.

## Other providers

Call the provider's own tool when exposed (`ask-gemini`, `ask-grok`, `ask-ollama`, `ask-antigravity`), otherwise the `ask-llm` tool with an explicit `provider` and, when the user named one, the exact `model`. There is no CLI fallback: if neither tool is exposed, stop and tell the user to run `ask-llm setup`.

## Several providers at once

Use one `multi-llm` call with `prompt` and the explicit `providers` list. It dispatches in parallel and returns every provider's result, including failures, in the order given.
