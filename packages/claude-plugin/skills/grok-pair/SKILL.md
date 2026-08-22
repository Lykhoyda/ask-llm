---
name: grok-pair
description: Pair with Grok as an explicit independent reviewer while the host edits. Use when the user asks for /grok-pair, Grok pair programming, iterative Grok feedback, or Grok through Cursor Agent. Selects one exact route/model with consent and never falls back.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Apply `../pairing-contract.md`. The host is the editor and Grok is the explicit read-only reviewer. Share bounded context only after consent, relay and verify actionable feedback at checkpoints, preserve exact route/model attribution, reuse a returned Cursor session where supported, propagate cancellation, and terminate clearly without silent provider, harness, or model fallback.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Cursor Agent adapter

When Cursor itself hosts this skill, do not recursively launch `ask-cursor-agent`. Offer only the explicit direct routes (`xai-api` or `grok-cli`) through an exact `ask-grok` leaf or a fully pinned unified `ask-llm` leaf, and follow the same consent and no-fallback contract. The Cursor plugin bundle registers only the unified `ask-llm` server; a separately user-installed `grok` entry (`@ask-llm/grok-mcp`) exposes the deterministic `ask-grok` leaf and is preferred when exposed. A unified call must specify `provider: "grok"`, exact `harness`, exact `model`, and `reasoningEffort`; direct Grok is one-shot and does not accept include directories or sessions.

If neither leaf is exposed, stop and give this Cursor-native setup (never `claude mcp add`):

```json
{"mcpServers":{"ask-llm":{"command":"npx","args":["-y","@ask-llm/mcp"]}}}
```

Save it as project `.cursor/mcp.json` or user `~/.cursor/mcp.json`. For `xai-api`, ensure `XAI_API_KEY` is present in the MCP server process environment; keep any literal secret in the user-level config and never commit it. For `grok-cli`, install/authenticate Grok Build and verify `grok --help` advertises headless JSON support. Reload the server from **Cursor Settings → Tools & MCP** or restart Cursor Agent, verify that `ask-llm` is exposed, then invoke `/grok-pair` again. The split alternative is the same entry named `grok` with package `@ask-llm/grok-mcp`, which exposes `ask-grok`; keep one registration per server and do not configure both merely to create fallback.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

# `/grok-pair`

Run an iterative pair-programming session in which Claude remains the sole editor and Grok is the independent reviewer.

## 1. Parse and lock the route

Accept optional command text in this form (ask for any missing choice):

```text
/grok-pair route=cursor-agent model=cursor-grok-4.6-high include=packages/api,packages/shared <task>
/grok-pair route=xai-api model=grok-4.6 effort=xhigh <task>
/grok-pair route=grok-cli model=grok-build effort=high <task>
```

Supported routes:

1. `cursor-agent` — preferred **only when** an `ask-cursor-agent` MCP tool is actually exposed and the user supplies an exact Grok-family ID from `agent --list-models`. Use `provider: "grok"`; never use Auto. Reasoning effort remains part of the exact Cursor catalog ID, not a separate generic option.
2. `xai-api` — call `ask-grok` with `harness: "xai-api"`, exact model, and explicit `reasoningEffort`. Requires `XAI_API_KEY`; metered xAI API pricing is separate from consumer subscriptions.
3. `grok-cli` — call `ask-grok` with `harness: "grok-cli"`, an exact ID from `grok models`, and explicit `reasoningEffort`. Uses the authenticated official Grok Build plan.

Inspect the current tool surface by leaf capability. The Claude plugin bundles only Codex; Cursor and Grok tools come from user-scoped registrations such as `mcp__ask-llm__ask-cursor-agent`, `mcp__ask-llm__ask-llm`, or `mcp__grok__ask-grok`, so match on the `__ask-cursor-agent`, `__ask-grok`, or `__ask-llm` leaf and never on one assumed prefix. When no `ask-grok` leaf exists but the unified `ask-llm` leaf does, a direct route may use `ask-llm({ provider: "grok", harness, model, reasoningEffort, prompt })` only with every one of those fields pinned explicitly; the unified schema rejects unsupported combinations instead of stripping them. An unpinned generic call or a raw CLI never replaces a missing selected tool.

