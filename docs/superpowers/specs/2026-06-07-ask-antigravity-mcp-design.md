# ask-antigravity-mcp — Design Spec

- **Date:** 2026-06-07
- **Status:** Approved (pending implementation)
- **Related ADR:** ADR-114
- **Author:** brainstormed with Claude (Opus 4.8)

## 1. Context & motivation

Google is transitioning Gemini CLI to the Antigravity CLI (`agy`). On 2026-06-18 the
Gemini CLI OAuth backend stops serving free / AI Pro / Ultra consumer accounts; only
paid `GEMINI_API_KEY` access and Gemini Code Assist Standard/Enterprise licenses keep
working (see `packages/gemini-mcp/src/constants.ts` `TIER_DISCONTINUED`).

For a **subscription-driven** workflow — the maintainer's primary use case of getting a
"second opinion" / brainstorm without per-token billing — the surviving Gemini paths are
unattractive: the API-key path is metered, defeating a flat-rate subscription. However,
**Antigravity is covered by the same Google AI Pro/Ultra subscription** (Pro = 5×, Ultra
= 20× base rate limits, refreshing ~every 5h). So the subscription's value does not die —
it relocates to `agy`. This package exists to make that value reachable **through the
ask-llm toolchain** (Claude → MCP → `agy`), the same way `ask-gemini` / `ask-codex` work.

We are **adding a new provider package**, not migrating `gemini-mcp`. `gemini-mcp` still
serves enterprise and API-key users and must remain intact.

## 2. The hard constraint: `agy` headless mode is broken today

`agy`'s non-interactive `-p` / `--print` mode is currently unusable as a clean subprocess
integration:

