---
description: Slash commands for AI code review, brainstorming, and side-by-side multi-provider comparison — /gemini-review, /codex-review, /ollama-review, /multi-review (with verification), /brainstorm, /brainstorm-all, and /compare.
---

# Skills

Skills are slash commands you can invoke directly in Claude Code. Each skill triggers a structured workflow that gathers context, calls a provider, and returns prioritized findings.

> `/gemini-review` works out of the box with the plugin. `/codex-review` and `/ollama-review` require their MCP servers to be added separately — see [Plugin Overview](/plugin/overview#installation).

## Review Skills

All three review skills follow the same pattern:

1. Gather staged and unstaged git changes
2. Read project conventions from `CLAUDE.md`
3. Send the diff + context to the provider
4. Return findings filtered by confidence (80%+ threshold)
5. Group results: **Critical** (90%+) vs **Important** (80-89%)

### `/gemini-review`

Get a second opinion from Google Gemini on your current code changes.

```text
/gemini-review
```

Uses Gemini's 1M+ token context window, making it ideal for reviewing changes that touch many files or require understanding a large codebase.

### `/codex-review`

Get a second opinion from OpenAI Codex (GPT-5.5) on your current changes.

```text
/codex-review
```

Falls back to GPT-5.5-mini automatically if you hit quota limits.

### `/ollama-review`

Get a second opinion from a local Ollama model. No API keys needed — all processing stays on your machine.

```text
/ollama-review
```

Requires Ollama running locally with a model pulled (e.g., `qwen2.5-coder:7b`).

## Brainstorm Skills

### `/brainstorm`

Send a topic to multiple LLM providers AND have Claude Opus perform its own independent research in the same run, then synthesize all findings. The coordinator agent runs:

1. **Phase 3B — Claude Opus research.** Claude reads the actual files, traces real code paths, fetches any referenced external docs, and forms independent findings tagged Verified or Inferred. Always runs — Claude is a first-class participant, not just an orchestrator (see [ADR-049](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)).
2. **Phase 3A — External dispatch.** A single foreground blocking Bash call sends the topic to each requested external provider in parallel and waits for all of them. Up to 10 minutes total (Bash tool max). See [ADR-050](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md) for why this isn't a background-job dispatch.
3. **Phase 4 — Synthesis.** Combines Claude's findings with the external responses:

- Consensus points (where multiple participants agree — Claude verified + external = highest confidence)
- Unique insights (findings from only one participant)
- Contradictions (verified findings outrank inferred ones)
- Actionable recommendations (prioritized by impact and confidence)

```text
# Default external providers (Gemini + Codex), plus Claude Opus always
/brainstorm Should we use a monorepo or polyrepo for this project?

# Custom external providers
/brainstorm gemini,codex,ollama Review this authentication approach
```

**Default external providers:** `gemini,codex` (avoids unnecessary Ollama calls if not needed). **Claude Opus is always a participant** because it runs inside the coordinator — it isn't in the provider list.

### `/brainstorm-all`

Shortcut for `/brainstorm gemini,codex,ollama <topic>`. Sends to all three external providers (Gemini, Codex, Ollama) plus the always-on Claude Opus research phase — up to four participants total.

```text
/brainstorm-all What's the best caching strategy for our API?
```

Requires Ollama running locally since it includes the local provider.

## Multi-Provider Review Skills

### `/multi-review`

Run independent code reviews from Gemini and Codex in parallel, **verify** each finding against the source, then present combined consensus / unique / rejected findings.

```text
/multi-review
```

Pipeline:

1. **Gather and prepare the diff** — `git status` first; `git add -N` for untracked files; pathspec exclusion of docs/binaries (`:!docs/` `:!*.md` `:!yarn.lock` `:!*.png`); 3-tier size policy (`<50KB` send as-is, `50–150KB` warn about expected wall time, `>150KB` ask before sending).
2. **Dispatch with fallback** — preferred path is the `gemini-reviewer` and `codex-reviewer` agents in parallel; falls back to direct Bash dispatch via the plugin's `dist/run.js` and `dist/codex-run.js` runners using the [ADR-050](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md) dispatch pattern when agents are unavailable.
3. **Verify each finding** — for every finding above 80/100 confidence, Read the file at the cited line and check whether the claim is actually true. Classifies as **VERIFIED** (claim holds), **REJECTED** (false positive), or **UNVERIFIABLE** (cannot confirm without runtime). This step exists specifically because confidence scores aren't an oracle — see [ADR-064](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md).
4. **Resilient failure handling** — when a provider fails (timeout, exit ≠ 0, 0-byte output), surface the failure inline with stderr instead of silently dropping. Partial results are explicit.
5. **Synthesis** — combined output with `Verified by both`, `Verified by Gemini only`, `Verified by Codex only`, `Rejected (false positives)`, `Unverifiable`, and per-provider stats including verification counts.

The verification step protects against the failure mode where one provider returns a high-confidence claim that's contradicted by the actual source — caught and rejected before reaching the user.

### `/compare`

Side-by-side raw responses from multiple providers. **No synthesis**, no consensus extraction, no validation pipeline — just verbatim outputs so you can compare directly.

```text
/compare what's the difference between Server-Sent Events and WebSockets?
/compare gemini and codex review @src/auth.ts
```

Use when:
- You want to see how each provider phrases the same answer (style, depth, confidence framing)
- You want a sanity check before picking one provider's recommendation
- You explicitly want to AVOID Claude synthesizing or weighting the responses

If you want consensus extraction → use `/brainstorm` instead.
If you're reviewing a code diff → use `/multi-review` instead.

## Background Continuous Review

### `codex-pair` — PostToolUse hook + `/codex-pair` dashboard

`codex-pair` has two surfaces:

- **The PostToolUse hook** — fires automatically after every `Edit` / `Write` / `MultiEdit` whenever a project has opted in via a `.codex-pair/context.md` marker. HIGH and MED concerns appear to Claude as a system reminder on the next turn; LOW concerns are logged. This is the workhorse — the actual review surface.
- **`/codex-pair`** — a user-invocable slash command that shows current status (active / paused / not configured) and runs interactive setup on first use. Use this when you want to enable codex-pair on a new project (auto-detects context from your README + manifests, drafts the marker, asks you to confirm) or check whether it's currently running. Pairs with `/codex-pair-pause` and `/codex-pair-resume` (the imperative toggles).

> This is the "hidden" surface of the plugin: the hook ships in every install but is disabled by default until a project opts in. The full mechanism, env vars, and cost characteristics live in [Hooks → PostToolUse Hook: codex-pair](/plugin/hooks#posttooluse-hook-codex-pair-opt-in-continuous-review).

**Quick enable** — either run `/codex-pair` (recommended; it auto-detects your project and asks before writing) or create the marker manually:

```bash
mkdir -p .codex-pair
cat > .codex-pair/context.md <<'EOF'
# .codex-pair/context.md

<one-paragraph project-purpose summary>

## Domain invariants Codex can't infer from a single file

- <invariant 1 — something the model can't see by reading one file>
- <invariant 2 — a written spec or protocol your code implements>
- <invariant 3 — a concurrency or state-coordination rule>
EOF
```

Once the marker exists at the project root, every file edit triggers a Codex review with the marker's content as project context. `rm -rf .codex-pair/` to disable.

**How it differs from `/codex-review`** — in the [ADR-077](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md) four-task benchmark (four structurally different task types — CRUD, URL parsing, RFC-spec implementation, stateful business logic — picked so the result would generalize across domains): Claude alone caught **2 of 10** probes; Claude + `/codex-review` caught **7 of 10**; Claude + `codex-pair` caught **10 of 10**. The three probes `/codex-review` missed exemplified the "looks fine, runs wrong" class its ≥80-confidence filter structurally suppresses — code that compiles and type-checks but produces wrong results at runtime. **The recall improvement is task-agnostic**; the two surfaces are complementary, not competing.

The decision about when to use the hook is about **code characteristics**, not project domain:

| Use `/codex-review` (precision-first) | Use `codex-pair` (recall-first) |
|---|---|
| Routine PR review | Code with hidden invariants the model can't infer from one file |
| Glue code, simple CRUD, refactors | Code where latent bugs cost more than per-edit review (~$0.04–0.07) |
| You want one comprehensive report | Code evolving fast under written constraints (spec, protocol, ADR) |
| You're cost-sensitive (~$0.04 per review) | State coordination, concurrency, anything order-sensitive |
| Default for everything | The "looks fine, runs wrong" failure mode would be expensive to catch later |
