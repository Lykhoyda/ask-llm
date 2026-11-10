### Cursor Agent adapter

Cursor discovers this `SKILL.md` through its supported Agent Skills surface; `/codex-pair` attaches it as an explicit command. Do **not** use Claude Code's `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`, `CLAUDE_PLUGIN_ROOT`, `AskUserQuestion`, or plugin tool namespaces. This adapter is an on-demand iterative pairing session, not a claim that Claude hooks were registered in Cursor.

1. Read `pairing-contract.md`. The Cursor plugin bundle registers only the unified `ask-llm` server; if the user separately installed `@ask-llm/codex-mcp`, prefer that deterministic `ask-codex` leaf. Resolve an exposed MCP tool whose exact leaf is `ask-codex`; do not assume its server prefix. When only the unified `ask-llm` leaf is registered, it may serve as the transport with `provider: "codex"` and every option (model, reasoning effort, include directories, sandbox, session) pinned explicitly; its schema rejects unsupported combinations instead of stripping them. Inspect the advertised schema before the first call: if `sandbox` or another required Codex option is missing, stop and upgrade `@ask-llm/mcp` rather than omitting the field. Never make an unpinned generic call. If neither tool is exposed, stop with the recommended user-installed unified server:
   ```json
   {"mcpServers":{"ask-llm":{"command":"npx","args":["-y","@ask-llm/mcp"]}}}
   ```
   Save that as project `.cursor/mcp.json` or user `~/.cursor/mcp.json`, ensure `codex` is authenticated, reload the server from Cursor Settings → Tools & MCP or restart Cursor Agent, and invoke `/codex-pair` again. A split `codex` entry using `@ask-llm/codex-mcp` is an explicit user-installed alternative when only the `ask-codex` leaf is desired; keep one registration per server (the plugin already provides `ask-llm`, so do not add a second `ask-llm` entry merely to duplicate it).
2. Require both `model=<exact ID>` and `effort=low|medium|high|xhigh|max|ultra`; parse optional `include=dir1,dir2`. If model or effort is omitted, ask the user to confirm the pair defaults `model=gpt-6.1-sol` and `effort=high`, then stop before reading extra context, requesting consent, or calling a provider. Do not infer either value from the Cursor host environment: the MCP server may resolve different `ASK_CODEX_MODEL` or `ASK_CODEX_REASONING_EFFORT` values. Reject absolute, `..`, and `~` include paths; cap at 32. Build a bounded context manifest (20 KB/file, 100 KB/request) from task requirements, relevant project instructions, changed files, and tests. Do not send secrets or unrelated files.
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
         "sessionId": "",
         "sandbox": "read-only"
       }
     }
   ]
   ```
   The prompt assigns Codex the independent reviewer role and requests actionable severity/file/line evidence. Capture the returned structured `sessionId`/Thread ID and actual model. Relay feedback before changing code; verify every finding against source and label it accepted, rejected, or deferred.
5. At meaningful checkpoints, call the same tool with the captured `sessionId`, same model/effort, and bounded delta. Keep `sandbox: "read-only"` on both `ask-codex` and unified `ask-llm`. If the unified schema lacks `sandbox`, stop and upgrade `@ask-llm/mcp` rather than omitting it. Omit `includeDirs` on resumed calls because `codex exec resume` does not support them (every Codex transport — split `ask-codex`, unified `ask-llm`, and Pi — rejects that combination at the shared executor instead of dropping the directories); never silently strip them from the first call. If no session ID was returned, stop with a session diagnostic instead of pretending continuity.
6. A Cursor interrupt cancels the MCP request. Report `cancelled` and never retry another tool/model/provider. Preserve earlier feedback on later failure and report `failed (partial)`. On success report `completed` with host, provider, requested/actual model, effort, session reuse count, context/include directories, accepted/rejected/deferred actions, and any reported Codex quota fallback. Never conceal fallback or rewrite a model.

### Other hosts adapter

Codex, Antigravity, Gemini CLI and OpenCode follow the Cursor Agent adapter in this file: it needs only the Ask LLM MCP tools and a conversational confirmation. `ask-llm setup` registers the server there, so skip the Cursor `mcp.json` snippet and point to `ask-llm setup` instead.
