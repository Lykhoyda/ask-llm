---
description: codex-pair is the plugin's opt-in continuous review hook. Codex reviews every file edit as Claude makes it, surfacing HIGH/MED concerns on the next turn, with an opt-in Stop gate that blocks turn-end on unaddressed HIGH findings.
---

# Codex Pair

Codex-pair supports each host with a different lifecycle adapter. The detailed detached-worker and Stop-gate material on this page describes **Claude Code**. On **Cursor Agent** there is no background reviewer: `/codex-pair` runs an on-demand, consent-gated persisted Codex session (through a user-installed `ask-codex` leaf when exposed, otherwise the fully pinned unified `ask-llm`) and the `-ack`/`-pause`/`-resume` toggles are not exposed; see [Cursor Agent Host](/plugin/cursor). On **Pi**, successful `tool_result` edit/write events feed an in-process debounce; findings are delivered with non-triggering `steer`; project trust plus a user-owned canonical-project allowlist is required in addition to the marker; shutdown aborts active review work; blocking Stop-gate and one-shot print parity are unsupported. See [Pi Host Support](/plugin/pi#pi-codex-pair-consent).

**codex-pair** is the plugin's flagship feature: continuous, opt-in code review where Codex reads every file Claude edits. It is the recall-first complement to the on-demand `/codex-review` skill. The hook is always loaded but **self-gates on a project marker file** and stays completely silent (zero cost, zero Codex calls) until a project opts in. Once enabled, a burst of edits to one file coalesces into a single debounced review of the **settled** file state, run by a detached worker; verdicts surface to Claude on both hook channels (transcript `systemMessage` plus model-visible `additionalContext`) and drain on the next edit, the next user prompt, or at turn end via the Stop hook.

> **Why this exists**: in a four-task benchmark recorded in the project's [decision log](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md) (four structurally different task types: CRUD endpoint, URL shortener, RFC-spec implementation, stateful business logic, chosen so the result would generalize across domains) Claude alone caught **2 of 10** probes; Claude + `/codex-review` caught **7 of 10**; Claude + `codex-pair` caught **10 of 10**. The three probes `/codex-review` missed exemplified the **"looks fine, runs wrong"** class: code that compiles, lints, and type-checks but produces wrong results because of an implicit invariant the model couldn't infer from a single file. codex-pair's recall-first HIGH/MED/LOW grading catches that class. **The improvement is task-agnostic**, reproduced across all four tasks, not just the headline one. The two surfaces are **complementary, not competing**. (A subsequent lived-experience audit confirms the benchmark holds in real flow on this very repo.)

## Setup

Run the `/codex-pair` slash command in the project where you want continuous review. On first run (no marker present) it offers interactive setup with auto-detected project context and writes the marker file for you. You can also create the marker by hand:

```bash
mkdir -p .codex-pair
cat > .codex-pair/context.md <<'EOF'
# .codex-pair/context.md

This is a payment-processing service. All currency calculations must
use integer cents internally (floating-point loses precision on every
charge). Concurrent requests are real. URL inputs are untrusted.

[Add domain invariants Codex can't infer from one file. Examples:
 Security: "all routes check user.role".
 Specs: "protocol XYZ must be followed".
 State: "cart syncs to localStorage on every mutation".
 Concurrency: "this handler must be idempotent under retry".]
EOF
```

On Claude Code, the marker file's *presence* is the switch and its content is review context. On Pi, marker presence is only the repository-side gate: it never authorizes provider transfer/cost without Pi project trust and separate interactive `/codex-pair` consent stored outside the repository.

**Do NOT commit the `.codex-pair/` directory**: gitignore it. Each contributor's review context is their own; one developer iterating on prompt wording shouldn't dirty the shared history. The hook itself is project-policy (it's in the plugin); the marker is per-developer opt-in. Every state artifact (marker, log, cache, `ignore` globs, pause sentinel, inflight locks) nests under the single directory; one `.gitignore` line covers everything:

```gitignore
.codex-pair/
```

For a new contributor joining a project, point them at this docs page to write their own marker, or share a template via a separate (committed) `.codex-pair.example/context.md` they can copy and tweak locally.

Once present, every `Edit` / `Write` / `MultiEdit` triggers a Codex review of the changed file. HIGH and MED concerns appear to Claude as a system reminder on the next turn, prefixed with `[codex-pair]` and the file path:

```
[codex-pair] src/billing/charge.ts

[HIGH] Monetary values are modeled as floating-point numbers
src/billing/charge.ts:12: `price` accepts arbitrary JS numbers for
money, which violates the stated requirement that currency uses
integer cents. Use integer minor units such as
`priceCents: z.number().int().nonnegative()`.
```

### When to enable it

Decide BEFORE you opt in; the hook costs real money per edit, and the value is highest on code where missed concerns have outsized blast radius. The decision is about **code characteristics**, not project domain: any project has both kinds of code, and codex-pair earns its keep wherever there's a category of "looks fine, runs wrong" failure mode.

| Use the hook (recall-first) | Stick with `/codex-review` only (precision-first) |
|---|---|
| Code with hidden invariants the model can't infer from one file | Routine PR review |
| Code where latent bugs cost more than per-edit review (~$0.04–0.07) | Glue code, simple CRUD, refactors |
| Code evolving fast under written constraints (spec, protocol, ADR) | Cost-sensitive sessions |
| State coordination, concurrency, anything order-sensitive | One comprehensive report is enough |
| The "looks fine, runs wrong" failure mode would be expensive to catch later | |

## Slash commands

The `/codex-pair` suite is the human-facing dashboard and controls for the hook. The hook itself runs automatically once the marker exists; these commands are for setup, inspection, and toggling.

| Command | What it does |
|---|---|
| `/codex-pair` | Status dashboard. Detects whether codex-pair is active, paused, or not yet configured. First run (no marker) offers interactive setup with auto-detected project context. Later runs show current state, recent review activity, and toggle instructions |
| `/codex-pair-pause` | Pause the hook for this project without removing the marker. Writes a `.codex-pair/state/paused` sentinel the hook checks on every edit. Use to temporarily silence reviews (noisy refactor, docs-only work) and resume later |
| `/codex-pair-resume` | Remove the pause sentinel. The hook starts reviewing edits again on the next edit. No-op if no pause sentinel exists |
| `/codex-pair-ack <hash> "<reason>"` | Acknowledge a HIGH finding without fixing it (known trade-off or tracked in a ticket). The `<hash>` is the content hash shown alongside the finding when the Stop gate blocks. The reason is recorded as a concurrency-safe shard under `.codex-pair/state/acks/` with a timestamp; acknowledged findings are skipped by the gate until the file changes |

## The hook pipeline

codex-pair is implemented as five hooks working together, all dependency-free with zero workspace imports so they run from marketplace `git-subdir` installs that don't run `npm install`. Only `codex-pair-watch` shells out to `codex exec --json` to run a review; the others surface persisted verdicts or manage state.

| Hook | Trigger | Action |
|---|---|---|
| `codex-pair-watch` (PostToolUse) | After every `Edit` / `Write` / `MultiEdit` | If a `.codex-pair/context.md` marker exists from the edited file's directory up to the project root, the edit is queued for review with the marker's content as context. Edits are **debounced**: a burst within the 15s settle window coalesces into one review of the settled state, run by a detached worker. No marker means the hook exits silently after one `fs.access()` call: **zero Codex calls, zero cost** |
| `codex-pair-prompt-drain` (UserPromptSubmit) | On every user prompt | Drains queued codex-pair verdicts that finished mid-turn so they reach Claude without waiting for the next edit |
| `codex-pair-stop-gate` (Stop) | At turn end | Drains remaining queued verdicts (no opt-in needed). With `blockOn: HIGH` in the marker frontmatter (opt-in, default OFF), blocks turn-end while unaddressed HIGH findings or in-flight reviews remain. See [Stop gate](#stop-gate-opt-in) below |
| `codex-pair-session` (SessionStart) | At Claude session start | Announces a paused project (a reminder if still fresh, or an automatic resume of an expired auto-pause). Env-gated broker lifecycle (`ASK_CODEX_BROKER=1` only) additionally starts the experimental long-lived `codex app-server` broker |
| `codex-pair-session` (SessionEnd) | At Claude session end | Clears debounce state so orphaned workers self-cancel. Tears down the broker when `ASK_CODEX_BROKER=1` |

By default HIGH and MED concerns are surfaced; LOW concerns and all timing/skip telemetry are logged to `.codex-pair/log.jsonl` alongside the marker file. Set `debounceMs: 0` in the marker frontmatter for synchronous per-edit review.

### Configuration knobs

| Env var | Default | Effect |
|---|---|---|
| `CODEX_PAIR_DISABLED` | unset | Set to `1` to bypass the hook entirely; beats marker file |
| `CODEX_PAIR_MAX_FILE_BYTES` | `20000` | Files larger than this many UTF-8 bytes get an adaptive **partial-view** review (header + git diff, or head+tail), not a full-content one. Still a Codex call; use `.codex-pair/ignore` to make big files free |
| `ASK_CODEX_TIMEOUT_MS` | `800000` | Per-call Codex timeout (inherited from `@ask-llm/codex-mcp`) |
| `ASK_CODEX_DEBOUNCE_MS` | `15000` | Settle window: an edit burst to one file coalesces into a single review of the settled state. `0` = synchronous per-edit review. Also settable per-marker via `debounceMs` frontmatter |
| `ASK_CODEX_DEBOUNCE_MAX_MS` | `60000` | Hard cap from a burst's first edit; forces a review even under a continuous edit stream. Frontmatter: `debounceMaxMs` |
| `CODEX_PAIR_QUOTA_PAUSE_TTL_MS` | `21600000` (6h) | Quota auto-pauses self-heal after this long; the next edit (or session start) retries a live review |
| `CODEX_PAIR_FAILURES_PAUSE_TTL_MS` | `86400000` (24h) | Failure auto-pauses self-heal after this long, or immediately when the plugin version changed since the pause |

### Auto-pause is self-healing

When the hook pauses itself (provider quota exhausted, or 3 consecutive review failures), the pause no longer requires a manual `/codex-pair-resume` to ever end:

- **At session start** a paused project announces itself: a reminder if the pause is still fresh, or an automatic resume if it has expired. No more silently-dead pairing.
- **On any edit** an expired auto-pause resumes in place and that edit gets reviewed; if the provider is still broken, the review fails and the hook re-pauses cleanly.
- **Plugin updates heal failure-pauses immediately**: the pause sentinel records the plugin version that wrote it, and a version change is treated as "the cause was plausibly fixed".
- **Manual pauses are untouched**: `/codex-pair-pause` still only ever resumes via `/codex-pair-resume`.

### Cost characteristics

- ~$0.04–0.07 per file reviewed (Codex GPT-5.6 Sol with reasoning tokens)
- ~13–50s per file wall-clock
- Files over the size cap fall back to an adaptive partial-view review (header + git diff against HEAD, OR head + tail)
- `node_modules/`, `dist/`, lockfiles, fonts, archives, sourcemaps, snapshots, minified assets skipped automatically
- A 50-edit session is roughly $2–3.50 plus ~10–40 minutes of cumulative Codex latency; significantly less after the content-hash cache warms

For typical opted-in projects (small surface where review depth matters), the cost is acceptable. For routine refactor work across a whole repo, leave the marker file out and use `/codex-review` on demand instead.

### Disable it

| Goal | How |
|---|---|
| Temporarily for this project | `/codex-pair-pause` (resume with `/codex-pair-resume`) |
| Permanently for this project | `rm -rf .codex-pair/` |
| Just this Claude Code session | `/plugin disable ask-llm` |
| Just this command | `CODEX_PAIR_DISABLED=1 <command>` |

## Stop gate (opt-in)

**Default:** OFF. You must explicitly opt in.

**Trigger:** At the end of every Claude turn (`Stop` event).

**Action:** If unaddressed HIGH codex-pair findings remain in `.codex-pair/log.jsonl`, the hook blocks turn-end and surfaces those findings, forcing them to be addressed before the session continues.

> **Why opt-in?** A blocking turn-end gate is disruptive by design. The original Stop hook was removed because it ran a fresh Gemini review every turn (latency, quota burn). This hook is fundamentally different (it reads the already-computed `log.jsonl` with zero new LLM calls), but blocking is still a `kano:reverse` feature for some workflows, so it defaults OFF.

### Enable it

Add a `blockOn` key to your `.codex-pair/context.md` YAML frontmatter:

```markdown
---
blockOn: HIGH
---

# .codex-pair/context.md

This is a payment-processing service. All currency calculations must
use integer cents internally (floating-point loses precision on every
charge).

[Your domain context here...]
```

Once enabled, the hook checks at turn-end whether any HIGH findings in `log.jsonl` are unacknowledged and unresolved. It reconciles against present reality before blocking:

- **File deleted or renamed** → finding skipped (no longer relevant)
- **File clean vs HEAD** (`git status --porcelain`) → finding skipped (reverted or branch-switched away)
- **Latest log entry for the file is indeterminate** (`skipped`/`error`/`retried`/`broker_fallback`) → fail-open, finding skipped (don't block on a stale HIGH from before a transient error)

### In-flight reviews block too

With the default 15s debounce plus 13–50s of review latency, a review is often still running when the turn ends; the log alone can't see it. When `blockOn: HIGH` is set, the gate also blocks (once per turn) while any review for a recent edit is still in flight (a settling debounce window, a worker mid-handoff, or a running Codex call), telling Claude to wait for the verdict before finishing. The `stop_hook_active` loop guard means a turn is never blocked twice for the same reason.

### Queued verdicts drain at turn-end

Debounced verdicts that finished mid-turn used to wait for the *next* edit or user prompt to surface. The Stop hook drains them at turn-end, no `blockOn` opt-in required: as additional context when nothing blocks, or folded into the block message when it does. Like every Stop/prompt-scoped hook, the drain resolves the project from the session's working directory; verdicts queued by cross-repo edits (cwd in repo A, edit in repo B) still wait for the next edit or prompt in that repo, tracked in [#209](https://github.com/Lykhoyda/ask-llm/issues/209).

### Fail-open behavior

Any error in the stop-gate hook (missing log, parse error, git unavailable) warns to stderr and exits 0; the turn is **never** blocked due to a hook bug. This is intentional: a gate that blocks turns on its own fault is worse than no gate.

## Troubleshooting and verification

### Inspecting log activity: the `codex-pair-log` CLI

Shipped alongside the hook at `packages/claude-plugin/scripts/codex-pair-log.mjs`. Walks up from cwd to find the marker (same gate as the hook), then renders the sibling `.codex-pair/log.jsonl`. Useful for "is the hook actually running" diagnostics and for forensic analysis of what's been reviewed.

```bash
# Default: last 10 entries
node packages/claude-plugin/scripts/codex-pair-log.mjs

# Aggregate stats: verdict breakdown, top 5 files, cache hit rate, fallback frequency
node packages/claude-plugin/scripts/codex-pair-log.mjs --summary

# Filter to one file's history
node packages/claude-plugin/scripts/codex-pair-log.mjs --file src/billing/charge.ts

# Only the last 24 hours
node packages/claude-plugin/scripts/codex-pair-log.mjs --since 24h --latest 50
```

Output shape (one line per entry):

```
2026-05-18T15:11:02.341Z  none          src/billing/charge.ts        0H/0M/0L    6.2s
2026-05-18T15:11:14.892Z  concerns      src/billing/charge.ts        1H/0M/0L    8.7s
2026-05-18T15:11:18.001Z  cached        src/billing/charge.ts        1H/0M/0L    3ms
```

Zero workspace imports; runs on a marketplace install with no `node_modules`.

### If the hook isn't firing automatically: the project-settings workaround (issue #74)

Some Claude Code installations don't auto-invoke plugin-declared PostToolUse hooks even though the plugin is correctly installed and `/reload-plugins` reports the hook count. This appears to be a Claude Code platform issue with the plugin-hook dispatch path; see [issue #74](https://github.com/Lykhoyda/ask-llm/issues/74) for the full diagnostic chain. The hook script itself works perfectly when invoked manually or when registered via a `~/.claude/settings.json` / `.claude/settings.local.json` `hooks` block.

**Quick diagnostic**: edit any file under your marker-anchored project. If `.codex-pair/log.jsonl` mtime doesn't advance within ~60s, you're hitting the dispatch bug.

**Workaround**: add a `hooks.PostToolUse` block to your **project-local** `.claude/settings.local.json` (per-developer; gitignored by convention) that invokes the hook script directly, bypassing the plugin-dispatch path. Pick the command form that matches your use case:

#### Form A: Plugin maintainer (you're working on the ask-llm repo itself)

Point at the local repo source via `$PWD` so the path resolves to whatever directory Claude Code was launched in (the workspace root). Always reflects your current branch's working tree: no manual update on version bumps, no hardcoded absolute paths to maintain, and the same config works for every contributor regardless of where they cloned the repo:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "sh -c 'node \"$PWD/packages/claude-plugin/scripts/codex-pair-watch.mjs\"'"
          }
        ]
      }
    ]
  }
}
```

Caveats:
- Requires launching Claude Code from the repo root (so `$PWD` resolves there). If you launch from a parent directory the hook silently fails; easy to spot via `node packages/claude-plugin/scripts/codex-pair-log.mjs --latest`.
- Requires a POSIX shell (`sh`) in `PATH`. macOS, Linux, and WSL have this natively. **Windows users on cmd.exe or PowerShell without Git Bash** should install [Git for Windows](https://gitforwindows.org/) (which provides `sh` via the bundled MINGW64 environment) or use an absolute Windows path instead of `$PWD` in the `command` field.

#### Form B: Plugin user (you installed via marketplace)

Resolve the highest semver-sorted version from the cache at invocation time with Node's cross-platform numeric sort, so the workaround keeps working across plugin updates without relying on GNU-only `sort -V`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"try { const fs=require('fs'),cp=require('child_process'),p=process.env.HOME+'/.claude/plugins/cache/ask-llm-plugins/ask-llm'; const v=fs.readdirSync(p).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).at(-1); if(v) process.exitCode=cp.spawnSync(process.execPath,[p+'/'+v+'/scripts/codex-pair-watch.mjs'],{stdio:'inherit'}).status??0; } catch {}\""
          }
        ]
      }
    ]
  }
}
```

The Node command picks the highest numeric semver directory under the cache and passes the hook payload through inherited stdin. It is a silent no-op if no install is present.

#### After either form

Fully quit and restart Claude Code to pick up the new hook config; `/reload-plugins` refreshes plugin files but does not re-register hooks in the current session. After restarting, the next Edit/Write/MultiEdit should fire the hook automatically. Verify with `node <plugin-path>/scripts/codex-pair-log.mjs --latest` or a new `.codex-pair/log.jsonl` entry (typical wall clock 5-30s per call).

Note: this workaround is per-developer (project-local) and gitignored. Once Claude Code's plugin-hook dispatch is fixed upstream, you can remove the `hooks` block and rely on the plugin's own registration again.
