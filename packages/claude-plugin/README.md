# @ask-llm/plugin

<div align="center">

**Claude Code plugin for AI-to-AI collaboration**

</div>

A [Claude Code plugin](https://code.claude.com/docs/en/plugins) that adds multi-provider code review, brainstorming, and automated hooks. Get second opinions from Gemini, Codex, and Ollama without leaving Claude Code.

Part of the [Ask LLM](https://github.com/Lykhoyda/ask-llm) monorepo.

## Installation

### From Marketplace

```
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

### MCP Servers (user scope for short tool names)

```bash
claude mcp add --scope user gemini -- npx -y ask-gemini-mcp
claude mcp add --scope user codex -- npx -y ask-codex-mcp
claude mcp add --scope user ollama -- npx -y ask-ollama-mcp
```

## Skills

| Command | Description |
|---------|-------------|
| `/multi-review` | Parallel Gemini + Codex review with 4-phase validation pipeline and consensus highlighting |
| `/gemini-review` | Gemini-only code review with confidence filtering |
| `/codex-review` | Codex-only code review (precision-first, ≥80 confidence — default for routine PR review) |
| `/ollama-review` | Local review — no data leaves your machine |
| `/brainstorm` | Multi-LLM brainstorm with Claude Opus as a first-class research participant (default external: gemini,codex) |
| `/brainstorm-all` | Brainstorm with all three external providers + Claude Opus research |
| `/compare` | Side-by-side raw responses from multiple providers (no synthesis, no consensus extraction) |

## Agents

| Agent | Color | Description |
|-------|-------|-------------|
| gemini-reviewer | cyan | 4-phase: context, prompt, synthesis, validation |
| codex-reviewer | green | 4-phase: context, prompt, synthesis, validation |
| ollama-reviewer | yellow | 4-phase: context, prompt, synthesis, validation (local) |
| brainstorm-coordinator | magenta | Claude Opus research + parallel multi-LLM consultation with synthesis; verified findings weighted higher than inferred |

## Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| PreToolUse | Before `git commit` | Reviews staged changes via Gemini, warns about critical issues |
| PostToolUse | After Edit/Write/MultiEdit | Runs codex-pair review IF `.codex-pair/context.md` marker file is present in the project (opt-in, ADR-077; layout per ADR-092) |

## Enabling codex-pair mode

`codex-pair` has two surfaces: a **PostToolUse hook** that runs continuously after every file edit when opted in (the workhorse), and a **`/codex-pair` slash command** for setup-and-status (the human-facing dashboard). The hook is the recall-first complement to `/codex-review`. In the four-task benchmark from [ADR-077](../../docs/DECISIONS.md) (four structurally different task types — CRUD endpoint, URL shortener, RFC-spec implementation, stateful business logic — chosen so the result would generalize, not be a fluke of one domain): Claude alone caught **2 of 10** probes; Claude + `/codex-review` caught **7 of 10**; Claude + `codex-pair` caught **10 of 10**. The three probes `/codex-review` missed exemplified the "looks fine, runs wrong" class its ≥80-confidence precision filter structurally suppresses — code that compiles and type-checks but produces wrong results at runtime because of an implicit invariant the model couldn't infer from a single file. **The recall improvement is task-agnostic**; it reproduced across all four task types, not just the headline one. Subsequent lived-experience audit in [ADR-095](../../docs/DECISIONS.md) confirms the benchmark holds in real flow.

The hook is loaded by default but **self-gates on a marker file**. Without the marker, every edit triggers one `fs.access()` call and exits — zero codex calls, zero cost.

To enable for a project:

```bash
mkdir -p .codex-pair
cat > .codex-pair/context.md <<'EOF'
# .codex-pair/context.md

This is a payment-processing service. Currency must use integer cents
(floats lose precision on every charge). Concurrent requests are real.
URL inputs are untrusted.

[Add domain invariants Codex can't infer from one file — e.g.
"all routes check user.role", "handler must be idempotent under retry".]
EOF
```

**Do not commit `.codex-pair/`** — gitignore it. The hook ships with the plugin (project policy); the marker is each developer's own activation switch and review context. A single `.codex-pair/` line in `.gitignore` covers the marker, log, cache, and all state files (see [ADR-092](../../docs/DECISIONS.md)).

Once present, every Edit/Write/MultiEdit triggers a Codex review of the file with the marker's content as project context. HIGH and MED concerns appear to Claude as system reminders on the next turn; LOW concerns are logged to `.codex-pair/log.jsonl` but suppressed from surfacing.

To disable:

| Goal | Mechanism |
|---|---|
| Permanently for this project | `rm -rf .codex-pair/` |
| Just this session | `/plugin disable ask-llm` |
| Just this command | `CODEX_PAIR_DISABLED=1 <command>` |

**Cost characteristics**: ~$0.04–0.07 per file reviewed (gpt-5.5), ~13–50s per file. Files >20KB skipped (override with `CODEX_PAIR_MAX_FILE_BYTES`). node_modules/dist/lockfiles/images skipped automatically.

**When to enable**: any project where missed correctness issues cost more than the per-edit review (~$0.04–0.07). The decision is about *code characteristics*, not domain — codex-pair catches bugs earlier wherever a project has implicit invariants the model can't infer from one file in isolation (which most projects do, somewhere). **When NOT to enable**: routine refactors, glue code, simple CRUD where `/codex-review` at PR time is sufficient (~1/4 the cost). The four-task benchmark in ADR-077 has the full task-agnostic evidence trail; ADR-095 is the lived-experience replication on this very repo.

## Requirements

- **Claude Code** installed
- **Gemini CLI** authenticated — required for hooks and Gemini features
- **Codex CLI** — required for `/codex-review` and brainstorm with Codex
- **Ollama** running locally — required for `/ollama-review`

## Documentation

Full docs at [lykhoyda.github.io/ask-llm/plugin/overview](https://lykhoyda.github.io/ask-llm/plugin/overview)

## License

MIT
