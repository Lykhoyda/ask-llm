# Ask LLM MCP (Unified)

<div align="center">

[![npm version](https://img.shields.io/npm/v/@ask-llm/mcp)](https://www.npmjs.com/package/@ask-llm/mcp)
[![npm downloads](https://img.shields.io/npm/dt/@ask-llm/mcp)](https://www.npmjs.com/package/@ask-llm/mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**All LLM providers in one MCP server — auto-detects what's installed**

</div>

A unified [MCP](https://modelcontextprotocol.io/) server that detects configured LLM providers (Gemini, Codex, Claude, Grok, Ollama, Antigravity) and registers only the available tools. One install, all providers. Works with Claude Code, Codex CLI, Cursor, Warp, Copilot, and [40+ other MCP clients](https://modelcontextprotocol.io/clients).

Part of the [Ask LLM](https://github.com/Lykhoyda/ask-llm) monorepo.

## Quick Start

### Claude Code

Follow the [Quick Start](https://github.com/Lykhoyda/ask-llm#quick-start) for the guided user-scope setup. [Command compatibility](#command-compatibility) covers scripts and removal.

Split provider packages (`@ask-llm/codex-mcp` and the others) remain an advanced optimization for a richer per-provider tool surface.

### Claude Desktop

Follow the [Quick Start](https://github.com/Lykhoyda/ask-llm#quick-start) for guided user-scope setup. [Command compatibility](#command-compatibility) covers backups, formats that require manual setup, and removal.

## Prerequisites

- **[Node.js](https://nodejs.org/)** v24.0.0 or higher
- **At least one provider** installed:
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli) for `ask-gemini` tools
  - [Codex CLI](https://github.com/openai/codex) for `ask-codex` tools
  - [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code/getting-started) for Codex and other non-Claude hosts to consult Claude
  - `XAI_API_KEY` for the default xAI Grok harness, or authenticated official Grok Build with headless JSON support (an explicit request-level `harness: "grok-cli"` does not require `ASK_GROK_HARNESS`)
  - Cursor CLI authentication for optional model-neutral `ask-cursor-agent`
  - [Ollama](https://ollama.com) running locally for `ask-ollama` tools

## How It Works

On startup, the unified server:

1. Checks CLI availability (Gemini, Codex, Claude, Antigravity)
2. Checks HTTP readiness for Ollama and probes both Grok API/CLI readiness paths without billed inference, so either explicit request-level Grok harness can be routed independently of the server-wide default
3. Keeps Cursor Agent model-neutral: a canonical provider family and exact `agent --list-models` ID are required separately and verified against each other
4. Dynamically imports and registers tools from available providers
5. Exposes only the tools for providers that are actually installed

## Tools

The orchestrator exposes a **single `ask-llm` tool** (not one tool per provider — ADR-029, for token efficiency); you pick the provider per call. When any provider is installed it registers:

| Tool | Purpose |
|------|---------|
| `ask-llm` | Route a prompt to a provider via `provider`; optional `harness` selects xai-api/grok-cli for Grok only. Supported `includeDirs` (Codex/Claude/Antigravity), `reasoningEffort` (Codex/Grok), and Codex-only `preferred`/`sandbox` are forwarded; unsupported combinations fail validation instead of being stripped. For Codex continuity, pass `sessionId: ""` first, then resume with the returned ID; resumed Codex calls reject `includeDirs` (no `--add-dir` on `codex exec resume`) instead of dropping them. |
| `ask-cursor-agent` | Model-neutral Cursor harness with separate provider (`claude`, `codex`, `gemini`, `grok`) + exact model ID; Auto/noncanonical IDs are refused and the ID is echoed as `model`, with Cursor's display label in optional `reportedModel` (cross-provider labels fail). Safe relative `includeDirs` map to repeated `--add-dir`; omit `sessionId` first and reuse the returned Cursor conversation ID with `--resume`. Prompts above 16 KB go over stdin; read-only ask mode, no fallback. |
| `multi-llm` | Dispatch one prompt to multiple providers in parallel; structured per-provider report |
| `get-usage-stats` | Per-session token totals + per-provider/model breakdowns (in-memory) |
| `diagnose` | Environment diagnostics — provider CLI presence + versions |
| `ping` | Connection test |

Claude is intentionally suppressed when the MCP host is already Claude Code because Claude Code rejects nested Claude sessions. It is auto-detected normally from Codex and other clients.

Codex calls are ephemeral when `sessionId` is omitted. To create a resumable Codex conversation, pass `sessionId: ""` on the first call and pass its returned Thread ID on follow-ups.

## Doctor output formats

```bash
ask-llm-mcp doctor                       # human-readable (default)
ask-llm-mcp doctor --json                # established full DiagnosticReport JSON
ask-llm-mcp doctor --format toon         # bounded ask-llm.doctor TOON v1 pilot
ask-llm-mcp doctor --format toon --full  # include paths, pass checks, and full text
```

TOON is explicit opt-in. It changes only this CLI rendering; MCP tools/resources, JSON-RPC, machine JSON, and model prose are unchanged. Bounded output carries `completeness: complete | partial`, separates records filtered by design from actionable records dropped by the cap, and discloses withheld path fields and truncated text. `--full` is a no-op for text/JSON. Unknown `doctor` arguments exit 2 with a structured error. See the [TOON pilot evidence](https://github.com/Lykhoyda/ask-llm/blob/main/docs/TOON-PILOT.md) for the schema, measurements, and AXI audit.

After a global install, `ask-llm doctor` adds host installation, registration and restart guidance to text and JSON output; unreadable registrations are unknown, and unrecognized versions show a manual step. TOON remains provider-only. Each provider reports `installed`, `authenticated` and `permitted` from local signals (`unknown` means the signal is inconclusive; `permitted` is `no` only when Ask LLM gates the provider, currently Antigravity). By default, `exercised` is `not-run` and no model call is made. Explicit `ask-llm doctor --live` (text or `--json`, not TOON) sends one minimal real prompt to each ready provider, may spend provider quota, and reports `exercised` as `yes` or `no` with the failure in the checks.

## Machine Protocol

`machine` exposes a stdin-only JSON interface for factory controllers. It accepts one request of at most 2 MiB, with the prompt bounded to 150,000 characters by the schema, validates it before loading a provider, and writes exactly one typed result document to stdout. Prompts and issue content are never accepted through argv, and diagnostics go only to stderr.

Create a request file without putting its content in the command line:

```json
{
  "schemaVersion": 1,
  "requestId": "factory-review-0001",
  "role": "review",
  "provider": "codex",
  "prompt": "<redacted review input>",
  "readOnly": true,
  "writerProvider": "claude",
  "includeDirs": ["packages/example"]
}
```

Then dispatch it through stdin:

```bash
npx -y ask-llm-mcp machine < request.json
```

A valid dispatch returns a typed success or provider-failure envelope:

```json
{
  "schemaVersion": 1,
  "requestId": "factory-review-0001",
  "status": "success",
  "role": "review",
  "provider": "codex",
  "actualModel": "<redacted model>",
  "rawResponseSha256": "<redacted sha256>",
  "durationMs": 1200,
  "usage": { "inputTokens": 100, "outputTokens": 20, "totalTokens": 120 },
  "fallback": {
    "occurred": false,
    "requestedModel": "<redacted model>",
    "actualModel": "<redacted model>"
  },
  "session": { "sessionId": "<redacted session>", "transcriptPath": null },
  "payload": { "summary": "<redacted>", "findings": [] },
  "quotaSignal": { "kind": "runtime_proxy_required" },
  "failure": null
}
```

The complete envelope also records model, fallback, duration, token, response-hash, and session provenance. Provider-level failures use the same strict result contract and still exit successfully so controllers can parse and classify them.

All machine dispatches request `readOnly: true` and pass read-only options to the provider adapter. The interface supports Codex, Claude, and Antigravity; it does not provide a write path. Antigravity refuses execution by default because its read-only options do not guarantee isolation; see the [provider guide](../../apps/docs/providers/antigravity.md). Subscription usage percentages remain unknown unless the provider exposes them, and the dispatcher never infers a percentage from token counts.

| Exit code | Meaning | Stdout |
|-----------|---------|--------|
| `0` | Valid result envelope, including provider-level failure | One JSON document |
| `2` | Missing, oversized, malformed, or schema-invalid stdin request | Empty |
| `3` | Dispatcher infrastructure failure | Empty |

Use `machine-schema` to retrieve the stable canonical request/result schema bundle and its digest:

```bash
npx -y ask-llm-mcp machine-schema > machine-schema.json
```

```json
{
  "digest": "<redacted sha256>",
  "failure": { "<redacted>": true },
  "request": { "<redacted>": true },
  "refinements": { "version": 1, "rules": [] },
  "result": { "<redacted>": true },
  "rolePayloads": { "brainstorm": {}, "review": {}, "verify": {} }
}
```

The whole bundle is authoritative. Validate a document against its Draft 2020-12 `request`, `result`, or `failure` schema first, then run `validateMachineSchemaRefinements(target, document, bundle.refinements)`. The portable refinement descriptors cover sibling-field equality rules that standard JSON Schema cannot express, including self-review and fallback provenance checks. The digest covers every base schema, role payload schema, and refinement descriptor.

`machine-schema` is provider-independent: it neither detects nor loads a provider and does not require a provider CLI to be installed. The refinement interpreter and its `MachineSchemaRefinement`, `MachineSchemaRefinementSet`, `MachineSchemaRefinementViolation`, and `MachineSchemaTarget` types are exported from `ask-llm-mcp/machine` and the package root.

## Documentation

Full docs at [lykhoyda.github.io/ask-llm](https://lykhoyda.github.io/ask-llm/)

## License

MIT

## Host plugins

<div align="center">

**Claude Code, Cursor Agent, and Pi assets in @ask-llm/mcp**

</div>

`@ask-llm/mcp` adds multi-provider code review, comparison, brainstorming, verification, image, and pairing workflows to [Claude Code](https://code.claude.com/docs/en/plugins), [Cursor Agent](https://cursor.com/docs/skills), and [Pi](https://pi.dev). The hosts consume one skill corpus and package version; host-specific behavior is kept in explicit adapters. `@ask-llm/plugin` remains a dependent bridge for existing installations.

Part of the [Ask LLM](https://github.com/Lykhoyda/ask-llm) monorepo.

## Installation

### From Marketplace

Use the [Quick Start](https://github.com/Lykhoyda/ask-llm#quick-start) for setup; [Command compatibility](#command-compatibility) covers workflow installation and removal. To install only the Claude Code plugin by hand:

```
/plugin marketplace add Lykhoyda/ask-llm
/plugin install ask-llm@ask-llm-plugins
```

> **After installing or upgrading, fully restart Claude Code** (quit and reopen) so the codex-pair `PostToolUse` hook registers. Claude Code binds hooks at session start; `/reload-plugins` refreshes the plugin cache but does **not** re-register hooks in a pre-existing session, so codex-pair won't auto-fire on edits until you restart (see [#74](https://github.com/Lykhoyda/ask-llm/issues/74)). Run `/codex-pair` afterwards to confirm the hook is wired up.

### MCP Servers

The recommended cross-provider server is `@ask-llm/mcp`; follow the [Quick Start](https://github.com/Lykhoyda/ask-llm#quick-start) to register it. Split provider packages (`@ask-llm/codex-mcp`, `@ask-llm/grok-mcp`, and the others) remain an advanced optimization for a richer per-provider tool surface.

The plugin bundles only the Codex MCP registration under Claude Code's plugin namespace. After installation or upgrade, fully restart Claude Code and run `/mcp`; `plugin:ask-llm:codex` should be connected. Codex-facing workflows prefer that bundled `ask-codex` leaf (or a user-scoped `ask-codex`), then a fully pinned unified `ask-llm` call (`provider: "codex"` plus model and Codex options), then the disclosed `codex exec` fallback. An older unified schema that cannot honor those options is reported rather than stripped.

`/grok-pair` does not add servers to the plugin. Register the unified Ask LLM server at user scope (it exposes `ask-cursor-agent` for the Cursor Agent route plus the unified `ask-llm` tool, which pair skills call only fully pinned) and, optionally, the split Grok server for the `ask-grok` leaf:

```bash
ask-llm setup --host claude
claude mcp add --scope user grok -- npx -y @ask-llm/grok-mcp
```

Existing user-scoped Codex registrations remain compatible and keep their shorter names. Other providers are registered explicitly at user scope only when you want their split leaves:

```bash
claude mcp add --scope user gemini -- npx -y @ask-llm/gemini-mcp
claude mcp add --scope user ollama -- npx -y @ask-llm/ollama-mcp
claude mcp add --scope user antigravity -- npx -y @ask-llm/antigravity-mcp
```

If Codex is missing entirely, provision the unified server first (`ask-llm setup --host claude`) or the split Codex leaf with `claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp`. If `/mcp` shows the bundled registration but it is disconnected, run `ask-llm doctor` and restart Claude Code. `/sol-review` preserves source-plugin and session-local MCP/settings context when reading the active `claude mcp list` inventory, reports missing, unavailable, and unsupported-schema states separately, and discloses the explicit `codex exec` fallback after failed health, an incomplete unified schema, or MCP transport failure.

### Cursor Agent

See the [Cursor host guide](https://lykhoyda.github.io/ask-llm/plugin/cursor) for the plugin skill surface and setup-installed portable workflows. For a source checkout:

```bash
agent --plugin-dir ./packages/llm-mcp
```

`/codex-pair` requires explicit `model=` and `effort=` values before consent, then uses a separately user-installed `ask-codex` leaf when exposed, otherwise the bundled unified `ask-llm` fully pinned (`provider: "codex"`, model, effort, include directories, sandbox, session), with resumable Thread ID, cancellation, and result relay. It never guesses MCP-process environment defaults and does not pretend Claude-only hooks are active. `/grok-pair` gives Cursor-native `.cursor/mcp.json` and Tools & MCP reload guidance; it never sends Cursor users to `claude mcp add`. For user-scope MCP registration, follow the [Quick Start](https://github.com/Lykhoyda/ask-llm#quick-start); for a project-scoped manual entry, use `ask-llm` → `npx -y @ask-llm/mcp` in `.cursor/mcp.json` (keep one registration per server — do not duplicate it when the plugin is loaded). Add `codex` → `@ask-llm/codex-mcp` or `grok` → `@ask-llm/grok-mcp` only when you specifically want their `ask-codex`/`ask-grok` leaves, then reload MCP/restart Cursor Agent. When Cursor hosts `/grok-pair`, it never recursively invokes Cursor Agent.

### Pi

Follow the [Pi installation guide](https://lykhoyda.github.io/ask-llm/plugin/pi#install) for both the native extension and the separately installed skills, and its [skills and tools reference](https://lykhoyda.github.io/ask-llm/plugin/pi#skills-and-tools) for command names and unsupported workflows.

The plugin's `ask-gemini-run`, Gemini reviewer agent/skill, and Pi `ask-gemini` tool all delegate to the canonical Gemini executor: `gemini-3.1-pro-preview` remains primary and quota errors fall back to `gemini-3.8-flash` unless `ASK_GEMINI_FALLBACK_MODEL` overrides it.

For codex-pair, create `.codex-pair/context.md`, ensure Pi trusts the project, then run interactive `/codex-pair` to grant user-owned canonical-project consent. The marker alone never authorizes data transfer/cost. Revoke with `/codex-pair revoke`. Pi findings are non-blocking; blocking Stop-gate and one-shot print parity are not available.

```bash
pi update npm:@ask-llm/plugin
pi remove npm:@ask-llm/plugin
```

See the [Pi host guide](https://lykhoyda.github.io/ask-llm/plugin/pi) for security, provider authentication, project-local/temporary installs, lifecycle semantics, and troubleshooting.

## Skills

These are Claude Code compatibility aliases; see the [skill naming reference](https://lykhoyda.github.io/ask-llm/plugin/skills) for portable commands.

| Command | Description |
|---------|-------------|
| `/multi-review` | Parallel review with source verification; see the [workflow reference](https://lykhoyda.github.io/ask-llm/plugin/skills#multi-review) |
| `/gemini-review` | Gemini-only code review with confidence filtering |
| `/codex-review` | Codex-only code review (precision-first, ≥80 confidence — default for routine PR review) |
| `/fable-review` | Isolated, read-only review requesting native Fable, with runtime verification limits disclosed |
| `/sol-review` | Model-pinned GPT-6 Sol review: prefer bundled or user-scoped `ask-codex`, then fully pinned unified `ask-llm`, then the disclosed CLI fallback |
| `/ollama-review` | Local review — no data leaves your machine |
| `/brainstorm` | Explicit multi-model brainstorm (default external: Antigravity + Codex); supports an exact no-Gemini Grok + GPT-6 Sol panel through Cursor Agent |
| `/grok-review` | Grok review through explicit xAI API or Grok CLI harness; no fallback |
| `/grok-pair` | Consent-gated iterative Grok reviewer through exact Cursor Agent, xAI API, or Grok CLI route; no fallback |
| `/codex-pair` | Claude/Pi per-edit pairing dashboard; Cursor on-demand session adapter with explicit Thread ID continuity |
| `/brainstorm-all` | Requests all five external providers + Claude Opus research; [Antigravity may be skipped](https://lykhoyda.github.io/ask-llm/providers/antigravity) |
| `/compare` | Side-by-side raw responses from multiple providers (no synthesis, no consensus extraction) |

### Exact Grok + GPT-6 Sol brainstorm

The preferred architect panel routes both models through the model-neutral Cursor Agent harness with provider and exact account-catalog ID kept separate:

```text
/brainstorm grok@cursor-agent:grok-4.7-high,codex@cursor-agent:gpt-6-sol-high "review this architecture"
```

This panel calls exactly Grok and GPT-6 Sol—never Gemini. Cursor `Auto`, model rewriting, and harness/provider fallback are forbidden. If one participant fails, the result is partial and cannot be presented as two-model consensus. Catalogs are account-specific; confirm these exact IDs with `agent --list-models` and replace an unavailable ID explicitly.

Official Grok Build remains an explicit alternative when its installed headless contract is supported:

```text
/brainstorm grok@grok-cli:grok-4.7,codex@cursor-agent:gpt-6-sol-high "review this architecture"
```

A Grok CLI failure remains a Grok CLI failure; the workflow does not pivot to Cursor or xAI.

## Agents

| Agent | Color | Description |
|-------|-------|-------------|
| gemini-reviewer | cyan | 4-phase: context, prompt, synthesis, validation |
| codex-reviewer | green | 4-phase: context, prompt, synthesis, validation |
| fable-reviewer | purple | Fable-requested review with source-verified findings |
| sol-reviewer | blue | GPT-6 Sol review through Codex with source validation |
| ollama-reviewer | yellow | 4-phase: context, prompt, synthesis, validation (local) |
| brainstorm-coordinator | magenta | Source-grounded research + parallel multi-model consultation; exact two-model mode keeps the host non-voting and partial failures out of consensus |

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

**Usage characteristics**: GPT-6 Sol at medium effort by default, with Terra quota fallback; ~13–50s per file. Files >20KB skipped (override with `CODEX_PAIR_MAX_FILE_BYTES`). node_modules/dist/lockfiles/images skipped automatically.

**When to enable**: any project where missed correctness issues cost more than the per-edit review (~$0.04–0.07). The decision is about *code characteristics*, not domain — codex-pair catches bugs earlier wherever a project has implicit invariants the model can't infer from one file in isolation (which most projects do, somewhere). **When NOT to enable**: routine refactors, glue code, simple CRUD where `/codex-review` at PR time is sufficient (~1/4 the cost). The four-task benchmark in ADR-077 has the full task-agnostic evidence trail; ADR-095 is the lived-experience replication on this very repo.

## Requirements

- **A coding host supported by [workflow setup](#command-compatibility)** installed; see the [host feature matrix](https://lykhoyda.github.io/ask-llm/plugin/pi#host-feature-matrix) for workflow availability and the [Pi guide](https://lykhoyda.github.io/ask-llm/plugin/pi) for its supported version
- **Claude Code** installed for marketplace agents, hooks, independent Fable review, and the blocking Stop gate
- **Gemini CLI** authenticated — required for hooks and Gemini features
- **Codex CLI** — required for `/codex-review` and direct-Codex brainstorm routes
- **Cursor Agent CLI** authenticated with exact catalog IDs — required only for `@cursor-agent` brainstorm routes
- **Ollama** running locally — required for `/ollama-review`

## Documentation

Full docs at [lykhoyda.github.io/ask-llm/plugin/overview](https://lykhoyda.github.io/ask-llm/plugin/overview)

## License

MIT

## Command compatibility

`ask-llm --help` and `ask-llm --version` use the canonical package. After a global install (`npm i -g @ask-llm/mcp`), `ask-llm setup --dry-run [--json]` previews the exact command or file for every listed host, including hosts that are not installed, and writes nothing. `ask-llm setup` shows the same preview, asks before each registration and workflow installation, and registers the absolute `ask-llm-mcp` path at user scope through the host's own command for Claude Code (`claude mcp add`), Codex (`codex mcp add`), Antigravity (`agy mcp add`), Grok Build (`grok mcp add`) and Gemini CLI (`gemini mcp add`). Cursor (`~/.cursor/mcp.json`), Claude Desktop (`claude_desktop_config.json`) and OpenCode (`~/.config/opencode/opencode.json`) have no add command, so setup merges the one `ask-llm` entry into that file itself: unrelated entries and the file's indentation are kept, and the file is replaced atomically, so a failed or interrupted write leaves the original intact. A file that is not plain JSON (comments, invalid UTF-8, a sibling `opencode.jsonc`, or numbers that would change when rewritten) is left untouched and the exact entry is printed instead. OpenCode is verified against fixture files only, not yet on a real OpenCode install. Pi installs the extension with `pi install <installed package directory>` and verifies it by re-reading Pi's package list; an installation failure prints the exact manual command. `-y` skips the questions and `--host claude,codex` limits the hosts. An existing `ask-llm` entry is never overwritten, a second run changes nothing, and each change is verified by reading the host's registration back. `ask-llm remove` deletes only entries that run this `ask-llm-mcp`. A host's own command may reformat its config file, while unrelated entries keep their meaning, so before a host's first change in a run the file is copied to `<file>.ask-llm-backup-<UTC timestamp>` next to it and the path is printed. Each backup may contain credentials, keeps the original file's permissions, and remains beside the resolved config file until you delete it. Symlinked config files and directories resolve to their real location; existing backups are never overwritten. Grok configurations whose `ask-llm` entry or `mcp_servers` table uses syntax other than what `grok mcp add` writes require manual setup and removal; the commands leave them untouched. Gemini CLI loads user servers only in trusted folders. `ask-llm setup` requires a global install, because an npx cache is not a durable server path. For the host and provider diagnostics, see [Doctor output formats](#doctor-output-formats). The existing `ask-llm-mcp doctor` remains provider-only, and `ask-llm-mcp` still starts the stdio MCP server without arguments and keeps its machine and REPL commands.

Setup also previews and installs workflows for selected, installed hosts: the Claude Code marketplace plugin, or portable skills through the pinned skills CLI for Codex, Cursor Agent, Grok Build, Gemini CLI, OpenCode and Pi. Claude Desktop has no skills installation. The plugin installation has its own confirmation; all missing or changed skills share one CLI invocation and confirmation. Existing user-scoped Claude plugins are left as installed. Setup compares the complete contents of each packaged portable `ask-llm-*` folder with its installed copy and refreshes differences, including supporting files and obsolete files. Identical contents are a no-op, and skills outside the packaged names are left untouched. The same comparison verifies the installation before setup reports success. The skills CLI installs from the installed `@ask-llm/mcp` package folder. When Pi is detected without an Ask LLM package registration, setup runs `pi install <that folder>` through the registration apply path, including with `-y --host pi`, so new skills and the Pi extension come from the installed version. Setup honors `PI_CODING_AGENT_DIR` for Pi's settings backup, installation and package-list verification, defaulting to `~/.pi/agent`; it reports success only after re-reading that package list; failed installs retain the manual command as a fallback. Antigravity gets a manual command that replaces only missing or changed packaged skill folders because the pinned CLI cannot write its skills directory; rerunning setup checks those complete contents too. A failed installation or outstanding manual step makes setup exit 1, including with `-y`; a dry run only previews these steps. Non-Claude marketplaces are not installed by setup because they would also import Claude hooks and a second Codex server.

`ask-llm remove` leaves the plugin and skills installed and prints their separate removal commands. Use `claude plugin uninstall ask-llm@ask-llm-plugins` for the Claude plugin, or the pinned `skills remove` command printed by `ask-llm remove` with the desired `ask-llm-*` names. Shared skill removal can affect other hosts that read the same folder.

The package-name alias `mcp` points to the same server entrypoint so `npx -y @ask-llm/mcp` can still select it automatically. A global installation also exposes a generic `mcp` command, which may collide with another installed command; use the namespaced `ask-llm-mcp` command when invoking the server directly.
