# @ask-llm/plugin

<div align="center">

**Canonical Claude Code, Cursor Agent, and Pi host package for AI-to-AI collaboration**

</div>

One publishable package that adds multi-provider code review, comparison, brainstorming, verification, image, and pairing workflows to [Claude Code](https://code.claude.com/docs/en/plugins), [Cursor Agent](https://cursor.com/docs/skills), and [Pi](https://pi.dev). The hosts consume one skill corpus and package version; host-specific behavior is kept in explicit adapters.

Part of the [Ask LLM](https://github.com/Lykhoyda/ask-llm) monorepo.

## Installation

### From Marketplace

```
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

> **After installing or upgrading, fully restart Claude Code** (quit and reopen) so the codex-pair `PostToolUse` hook registers. Claude Code binds hooks at session start; `/reload-plugins` refreshes the plugin cache but does **not** re-register hooks in a pre-existing session, so codex-pair won't auto-fire on edits until you restart (see [#74](https://github.com/Lykhoyda/ask-llm/issues/74)). Run `/codex-pair` afterwards to confirm the hook is wired up.

### MCP Servers

The plugin bundles only the Codex MCP registration under Claude Code's plugin namespace. After installation or upgrade, fully restart Claude Code and run `/mcp`; `plugin:ask-llm:codex` should be connected. `/sol-review` selects `ask-codex`.

`/grok-pair` does not add servers to the plugin. Register the unified Ask LLM server at user scope (the recommended install: it exposes `ask-cursor-agent` for the Cursor Agent route plus the unified `ask-llm` tool, which pair skills call only fully pinned) and, optionally, the split Grok server for the `ask-grok` leaf:

```bash
claude mcp add --scope user ask-llm -- npx -y @ask-llm/mcp
claude mcp add --scope user grok -- npx -y @ask-llm/grok-mcp
```

Existing user-scoped Codex registrations remain compatible and keep their shorter names. Other providers are registered explicitly at user scope:

```bash
claude mcp add --scope user gemini -- npx -y @ask-llm/gemini-mcp
claude mcp add --scope user ollama -- npx -y @ask-llm/ollama-mcp
claude mcp add --scope user antigravity -- npx -y @ask-llm/antigravity-mcp
```

### Cursor Agent

Cursor's supported Agent Skills surface exposes exactly `/codex-pair` and `/grok-pair` (the manifest sets `agents: []` and `commands: []`, and the other skills stay Claude/Pi-only until they get Cursor adapters); its MCP surface comes from `mcp.json`. For a source checkout:

```bash
agent --plugin-dir ./packages/claude-plugin
```

`/codex-pair` requires explicit `model=` and `effort=` values before consent, then uses the exact `ask-codex` leaf (or a fully pinned unified call) with include directories, resumable Thread ID, cancellation, and result relay. It never guesses MCP-process environment defaults and does not pretend Claude-only hooks are active. `/grok-pair` gives Cursor-native `.cursor/mcp.json` and Tools & MCP reload guidance; it never sends Cursor users to `claude mcp add`. If installing only MCP configuration, the recommended minimal entry is `ask-llm` → `npx -y @ask-llm/mcp` in project `.cursor/mcp.json` or user `~/.cursor/mcp.json`; copy split entries from `mcp.json` only when you specifically want their leaf tools, then reload MCP/restart Cursor Agent.

If Codex is missing entirely, register it explicitly with `claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp`. If `/mcp` shows the bundled registration but it is disconnected, run `npx -y @ask-llm/mcp doctor` and restart Claude Code. `/sol-review` preserves source-plugin and session-local MCP/settings context when reading the active `claude mcp list` inventory, reports missing and unavailable states separately, and discloses the explicit `codex exec` fallback after failed health or MCP transport failure.

### Pi

```bash
pi install npm:@ask-llm/plugin
pi list
```

Pi discovers the portable skills as `/skill:<name>` commands and registers native `ask-codex`, `ask-gemini`, `ask-grok`, `ask-ollama`, `ask-antigravity`, model-neutral `ask-cursor-agent`, and bounded concurrent `ask-multi` tools. Pi intentionally has no built-in MCP client; do not configure these as MCP servers in Pi. `fable-review` and `grok-pair` are excluded from Pi discovery; Grok pairing currently has Claude/Cursor adapters, while Pi retains its dedicated Codex pairing lifecycle.

For codex-pair, create `.codex-pair/context.md`, ensure Pi trusts the project, then run interactive `/codex-pair` to grant user-owned canonical-project consent. The marker alone never authorizes data transfer/cost. Revoke with `/codex-pair revoke`. Pi findings are non-blocking; blocking Stop-gate and one-shot print parity are not available.

```bash
pi update npm:@ask-llm/plugin
pi remove npm:@ask-llm/plugin
```

See the [Pi host guide](https://lykhoyda.github.io/ask-llm/plugin/pi) for security, provider authentication, project-local/temporary installs, lifecycle semantics, and troubleshooting.

## Skills

| Command | Description |
|---------|-------------|
| `/multi-review` | Parallel Gemini + Codex review with 4-phase validation pipeline and consensus highlighting |
| `/gemini-review` | Gemini-only code review with confidence filtering |
| `/codex-review` | Codex-only code review (precision-first, ≥80 confidence — default for routine PR review) |
| `/fable-review` | Isolated, read-only review requesting native Fable, with runtime verification limits disclosed |
| `/sol-review` | Model-pinned GPT-5.6 Sol review through the bundled `ask-codex` MCP tool; missing registration and service unavailability are diagnosed separately before the explicit CLI fallback |
| `/ollama-review` | Local review — no data leaves your machine |
| `/brainstorm` | Multi-LLM brainstorm with Claude Opus as a first-class research participant (default external: gemini,codex) |
| `/grok-review` | Grok review through explicit xAI API or Grok CLI harness; no fallback |
| `/grok-pair` | Consent-gated iterative Grok reviewer through exact Cursor Agent, xAI API, or Grok CLI route; no fallback |
| `/codex-pair` | Claude/Pi per-edit pairing dashboard; Cursor on-demand session adapter with explicit Thread ID continuity |
| `/brainstorm-all` | Brainstorm with all five external providers (Gemini, Codex, Grok, Ollama, Antigravity) + Claude Opus research |
| `/compare` | Side-by-side raw responses from multiple providers (no synthesis, no consensus extraction) |

## Agents

| Agent | Color | Description |
|-------|-------|-------------|
| gemini-reviewer | cyan | 4-phase: context, prompt, synthesis, validation |
| codex-reviewer | green | 4-phase: context, prompt, synthesis, validation |
| fable-reviewer | purple | Fable-requested review with source-verified findings |
| sol-reviewer | blue | GPT-5.6 Sol review through Codex with source validation |
| ollama-reviewer | yellow | 4-phase: context, prompt, synthesis, validation (local) |
| brainstorm-coordinator | magenta | Claude Opus research + parallel multi-LLM consultation with synthesis; verified findings weighted higher than inferred |

## Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| PreToolUse | Before `git commit` | Reviews staged changes via Gemini, warns about critical issues |
| PostToolUse | After Edit/Write/MultiEdit | Runs codex-pair review IF `.codex-pair/context.md` marker file is present in the project (opt-in, ADR-077; layout per ADR-092) |
| Stop | Turn-end | Blocks turn-end while unaddressed HIGH codex-pair findings remain — **opt-in default OFF**, enabled via `blockOn: HIGH` in `.codex-pair/context.md` frontmatter; zero new LLM calls (reads `log.jsonl`); defer findings with `/codex-pair-ack <hash> "<reason>"` (ADR-118) |

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

**Usage characteristics**: GPT-5.6 Sol by default with Terra quota fallback; ~13–50s per file. Files >20KB skipped (override with `CODEX_PAIR_MAX_FILE_BYTES`). node_modules/dist/lockfiles/images skipped automatically.

**When to enable**: any project where missed correctness issues cost more than the per-edit review (~$0.04–0.07). The decision is about *code characteristics*, not domain — codex-pair catches bugs earlier wherever a project has implicit invariants the model can't infer from one file in isolation (which most projects do, somewhere). **When NOT to enable**: routine refactors, glue code, simple CRUD where `/codex-review` at PR time is sufficient (~1/4 the cost). The four-task benchmark in ADR-077 has the full task-agnostic evidence trail; ADR-095 is the lived-experience replication on this very repo.

## Requirements

- **Claude Code, Cursor Agent, or Pi 0.83.0+** installed
- **Claude Code** installed for marketplace agents, hooks, independent Fable review, and the blocking Stop gate
- **Gemini CLI** authenticated — required for hooks and Gemini features
- **Codex CLI** — required for `/codex-review` and brainstorm with Codex
- **Ollama** running locally — required for `/ollama-review`

## Documentation

Full docs at [lykhoyda.github.io/ask-llm/plugin/overview](https://lykhoyda.github.io/ask-llm/plugin/overview)

## License

MIT
