---
description: Continue conversations across multiple tool calls using session IDs. Claude, Gemini, Codex, and Ollama support multi-turn; Grok and Antigravity are single-turn.
---

# Multi-Turn Sessions

Continue conversations across multiple tool calls. Instead of starting fresh every time, pass a session ID to resume where you left off; the provider retains the full conversation history.

<SessionThread />

**Claude, Gemini, Codex, and Ollama support sessions:**

| Provider | Mechanism | Replay cost |
|---|---|---|
| Gemini | Native `--resume <id>` | Zero; provider retains state |
| Codex | Native `codex exec resume <id> <prompt>` | Zero; provider retains state |
| Claude | Native `claude --resume <id>` | Zero; provider retains state |
| Ollama | Server-side `messages[]` replay (40-message cap) | Linear in conversation length, but local (free) |

## How It Works

Every session-capable `ask-*` call returns a **session ID** at the end of the response (or `Thread ID` for Codex):

```
[Session ID: bcc639e4-3415-4270-9fe9-260e6a15203a]
```

Pass this ID back on the next call via the `sessionId` parameter:

```
Call 1:  ask-gemini { prompt: "Review @src/auth.ts for security issues" }
         → Response + [Session ID: bcc639e4-...]

Call 2:  ask-gemini { prompt: "Now fix the XSS vulnerability you found",
                      sessionId: "bcc639e4-..." }
         → Gemini remembers the review and generates targeted fixes
```

The same pattern works for `ask-claude`, `ask-ollama`, and the orchestrator's `ask-llm`. Codex requires an explicit persisted first turn: pass `sessionId: ""` on call one, then pass its returned Thread ID on later calls. If Codex `sessionId` is omitted, the call is ephemeral for privacy and its returned Thread ID cannot be resumed.

For programmatic clients, `ask-*` tools also return a structured `AskResponse` via MCP `outputSchema`; use `result.structuredContent.sessionId` instead of regex-parsing the response footer. For Codex, that value is resumable only when the first call passed `sessionId: ""`.

Response caching is bypassed whenever a `sessionId` is provided (including the empty string that starts a fresh session), so a resumed turn always re-runs against the provider instead of returning a cached answer.

## Provider-specific notes

**Claude, Gemini, and Codex** use their CLIs' native session-resume features. Sessions live in each provider CLI's own storage. Cost is zero; the provider retains the prior turns. Codex persists a fresh thread only when its first call passes `sessionId: ""`; omitted Codex calls stay ephemeral. Claude sessions are intended for Codex and other non-Claude hosts; the unified server suppresses Claude inside Claude Code to prevent unsupported nested sessions.

**Ollama** has no native session support. The MCP server stores conversation history at `/tmp/ask-llm-sessions/<id>.json` with **24-hour TTL**, **40-message cap** (oldest dropped on overflow), **owner-only file permissions** (0o600 file / 0o700 directory), and **atomic temp+rename writes** to avoid partial-read races. Each turn replays the full prior conversation, which costs input tokens proportional to depth, bounded by the 40-message cap and acceptable for local-only inference.

To start a fresh Ollama session explicitly, pass `sessionId: ""` (empty string); the executor creates a new UUID and returns it in the response.

---

## Natural Language Usage

You don't need to manually manage session IDs. Just tell your AI assistant to continue the conversation:

- *"Ask Codex to review my auth module, then follow up asking it to fix what it found."*
- *"Ask Claude to critique this plan, then use the same session to challenge its riskiest assumption."*
- *"Have Gemini analyze @src/, then in a second call, ask it which files need refactoring."*
- *"Get Codex's opinion on this PR, then ask it to elaborate on the performance concerns."*

Your AI assistant will request a persisted first turn when Codex is selected, then extract the returned session ID and pass it in the follow-up.

---

## Step-by-Step Example

### 1. Start a review session

```text
"Ask Gemini to review @src/api/routes.ts for error handling gaps"
```

Gemini responds with a detailed review and a session ID at the bottom.

### 2. Drill into specifics

```text
"Using the same Gemini session, ask it to show me exactly how to fix
the unhandled promise rejection in the /users endpoint"
```

Gemini remembers the full review context and gives a targeted fix.

### 3. Validate the fix

```text
"In the same Gemini session, ask if my fix introduced any new issues"
```

Gemini compares against its earlier analysis without re-reading the files.

---

## When to Use Sessions

| Scenario | Without sessions | With sessions |
|----------|-----------------|---------------|
| Code review + fix | The model re-reads files on every call | The model remembers its review findings |
| Architecture debate | Repeat full context each time | Build on previous arguments |
| Iterative analysis | Start from scratch | Refine progressively |
| Multi-step refactoring | Explain the plan again | Continue from last step |

Sessions are especially useful for **large codebases**; the provider's context is preserved across calls, avoiding redundant token usage on file re-reads.

---

## Technical Details

### The `sessionId` parameter

| Property | Value |
|----------|-------|
| Type | `string` (optional) |
| Format | UUID (e.g., `bcc639e4-3415-4270-9fe9-260e6a15203a`) |
| Source | Extracted from `[Session ID: ...]` or a persisted Codex `[Thread ID: ...]` response |
| Resume mechanism | Provider-specific; see the table above |

### Session lifetime

Sessions are managed by the Gemini CLI and persist on disk. They survive MCP server restarts. Use `gemini --list-sessions` to see all available sessions.

### Quota fallback

If a quota error triggers a fallback to Flash, the session ID is preserved; Gemini CLI handles the model switch internally while maintaining conversation history.

### Compatibility with other features

- **Sandbox mode**: Sessions work with `sandbox: true`. The session continues in the sandbox.
- **changeMode**: Session IDs are returned in changeMode responses too, so you can iterate on structured edits across turns.
- **Model override**: You can switch models mid-session by passing a different `model` value alongside `sessionId`.
