---
description: Slash commands for AI code review, brainstorming, and side-by-side comparison, including native /fable-review, model-pinned /sol-review, provider reviews, /multi-review, /brainstorm, and /compare.
---

# Skills

Skills are canonical portable workflows shared by Claude Code, Cursor Agent, and Pi. In Claude Code or Cursor invoke `/name`; in Pi invoke `/skill:name` or use natural-language matching. Each file delimits its portable contract and host adapters. Claude can use isolated reviewer agents; Cursor uses native Agent Skills plus MCP; Pi runs the portable contract inline with native Ask LLM tools and does not claim isolated context.

> `/fable-review` runs as a native isolated Claude Code agent and needs no MCP server. It is intentionally excluded from Pi discovery; Pi does not start a nested Fable session. On Pi, provider skills use native tools rather than MCP configuration. The Claude Code plugin bundles the Codex MCP registration used by `/sol-review` and `/codex-review`; `/ollama-review` and `/antigravity-review` require their respective MCP servers; see [Plugin Overview](/plugin/overview#installation).

## Native Model Review Skills

### `/fable-review`

Review the current diff directly with a read-only agent pinned to Fable. Findings are checked against the source and filtered at 80% confidence.

```text
/fable-review
```

### `/sol-review`

Run the same independent review contract with an isolated coordinator that explicitly requests `gpt-5.6-sol` at high reasoning from the Codex provider. `/codex-review` instead follows the configured Codex default.

```text
/sol-review
```

`/fable-review` requires a Claude Code runtime/account that exposes Fable. `/sol-review` requires an installed, authenticated Codex CLI; its Codex MCP registration is included with the plugin. The skill reads Claude's active MCP inventory, correlates the tool prefix to the Ask LLM Codex registration, and rechecks inside the reviewer. Missing registration and disconnected-service states receive different remediation before the explicit CLI fallback. If Sol falls back to Terra on quota, the result says so explicitly.

## Provider Review Skills

Provider review skills follow the same pattern:

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

Uses Gemini's 1M+ token context window, making it ideal for reviewing changes that touch many files or require understanding a large codebase. Requires an enterprise Gemini seat ([gated from 2026-06-18](/providers/gemini)); on other plans use `/codex-review` or `/antigravity-review`.

### `/codex-review`

Get a second opinion from OpenAI Codex (GPT-5.6 Sol) on your current changes.

```text
/codex-review
```

Falls back to GPT-5.6 Terra automatically if you hit quota limits.

### `/grok-review`

Get a Grok second opinion through the explicitly selected `xai-api` (default) or `grok-cli` harness.

```text
/grok-review
```

The API path requires `XAI_API_KEY` and can incur xAI charges; the CLI path requires official Grok Build login or API-key auth. Both use exact harness catalog model IDs and never fall back. See [Grok setup and cost safety](/providers/grok).

### `/ollama-review`

Get a second opinion from a local Ollama model. No API keys needed; all processing stays on your machine.

```text
/ollama-review
```

Requires Ollama running locally with a model pulled (e.g., `qwen3.6:27b`).

### `/antigravity-review`

Get a **subscription-backed** second opinion from Google Antigravity (`agy`): uses your Google AI Pro/Ultra plan, no per-token API billing.

```text
/antigravity-review
```

Experimental and one-shot (no multi-turn). Requires `agy` installed + logged in once and the Antigravity MCP server registered (`claude mcp add antigravity -- npx -y @ask-llm/antigravity-mcp`).

## Brainstorm Skills

### `/brainstorm`

Send a topic to multiple LLM providers AND have Claude Opus perform its own independent research in the same run, then synthesize all findings. The coordinator agent runs:

1. **Phase 3B: Claude Opus research.** Claude reads the actual files, traces real code paths, fetches any referenced external docs, and forms independent findings tagged Verified or Inferred. Always runs; Claude is a first-class participant, not just an orchestrator.
2. **Phase 3A: External dispatch.** A single foreground blocking Bash call sends the topic to each requested external provider in parallel and waits for all of them. Up to 10 minutes total (Bash tool max). It's a foreground blocking call, not a background-job dispatch, because sub-agents can't own processes that outlive their turn.
3. **Phase 4: Synthesis.** Combines Claude's findings with the external responses:

- Consensus points (where multiple participants agree; Claude verified + external = highest confidence)
- Unique insights (findings from only one participant)
- Contradictions (verified findings outrank inferred ones)
- Actionable recommendations (prioritized by impact and confidence)

```text
# Default external providers (Antigravity + Codex), plus Claude Opus always
/brainstorm Should we use a monorepo or polyrepo for this project?

# Custom external providers
/brainstorm gemini,codex,ollama Review this authentication approach
```

**Default external providers:** `antigravity,codex` (avoids unnecessary Ollama calls if not needed). **Claude Opus is always a participant** because it runs inside the coordinator; it isn't in the provider list.

### `/brainstorm-all`

Shortcut for `/brainstorm gemini,codex,grok,ollama,antigravity <topic>`. Sends to all five external providers (Gemini, Codex, Grok, Ollama, Antigravity) plus the always-on Claude Opus research phase; up to six participants total.

```text
/brainstorm-all What's the best caching strategy for our API?
```

Requires Ollama running locally since it includes the local provider.

## Multi-Provider Review Skills

### `/multi-review`

Run independent code reviews from Antigravity and Codex in parallel, **verify** each finding against the source, then present combined consensus / unique / rejected findings. (Gemini via `/gemini-review` or the `gemini-reviewer` agent.)

```text
/multi-review
```

Pipeline:

1. **Gather and prepare the diff**: `git status` first; `git add -N` for untracked files; pathspec exclusion of docs/binaries (`:!docs/` `:!*.md` `:!yarn.lock` `:!*.png`); 3-tier size policy (`<50KB` send as-is, `50–150KB` warn about expected wall time, `>150KB` ask before sending).
2. **Dispatch with fallback**: preferred path is the `gemini-reviewer` and `codex-reviewer` agents in parallel; falls back to direct Bash dispatch via the plugin's `dist/run.js` and `dist/codex-run.js` runners using the [ADR-050](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md) dispatch pattern when agents are unavailable.
3. **Verify each finding**: for every finding above 80/100 confidence, Read the file at the cited line and check whether the claim is actually true. Classifies as **VERIFIED** (claim holds), **REJECTED** (false positive), or **UNVERIFIABLE** (cannot confirm without runtime). This step exists specifically because confidence scores aren't an oracle.
4. **Resilient failure handling**: when a provider fails (timeout, exit ≠ 0, 0-byte output), surface the failure inline with stderr instead of silently dropping. Partial results are explicit.
5. **Synthesis**: combined output with `Verified by both`, `Verified by Gemini only`, `Verified by Codex only`, `Rejected (false positives)`, `Unverifiable`, and per-provider stats including verification counts.

The verification step protects against the failure mode where one provider returns a high-confidence claim that's contradicted by the actual source; caught and rejected before reaching the user.

### `/compare`

Side-by-side raw responses from multiple providers. **No synthesis**, no consensus extraction, no validation pipeline; just verbatim outputs so you can compare directly.

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

## Pair Programming

### `/grok-pair`: explicit Grok reviewer lifecycle

Claude Code's `/grok-pair` selects one immutable Grok route: `cursor-agent` (preferred when configured with an exact Grok-family ID from `agent --list-models`), `xai-api`, or `grok-cli`. Before provider work it shows provider, harness, exact model, reasoning semantics, bounded files/include directories, session support, and cost boundary for consent. Claude remains the editor; Grok feedback is relayed and verified at each checkpoint. Cancellation, partial failure, and final attribution are explicit; Auto, model rewriting, and provider/harness fallback are forbidden.

```text
/grok-pair route=cursor-agent model=cursor-grok-4.6-high include=packages/api review this change
/grok-pair route=xai-api model=grok-4.6 effort=xhigh review this change
```

On Claude Code the Cursor and direct Grok tools come from user-scoped registrations (`claude mcp add --scope user ask-llm -- npx -y @ask-llm/mcp`, optionally `claude mcp add --scope user grok -- npx -y @ask-llm/grok-mcp`); the plugin itself bundles only Codex. The unified `ask-llm` tool is used only with provider, harness, exact model, and effort pinned. When Cursor itself hosts `/grok-pair`, it avoids recursive Cursor invocation and offers only explicit `ask-grok` API/CLI routes.

### `codex-pair`: host lifecycle + dashboard

`codex-pair` has two surfaces:

- **Claude Code:** the PostToolUse hook fires after `Edit` / `Write` / `MultiEdit` when a marker exists.
- **Pi:** the extension observes successful built-in `tool_result` edit/write events and additionally requires project trust plus user-owned allowlist consent through `/codex-pair`. A committed marker alone is never consent. Findings use non-triggering `steer` delivery and are non-blocking; print-mode asynchronous pairing is unsupported.
- **Cursor Agent:** the supported Agent Skills surface runs an on-demand consent-gated pair session through exact `ask-codex`; the first call creates a persisted Thread ID with model, effort, and include directories, and follow-ups resume it without claiming Claude hooks are active. See [Cursor Agent Host](/plugin/cursor).
- **`/codex-pair`**: a user-invocable slash command that shows current status (active / paused / not configured) and runs interactive setup on first use. Use this when you want to enable codex-pair on a new project (auto-detects context from your README + manifests, drafts the marker, asks you to confirm) or check whether it's currently running. Pairs with `/codex-pair-pause` and `/codex-pair-resume` (the imperative toggles).

> This is the "hidden" surface of the plugin: the hook ships in every install but is disabled by default until a project opts in. The full mechanism, env vars, and cost characteristics live in [Codex Pair](/plugin/codex-pair).

**Quick enable**: either run `/codex-pair` (recommended; it auto-detects your project and asks before writing) or create the marker manually:

```bash
mkdir -p .codex-pair
cat > .codex-pair/context.md <<'EOF'
# .codex-pair/context.md

<one-paragraph project-purpose summary>

## Domain invariants Codex can't infer from a single file

- <invariant 1: something the model can't see by reading one file>
- <invariant 2: a written spec or protocol your code implements>
- <invariant 3: a concurrency or state-coordination rule>
EOF
```

Once the marker exists at the project root, every file edit triggers a Codex review with the marker's content as project context. `rm -rf .codex-pair/` to disable.

**How it differs from `/codex-review`**: in a four-task benchmark recorded in the project's [decision log](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md) (four structurally different task types: CRUD, URL parsing, RFC-spec implementation, stateful business logic, picked so the result would generalize across domains): Claude alone caught **2 of 10** probes; Claude + `/codex-review` caught **7 of 10**; Claude + `codex-pair` caught **10 of 10**. The three probes `/codex-review` missed exemplified the "looks fine, runs wrong" class its ≥80-confidence filter structurally suppresses; code that compiles and type-checks but produces wrong results at runtime. **The recall improvement is task-agnostic**; the two surfaces are complementary, not competing.

The decision about when to use the hook is about **code characteristics**, not project domain:

| Use `/codex-review` (precision-first) | Use `codex-pair` (recall-first) |
|---|---|
| Routine PR review | Code with hidden invariants the model can't infer from one file |
| Glue code, simple CRUD, refactors | Code where latent bugs cost more than per-edit review (~$0.04–0.07) |
| You want one comprehensive report | Code evolving fast under written constraints (spec, protocol, ADR) |
| You're cost-sensitive (~$0.04 per review) | State coordination, concurrency, anything order-sensitive |
| Default for everything | The "looks fine, runs wrong" failure mode would be expensive to catch later |