If both Cursor and direct tools exist and no route was given, recommend Cursor Agent and show the direct alternatives, then use `AskUserQuestion` to obtain an explicit selection. Once selected, route/model/effort are immutable. A failure is terminal for that route.

## 2. Bound context and obtain consent

Read `../pairing-contract.md`. Determine the task, changed files, project instructions, tests, and requested relative include directories. Reject absolute, `..`, and `~` paths and cap the list at 32. Prepare a context manifest before reading extra directories:

```text
Host: Claude Code
Reviewer provider: grok
Harness: cursor-agent | xai-api | grok-cli
Requested model: <exact ID>
Reported model: pending
Reasoning: <exact Cursor model ID carries tier | low|medium|high|xhigh>
Shared context: <files/directories and byte bounds>
Session: fresh resumable Cursor conversation | one-shot
Cost/credential boundary: <Cursor plan/spend | xAI API | Grok Build plan>
```

Use `AskUserQuestion` with **Start pairing** and **Cancel**. Do not invoke a tool or widen filesystem reads on refusal. For direct API/CLI routes, `includeDirs` is unsupported: offer to inline bounded excerpts or omit them; never silently discard the request.

## 3. First reviewer checkpoint

Build a prompt under 100 KB containing the reviewer role, task/acceptance criteria, relevant project invariants, bounded diff/excerpts, tests already run, and focused questions. Require concise findings with severity, file/line evidence, consequence, and a proposed next action; require `NO CONCERNS` when appropriate.

Call exactly one selected tool:

- Cursor: `ask-cursor-agent({ provider: "grok", model, prompt, includeDirs })`.
- Direct: `ask-grok({ harness, model, reasoningEffort, prompt })`, or the fully pinned `ask-llm({ provider: "grok", harness, model, reasoningEffort, prompt })` when only the unified tool is registered.

For Cursor, capture `sessionId`, exact `model`, `harness`, and optional `reportedModel` from structured output. Treat a cross-provider label, a requested Auto/noncanonical ID, a changed exact model, or an absent final result as failure. If an unclassifiable display label such as `Auto` is merely reported, preserve it separately and flag the uncertainty; do not guess that it replaced the exact requested ID. Direct Grok transports are one-shot and return no session.

## 4. Relay, act, and re-check

Relay Grok's feedback before editing. Verify each finding against source and label it accepted, rejected, or deferred with reason. Claude makes the edits. At meaningful checkpoints, send only the bounded delta plus outcomes of prior findings:

- Cursor route: reuse the returned `sessionId`, preserving the same provider/model and include directories.
- Direct route: make a new one-shot call through the same harness/model/effort and disclose that continuity comes from the bounded recap, not a provider session.

Do not hide partial success. If checkpoint 1 succeeded and checkpoint 2 fails, retain checkpoint 1's feedback and report `failed (partial)` with the failed stage.

## 5. Cancellation and final report

If the user cancels or interrupts, stop the in-flight MCP call and report `cancelled`; never retry another route. On completion report:

```text
grok-pair completed | cancelled | failed | failed (partial)
Host / provider / harness: Claude Code / grok / <route>
Requested model: <exact ID>
Reported model: <label or not reported>
Reasoning: <explicit effort semantics>
Session: <ID reused N times | one-shot>
Context shared: <bounded files/include dirs>
Accepted / rejected / deferred findings: <counts and actions>
Fallback: none
```

## Setup failures

Give guidance for the selected route only:

- Missing Cursor tool: `claude mcp add --scope user ask-llm -- npx -y @ask-llm/mcp` (exposes `ask-cursor-agent` and the unified `ask-llm` tool); authenticate `agent`, run `agent --list-models`, and restart Claude Code.
- Missing direct tool: `claude mcp add --scope user grok -- npx -y @ask-llm/grok-mcp` for the `ask-grok` leaf, or the same `@ask-llm/mcp` registration for the fully pinned unified form, then restart.
- Cursor unavailable/trust/model errors: follow the returned `agent --version`, explicit workspace trust, or `agent --list-models` guidance. Never pass `--trust` automatically.
- xAI/API or Grok CLI auth/model/quota errors: preserve the redacted diagnostic and state that no fallback was attempted.
<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
