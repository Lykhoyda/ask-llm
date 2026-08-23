---
description: Natural language patterns for AI-to-AI collaboration. Use the @ file syntax to include code in prompts. Reference for every Ask LLM MCP tool.
---

# How to Ask

You don't need to memorize commands or rigid syntax to use Ask LLM. The MCP tools work via natural language; your AI client decides when to delegate and which provider to use.

## Just Ask Naturally

Because your MCP-enabled assistant natively integrates these tools, it knows when to route requests to Codex, Claude, Grok, Antigravity, Ollama, or Gemini based on what you say:

- *"Ask Codex to review my staged changes for security issues before I commit."*
- *"Ask Claude for an independent critique of this plan before Codex implements it."*
- *"Have Antigravity debate this architecture plan and suggest alternatives."*
- *"Ask Ollama to explain how this auth flow works (keep it local)."*
- *"Ask Gemini to scan @routes/\*\*/\*.js for OWASP issues."*
- *"Have multi-llm send this question to Codex and Gemini in parallel, I want to compare their answers."*
- *"What do Codex and Gemini think about this architectural decision? Give me their raw responses, no synthesis."* → triggers `/compare` if you have the plugin
- *"Review my latest changes for security issues."* → triggers `/multi-review` (verified findings) if you have the plugin

### Mixing Tool Context Automatically

You can combine context (an error log, a stack trace, a diff) with a request without manually attaching files:

> *"I'm getting a null pointer error in my auth handler here. Have Codex help me find the bug."*

Your AI client extracts the relevant files from its conversation context and passes them to Codex for you.

---

## The `@` File Syntax (Gemini)

When you want to explicitly include files in a prompt sent to Gemini, use the `@` symbol:

```text
Ask Gemini to summarize @README.md
Ask Gemini to review @src/auth.ts and @src/session.ts together
Ask Gemini to give me a high-level overview of @. (current directory)
Ask Gemini to scan @routes/**/*.js for OWASP issues
```

This is a Gemini CLI feature; `@` syntax is interpreted by `gemini`, not by the MCP server. Codex, Claude, Grok, Antigravity, and Ollama don't interpret `@`, so quote or paste the relevant code into the prompt (Claude and Antigravity can take file context via `includeDirs` → `--add-dir`).

---

## Under the Hood: MCP Tools

For advanced users or when building automated AI workflows, these are the MCP tools the servers expose:

### Unified orchestrator (`@ask-llm/mcp`)

#### `ask-llm`

Send a prompt to any installed provider, picked via the `provider` parameter.

**Parameters:**
- `prompt` (required): The question, code review request, or analysis task.
- `provider` (required): One of `codex`, `claude`, `antigravity`, `ollama`, `gemini` (only providers detected at startup are accepted). Claude is intentionally unavailable when Claude Code itself is the host because nested Claude sessions are unsupported.
- `model` (optional): Override the default model. Usually unnecessary; defaults are sensible per provider with auto-fallback.
- `sessionId` (optional): Resume a previous conversation. For Codex, pass `""` on the first call to create a persisted thread, then pass its returned Thread ID; omitting it makes the Codex call ephemeral. For other providers, pass the value from a prior response's `[Session ID: ...]` footer (or `result.structuredContent.sessionId` for programmatic clients).

**Returns:** Both human-readable text (`content[0].text`) AND a structured `AskResponse` (`structuredContent`) with `{provider, response, model, sessionId, usage}`; programmatic clients can extract fields directly without regex-parsing the footer.

#### `multi-llm`

Dispatch the same prompt to multiple providers in parallel; returns all responses in one structured payload.

**Parameters:**
- `prompt` (required): The prompt to send to all selected providers.
- `providers` (optional): Array of providers to dispatch to. Defaults to all available.

**Returns:** `MultiLlmReport` with `{dispatchedAt, totalDurationMs, successCount, failureCount, results: [{provider, ok, response?, model?, sessionId?, usage?, durationMs, error?}, ...]}`. Per-provider failures are isolated; one provider's quota issue doesn't fail the whole call.

#### `get-usage-stats`

Per-session token totals, fallback counts, breakdowns by provider/model. In-memory, no persistence; resets when the MCP server restarts.

#### `diagnose`

Self-diagnosis: Node version, PATH resolution, provider CLI presence + versions. Read-only. Returns both human-readable text and a structured `DiagnosticReport`; provider entries can include nested `enrichment` (`heading`, `overall`, and detailed `checks` with optional remediation), including Codex's `codex doctor --json` health details when available.

#### `ping`

Zero-cost connection test. Lists detected providers.

### Per-provider servers (`@ask-llm/gemini-mcp`, `@ask-llm/codex-mcp`, `@ask-llm/claude-mcp`, `@ask-llm/grok-mcp`, `@ask-llm/ollama-mcp`, `@ask-llm/antigravity-mcp`)

Each per-provider server exposes its provider's `ask-*` tool with the richer per-provider parameter set, plus the shared `get-usage-stats` and `ping`.

#### `ask-gemini`

Same shape as `ask-llm` but always Gemini. Adds Gemini-specific behavior: `@` file syntax, `--include-directories` support via `includeDirs`, `stream-json` live progressive output.

#### `ask-gemini-edit`

Returns structured OLD/NEW edit blocks rather than free-form text. Use this when you want Gemini to suggest specific code changes you can apply directly.

**Parameters:**
- `prompt` (required): Describe the change you want.
- `model`, `includeDirs`: same as `ask-gemini`.

#### `fetch-chunk`

Used automatically when Gemini's response is larger than a single MCP message allows. Returns subsequent chunks from the cached response.

#### `ask-claude`

Pre-bound to Anthropic Claude Code CLI for use by Codex and other non-Claude hosts. Accepts `prompt`, `model`, native `sessionId`, and validated relative `includeDirs`. It runs with `--safe-mode` and only Read, Glob, and Grep tools; Bash/Edit/Write and nested MCP tools are unavailable.

#### `ask-codex` / `ask-ollama` / `ask-antigravity`

Same shape as `ask-llm` but pre-bound to the provider. `ask-codex` and `ask-ollama` accept `prompt`, `model`, and `sessionId`. Codex needs `sessionId: ""` on turn one to persist its `thread_id`; Ollama uses server-side message replay. `ask-antigravity` requires `agy` ≥1.1.5 and is single-turn; it accepts `prompt` and `includeDirs` (file context via `agy --add-dir`); there is no `sessionId` and no per-call `model` (set the model with the `ASK_ANTIGRAVITY_MODEL` env var and the reasoning effort with `ASK_ANTIGRAVITY_EFFORT`).

---

## MCP Resources

The orchestrator exposes one MCP Resource for live introspection:

- `usage://current-session`: JSON snapshot of the in-memory `SessionUsage` accumulator. Read at any time for current totals. Same data as the `get-usage-stats` tool but accessible via `resources/read` instead of a tool call.

---

## Plugin Slash Commands (Claude Code only)

If you've installed [the Ask LLM plugin](/plugin/overview), additional slash commands are available:

- `/multi-review`: parallel Antigravity + Codex review **with source verification** of each finding
- `/gemini-review`, `/codex-review`, `/ollama-review`: single-provider reviews
- `/brainstorm`: multi-LLM brainstorm with Claude Opus as a first-class research participant
- `/compare`: side-by-side responses, no synthesis (raw outputs)

See the [Skills page](/plugin/skills) for full descriptions.