- **Empty stdout in non-TTY contexts** — `agy -p` authenticates, calls the model, gets a
  response… and never writes it to stdout (upstream gemini-cli issue #27466). This is
  exactly how an MCP server invokes it.
- **No structured output** — there is no `--output-format json`/`stream-json`. Plain text
  only (when it works at all).
- **No capturable session id** — `--print` never surfaces the conversation id, and
  `--conversation <id>` can only *resume* existing conversations, not *create* one with a
  caller-supplied id (antigravity-cli issue #7). True multi-turn is not possible headless.
- **Model switching hangs under `-p`** — `agy -m <model>` with `-p` hangs (observed by the
  community MCP bridge). So we cannot expose a model parameter.

The only known working path to obtain a response is to **read `agy`'s internal transcript
files**, which a community Claude↔agy MCP bridge already does in production.

### Verified `agy` flags (from `agy --help` documentation; `agy` not installable here)

| Flag | Purpose | Use in this package |
|------|---------|---------------------|
| `-p` / `--print` / `--prompt` | run one prompt non-interactively | yes (core) |
| `--add-dir <dir>` (repeatable) | add a directory to the workspace | yes (`includeDirs`) |
| `--print-timeout <dur>` (default 5m) | print-mode wait timeout | yes |
| `--dangerously-skip-permissions` | auto-approve tool permission prompts | yes (avoid hangs) |
| `--sandbox` | run with terminal restrictions | yes (default on) |
| `-c` / `--continue` | continue most recent conversation | no (v1) |
| `--conversation <id>` | resume conversation by id | no (resume-only, issue #7) |
| `-m` | model selection | no (hangs under `-p`) |

## 3. Decision

Build `ask-antigravity-mcp` **now**, explicitly labeled **experimental**, using
**Approach B: stdout-first, transcript-fallback** response extraction. v1 surface is a
**one-shot `ask-antigravity` tool + `ping`**, with `--add-dir`-based directory inclusion,
integrated into the **`ask-llm-mcp` orchestrator** (availability-gated on `agy` being
installed). No Claude-plugin agent/skill/brainstorm wiring in v1.

Approach B was chosen over a pure transcript scraper (Approach A) because it costs ~30
extra lines for a "response source" seam that **self-heals onto stdout the moment upstream
fixes #27466** (and slots in a JSON parser if `--output-format` ever lands) — with zero
later migration. A caller-pinned-conversation-id approach (Approach C) was rejected:
issue #7 confirms `--conversation` cannot create new conversations, so it cannot work on a
first call.

## 4. Architecture & package layout

New Yarn workspace `packages/antigravity-mcp` → published as `ask-antigravity-mcp`,
depending on `@ask-llm/shared` (`workspace:*`). Mirrors `packages/codex-mcp` so it slots
into the existing build order and `serverFactory` conventions with no new patterns.

```
packages/antigravity-mcp/
  package.json                     ← name: ask-antigravity-mcp, bin, deps on @ask-llm/shared
  tsconfig.json                    ← extends tsconfig.base.json
  src/
    constants.ts                   ← CLI flags, data paths, env vars, error/status messages
    utils/
      antigravityExecutor.ts       ← orchestration: buildArgs, run, response-source chain, mutex
      transcriptReader.ts          ← ISOLATED fragile file-scraping (single responsibility)
    tools/
      ask-antigravity.tool.ts      ← UnifiedTool { prompt, includeDirs? }
      simple-tools.ts              ← ping (agy installed + authed?)
      index.ts                     ← tool registry
    index.ts                       ← MCP server (shared registerTools/createSandboxServer)
    cli.ts                         ← bin entry → startServer()
    __tests__/                     ← transcriptReader, executor, tool tests (all mocked)
```

Orchestrator change: add a provider entry to `packages/llm-mcp/src/constants.ts` with
availability via `isCommandAvailable('agy')`, a dynamic import of the executor subpath, and
a `workspace:*` dependency.

### Key separation of concerns

`transcriptReader` vs `antigravityExecutor` is deliberate. All fragility — guessing the
conversation id, reading `transcript.jsonl`, the `.db`-migration risk — lives in one small
file with a dead-simple contract: `readLatestResponse(sinceMs): string | null`. It is the
unit most likely to break when `agy` changes internals, so the breakage (and its
fixture-based tests) is contained where the rest of the package never has to know about it.

## 5. Components & data flow

`ask-antigravity` tool → `executor.execute({ prompt, includeDirs })`:

1. `buildArgs`: `agy -p "<read-only-framed prompt>" [--add-dir <d> …] --print-timeout <t>
   --dangerously-skip-permissions [--sandbox]`
2. acquire **in-process mutex** (serialize — concurrent runs race on the shared
   `cache/last_conversations.json` and the "newest brain dir" heuristic)
3. `executeCommand('agy', args, …)` via `@ask-llm/shared`; record `startedAt`
4. **response-source chain**, first non-null wins:
   `[parseJsonStdout (future), scrapeTranscript(startedAt), parsePlainStdout (last resort)]`
   — plain stdout is LAST so agy banners/progress lines can't preempt the authoritative
   transcript (#153 review); structured JSON stays first for clean self-heal on #27466.
5. release mutex → return `{ response, sessionId: undefined, usage: undefined }`
   (`agy` exposes neither a session id nor token stats in headless mode)

`scrapeTranscript(sinceMs)` (in `transcriptReader.ts`):
- resolve conversation id from `~/.gemini/antigravity-cli/cache/last_conversations.json`;
  fallback to the newest `~/.gemini/antigravity-cli/brain/<id>/` modified after `sinceMs`
- read `brain/<id>/.system_generated/logs/transcript.jsonl`
- return the last entry matching `source=MODEL, status=DONE, type=PLANNER_RESPONSE`
- return `null` (never throw) on any missing/unrecognized structure; the executor decides
  how to surface it

## 6. Error handling & safety

Every broken assumption fails **loud and specific** — never an empty return (which is
`agy`'s own bug and must not be mistaken for "no answer"):

- `agy` not on PATH → install hint
- empty stdout **and** no transcript found → "not authenticated (run `agy` once to log in)
  or output path changed"
- transcript dir exists but no `MODEL/DONE` entry → "agy transcript schema may have changed
  (e.g. `.db` migration); this experimental provider needs an update"
- rate-limit signal in transcript/stderr → "subscription rate limit; refreshes ~every 5h"

**Safety posture (approved):** default to `--dangerously-skip-permissions` **and**
`--sandbox`, plus a read-only prompt preamble: *"You are giving a second opinion / review —
read and reason only; do not modify, create, or delete files or run commands."*
Rationale: `--dangerously-skip-permissions` is required to prevent headless hangs on
approval prompts; `--sandbox` bounds what auto-approval can actually do; the preamble sets
intent. Escape hatch: `ASK_ANTIGRAVITY_SANDBOX=0` disables `--sandbox` if it turns out to
block context reads.

**Concurrency:** in-process mutex serializes all `agy` calls. This is a correctness
requirement (shared global state files), not a perf tuning knob. The serialization is
documented and logged when a call queues (no silent caps).

## 7. Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `ASK_ANTIGRAVITY_TIMEOUT_MS` | ~300000 (5m) | process timeout; we pass `--print-timeout` just under it |
| `ASK_ANTIGRAVITY_SANDBOX` | on | set `0` to drop `--sandbox` |

No `model` parameter (switching hangs under `-p`); the model comes from `agy`'s own
`settings.json`. `includeDirs: string[]` maps to repeated `--add-dir`.

## 8. Testing (no live `agy` — it is not installable in CI)

- `transcriptReader`: fixtures for valid transcript, missing dir, no-`DONE` entry
  (schema-changed), multi-conversation newest-wins, `.db`-only dir (future-break detection)
- `executor`: mock `executeCommand` → empty stdout falls back to scraper; JSON stdout used
  directly (the future-proofing test); plain stdout used directly; mutex serialization;
  error classification (not installed, rate limit, schema changed)
- `tool`: zod schema validation, `includeDirs` → repeated `--add-dir`
- orchestrator: `agy` present → tool registered; absent → not registered

All tests mock the filesystem and `executeCommand`; none require a real `agy` binary.

## 9. Risks & future-proofing

- **Primary risk:** `agy` changes its transcript layout (`agy 1.0.5` already dual-writes
  `.db`). Mitigation: isolated `transcriptReader` + a schema-changed error + a fixture test
  asserting graceful failure on a `.db`-only dir.
- **Self-healing:** the stdout-first chain means an upstream fix to #27466 (or a new
  `--output-format json`) requires no migration — the cleaner source simply starts winning.
- **Not published to npm until validated** against a real `agy` install (release decision,
  out of scope for v1 implementation).

## 10. Validation results (against real `agy` 1.0.6 — #153 dogfood)

Validated by running `executeAntigravityCLI` against a live `agy` 1.0.6 (a code review
of this package), in the PR #153 dogfood follow-up:

1. **stdout works — gemini-cli #27466 is FIXED in agy 1.0.6.** `agy -p` prints the full
   response to stdout in a non-TTY context, so the `stdout-plain` source wins and the
   transcript scrape is now a *fallback*, not the primary path. (stdin handling for very
   large prompts remains untested — still bounded by the 100KB zod cap, well under ARG_MAX.)
2. **Transcript schema confirmed:** the answer is the last `source=MODEL, status=DONE,
   type=PLANNER_RESPONSE` entry, text in **`content`** (handled by our `text ?? content ??
   message` fallback). ⚠️ Two real bugs found & fixed: (a) `agy` writes a token-**truncated**
   `transcript.jsonl` plus a complete `transcript_full.jsonl` — the reader now prefers the
   full one; (b) the brain-dir scan now skips non-directory entries (a stray `.DS_Store` could
   otherwise become the "newest" id).
3. **`--sandbox` does NOT block `--add-dir` reads** — agy read the target files accurately with
   both flags on, so the default posture (`--sandbox` + `--dangerously-skip-permissions`) stands.
4. `ping` uses a 5s-capped `agy --version` — works; a deeper authed-check is unnecessary.

**Net:** validated against agy 1.0.6 via the now-primary stdout path. Remaining before npm
publish / dropping "experimental": broaden real-`agy` coverage (large-prompt stdin, long-response
fallback) and the deferred minors.

## 11. Out of scope (v1)

- Claude-plugin `antigravity-reviewer` agent, `/antigravity-review` skill, brainstorm
  participation (deferred to a follow-up once the package is proven).
- `changeMode` / structured edits.
- Multi-turn / session continuity (infeasible headless per issue #7).
- Model selection (hangs under `-p`).

## References

- gemini-cli #27466 — `agy -p`/`--print` emits nothing to stdout (the core blocker)
- antigravity-cli #7 — no per-conversation id for headless resume
- gemini-cli Discussion #27274 — official transition announcement (API-key + enterprise survive)
- Community Claude↔agy MCP bridge — transcript-scraping precedent
- `packages/codex-mcp/` — structural template
- `packages/gemini-mcp/src/utils/geminiExecutor.ts` — response-source / fallback idiom
