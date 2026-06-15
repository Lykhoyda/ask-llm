---
description: Proven recipes for AI-to-AI code review, architecture debates, and large-codebase analysis using Codex, Antigravity, Ollama, Gemini, and multi-provider parallel dispatch.
---

# Strategies & Examples

Copy-paste recipes that get the most out of Ask LLM. Each maps to a job — a second opinion, a plan debate, a diff review, a big read, or a private check — and to the provider that fits it best.

## The `@` File Syntax (Gemini)

When working with the `ask-gemini` tool (or the Gemini CLI directly), the `@` symbol is how you include files, directories, or globs in your prompt:

```text
Ask Gemini to explain @index.js and @src/auth.ts
Ask Gemini to summarize the architecture in @src/
What is the purpose of this project? Read @. (current directory)
review @routes/**/*.js for OWASP vulnerabilities
```

This is a Gemini CLI feature — Codex, Antigravity, and Ollama don't have direct equivalents. Quote or paste the relevant code into the prompt instead, or use `multi-llm` and let Gemini handle the file reading while the others work from the same prompt text.

> **Tip:** Including `package.json` (`@package.json @src/`) helps Gemini understand your dependencies before analyzing your code.

---

## Workflow Patterns

### 1. Second Opinion Code Review

Don't rely on one AI model — get a second perspective before committing or merging.

**Single provider:**

```text
Ask Codex to review the staged changes for security issues, performance, and missing error handling.
Ask Gemini to do the same review on @feature/new-api/*.js — focus on edge cases.
```

**Multi-provider (with verification, plugin only):**

```text
/multi-review
```

The `/multi-review` skill dispatches to Antigravity + Codex in parallel, then **verifies each high-confidence finding against the actual source** before presenting. Findings are classified as VERIFIED / REJECTED / UNVERIFIABLE — false positives get caught instead of acted on. See [ADR-064](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md).

**Multi-provider (raw, no synthesis):**

```text
/compare review my staged changes for race conditions
```

The `/compare` skill returns each provider's verbatim response side-by-side. No synthesis, no consensus extraction — useful when you want to see how each model phrases the same answer.

### 2. Massive Codebase Analysis

Claude is excellent at writing code, but its context window gets expensive when you ask it to read a lot. Offload heavy reading to Gemini's 1M+ token context (Gemini CLI is [enterprise-gated from 2026-06-18](/providers/gemini) — on other plans, use `ask-antigravity` for large-context reads):

```text
# Architecture overview
Ask Gemini to give me a high-level overview of how the frontend and backend connect based on @package.json @src/index.js @client/App.jsx

# Dependency analysis
Ask Gemini: @package.json @package-lock.json — are there any security vulnerabilities or outdated packages?

# Cross-package monorepo analysis
Ask Gemini with includeDirs ["packages/api", "packages/shared"] to review how the API uses the shared types
```

On a non-enterprise plan, run the same large-context read through Antigravity (`agy`) instead — it takes file context via `includeDirs`, not `@`:

```text
Use ask-antigravity with includeDirs ["packages/api", "packages/shared"] to review how the API uses the shared types
```

Gemini reads, Claude edits — the canonical Ask LLM pattern.

### 3. Debugging Complex Stack Traces

Feed the error log + relevant source code together:

```text
@error.log @src/api.js — I'm getting 500 errors on the /user endpoint after our recent deployment. Have Gemini find the root cause.
```

For an alternate perspective, dispatch the same context to Codex via `multi-llm` — different models often spot different things:

```text
Use multi-llm with providers gemini and codex to analyze why /user returns 500. Context: @error.log @src/api.js
```

### 4. Architecture Debate

When choosing between approaches, get multiple providers' opinions and let Claude synthesize:

```text
/brainstorm Should we use server-sent events or WebSockets for our notification system? Pros, cons, and which fits a team that values backwards compatibility.
```

The `/brainstorm` skill runs Claude Opus's own research (reads your real codebase), dispatches to Antigravity + Codex in parallel, and returns a synthesis with consensus / unique / contradictory points. Verified findings (Claude reading actual files) outweigh inferred ones.

### 5. Multi-Turn Iterative Refinement

Sessions persist across calls. Use them for back-and-forth:

```text
Call 1: Ask Gemini to review @src/auth.ts for security issues
        → response includes [Session ID: abc-123]

Call 2: Ask Gemini to fix the XSS issue you found, sessionId abc-123
        → Gemini remembers the review

Call 3: Ask Gemini to write tests for the fix, sessionId abc-123
        → continues the same thread
```

Gemini, Codex, and Ollama support sessions ([ADR-058](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)); Antigravity is single-turn. For programmatic clients, the `sessionId` is also exposed structurally via `result.structuredContent.sessionId` — no need to regex-parse the response footer ([ADR-065](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)).

### 6. Quick Sanity Check via REPL

For one-off questions where you don't want to set up an MCP client invocation:

```bash
npx ask-llm-mcp repl
```

```
gemini> what does TypeScript's `satisfies` operator do?
gemini> /provider codex
codex> same question — what's your take?
codex> /usage
```

Multi-provider switching, persistent sessions per provider, live token tracking. Good for exploratory work and direct provider comparison without the MCP server overhead.

### 7. Private Code Review (Local-Only)

For code that can't leave your machine — proprietary IP, regulated industries, security-sensitive work:

```text
Ask Ollama to review src/payment-flow.ts for any obvious bugs or security issues.
```

Or via the unified orchestrator:

```text
Use ask-llm with provider ollama to review my recent changes
```

Ollama runs entirely locally, never makes a network call to a third party. The MCP server stores any session state at `/tmp/ask-llm-sessions/<id>.json` with **owner-only permissions** (0o600 / 0o700 — see [ADR-063](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) so prompts and responses don't leak to other users on shared systems.

---

## Best Practices

1. **Start broad, then narrow.** "First analyze the architecture" → "Now focus on the auth module" → "Write tests for the auth module."
2. **Be specific about intent.** Don't say *"analyze this code."* Say *"identify performance bottlenecks and suggest optimizations targeting junior developers."*
3. **Let the defaults work.** Each provider auto-falls back to a lighter model on quota errors — you don't usually need to override the model parameter.
4. **Use `multi-llm` or `/compare` when you want raw multiple perspectives.** Use `/multi-review` when you want verified findings (catches false positives).
5. **Use sessions for iteration**, not for one-shot questions. The cost overhead isn't worth it if you won't follow up.
6. **Check `/usage` periodically** in the REPL or call `get-usage-stats` to see what you're spending — both Gemini Pro and Codex GPT-5.5 can rack up tokens fast on large prompts.
7. **Run `npx ask-llm-mcp doctor`** when something doesn't work before opening an issue. It catches 90%+ of setup problems with a clear diagnostic line per check.
