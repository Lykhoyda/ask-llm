---
description: PostToolUse codex-pair reviewer that runs Codex on every file edit when a project marker file is present, plus SessionStart / SessionEnd hooks for the app-server broker lifecycle.
---

# Hooks

Hooks are automated actions that trigger on specific Claude Code events. The plugin configures three hooks:

- **`PostToolUse` codex-pair hook** — always loaded, but **self-gates on a project marker file** and stays silent (zero cost, zero codex calls) unless you opt in. Covered in detail below.
- **`SessionStart` / `SessionEnd` codex-pair-session hooks** — broker lifecycle scaffolding for the long-lived `codex app-server` (ADR-090 + ADR-093). No-op until `ASK_CODEX_BROKER=1` ships with the Tier 3 implementation.

> The plugin previously shipped two other hooks that have been removed:
>
> - A `Stop` hook (removed in [ADR-048](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) because the `Stop` event fires per-turn rather than per-session, making it noisy and high-latency, and `git diff HEAD` excluded untracked files which silently dropped coverage on new-file sessions.
> - A `PreToolUse` pre-commit Gemini-review hook (removed in [ADR-094](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) because per-file codex-pair review delivers higher-recall feedback continuously *during* editing rather than only at commit time, and the on-demand `/gemini-review` skill covers the explicit-review need.
>
> Use the `/gemini-review` slash command for explicit on-demand pre-commit reviews instead, or the `/codex-review` skill for a precision-first PR-style review.

## PostToolUse Hook: `codex-pair` (opt-in continuous review)

**Trigger:** After every `Edit`, `Write`, or `MultiEdit` that Claude performs.

**Action:** If — and only if — a marker file named `.codex-pair/context.md` exists somewhere from the current directory up to the project root, a fresh Codex review of the just-edited file is run with the marker's content as project context. **HIGH** and **MED** concerns are surfaced back to Claude on the next turn as system reminders; **LOW** concerns and all timing/skip telemetry are logged to `.codex-pair/log.jsonl` alongside the marker file.

> No marker file → the hook exits silently after one `fs.access()` call. **Zero codex calls, zero cost.** This is by design: the hook ships in every plugin install, but does nothing until a project opts in.

**Why this exists** — in the four-task benchmark from [ADR-077](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md) (four structurally different task types — CRUD endpoint, URL shortener, RFC-spec implementation, stateful business logic — chosen so the result would generalize across domains): Claude alone caught **2 of 10** probes; Claude + `/codex-review` caught **7 of 10**; Claude + `codex-pair` caught **10 of 10**. The three probes `/codex-review` missed exemplified the **"looks fine, runs wrong"** class — code that compiles, lints, and type-checks but produces wrong results because of an implicit invariant the model couldn't infer from a single file. `codex-pair`'s recall-first HIGH/MED/LOW grading catches that class. **The improvement is task-agnostic** — reproduced across all four tasks, not just the headline one. The two surfaces are **complementary, not competing**. (Subsequent lived-experience audit in [ADR-095](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md) confirms the benchmark holds in real flow on this very repo.)

### When to enable it

Decide BEFORE you opt in — the hook costs real money per edit, and the value is highest on code where missed concerns have outsized blast radius. The decision is about **code characteristics**, not project domain: any project has both kinds of code, and codex-pair earns its keep wherever there's a category of "looks fine, runs wrong" failure mode.

| Use the hook (recall-first) | Stick with `/codex-review` only (precision-first) |
|---|---|
| Code with hidden invariants the model can't infer from one file | Routine PR review |
| Code where latent bugs cost more than per-edit review (~$0.04–0.07) | Glue code, simple CRUD, refactors |
| Code evolving fast under written constraints (spec, protocol, ADR) | Cost-sensitive sessions |
| State coordination, concurrency, anything order-sensitive | One comprehensive report is enough |
| The "looks fine, runs wrong" failure mode would be expensive to catch later | |

### Enable it

Create a marker file at the root of the project where you want continuous review:

```bash
mkdir -p .codex-pair
cat > .codex-pair/context.md <<'EOF'
# .codex-pair/context.md

This is a payment-processing service. All currency calculations must
use integer cents internally (floating-point loses precision on every
charge). Concurrent requests are real. URL inputs are untrusted.

[Add domain invariants Codex can't infer from one file. Examples —
 Security: "all routes check user.role".
 Specs: "protocol XYZ must be followed".
 State: "cart syncs to localStorage on every mutation".
 Concurrency: "this handler must be idempotent under retry".]
EOF
```

The marker file's *presence* is the switch; its *content* is the project context Codex needs to review intelligently. One artifact, two purposes.

**Do NOT commit the `.codex-pair/` directory** — gitignore it. Each contributor's review context is their own; one developer iterating on prompt wording shouldn't dirty the shared history. The hook itself is project-policy (it's in the plugin); the marker is per-developer opt-in. Per [ADR-092](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md), every state artifact (marker, log, cache, `ignore` globs, pause sentinel, inflight locks) nests under the single directory — one `.gitignore` line covers everything:

```gitignore
.codex-pair/
```

For a new contributor joining a project, point them at this docs page to write their own marker — or share a template via a separate (committed) `.codex-pair.example/context.md` they can copy and tweak locally.

Once present, every `Edit` / `Write` / `MultiEdit` triggers a Codex review of the changed file. HIGH and MED concerns appear to Claude as a system reminder on the next turn, prefixed with `[codex-pair]` and the file path:

```
[codex-pair] src/billing/charge.ts

[HIGH] Monetary values are modeled as floating-point numbers
src/billing/charge.ts:12: `price` accepts arbitrary JS numbers for
money, which violates the stated requirement that currency uses
integer cents. Use integer minor units such as
`priceCents: z.number().int().nonnegative()`.
```

### Disable it

| Goal | How |
|---|---|
| Permanently for this project | `rm -rf .codex-pair/` |
| Just this Claude Code session | `/plugin disable ask-llm` |
| Just this command | `CODEX_PAIR_DISABLED=1 <command>` |

### Configuration knobs

| Env var | Default | Effect |
|---|---|---|
| `CODEX_PAIR_DISABLED` | unset | Set to `1` to bypass the hook entirely — beats marker file |
| `CODEX_PAIR_MAX_FILE_BYTES` | `20000` | Skip files larger than this many UTF-8 bytes |
| `ASK_CODEX_TIMEOUT_MS` | `800000` | Per-call Codex timeout (inherited from `ask-codex-mcp`, [ADR-074](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)) |

### Cost characteristics

- ~$0.04–0.07 per file reviewed (Codex GPT-5.5 with reasoning tokens)
- ~13–50s per file wall-clock
- Files over the size cap fall back to an adaptive partial-view review (header + git diff against HEAD, OR head + tail) — see [ADR-080](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md)
- `node_modules/`, `dist/`, lockfiles, fonts, archives, sourcemaps, snapshots, minified assets skipped automatically
- A 50-edit session is roughly $2–3.50 plus ~10–40 minutes of cumulative Codex latency — significantly less after the content-hash cache warms (item #8 / [ADR-082](https://github.com/Lykhoyda/ask-llm/blob/main/docs/DECISIONS.md))

For typical opted-in projects (small surface where review depth matters), the cost is acceptable. For routine refactor work across a whole repo, leave the marker file out and use `/codex-review` on demand instead.

### Inspecting log activity: `codex-pair-log` CLI

Shipped alongside the hook at `packages/claude-plugin/scripts/codex-pair-log.mjs`. Walks up from cwd to find the marker (same gate as the hook), then renders the sibling `.codex-pair/log.jsonl`. Useful for "is the hook actually running" diagnostics and for forensic analysis of what's been reviewed.

```bash
# Default: last 10 entries
node packages/claude-plugin/scripts/codex-pair-log.mjs

# Aggregate stats — verdict breakdown, top 5 files, cache hit rate, fallback frequency
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

Zero workspace imports — runs on a marketplace install with no `node_modules`.

### If the hook isn't firing automatically: the project-settings workaround (issue #74)

Some Claude Code installations don't auto-invoke plugin-declared PostToolUse hooks even though the plugin is correctly installed and `/reload-plugins` reports the hook count. This appears to be a Claude Code platform issue with the plugin-hook dispatch path — see [issue #74](https://github.com/Lykhoyda/ask-llm/issues/74) for the full diagnostic chain. The hook script itself works perfectly when invoked manually or when registered via a `~/.claude/settings.json` / `.claude/settings.local.json` `hooks` block.

**Quick diagnostic**: edit any file under your marker-anchored project. If `.codex-pair/log.jsonl` mtime doesn't advance within ~60s, you're hitting the dispatch bug.

**Workaround**: add a `hooks.PostToolUse` block to your **project-local** `.claude/settings.local.json` (per-developer; gitignored by convention) that invokes the hook script directly, bypassing the plugin-dispatch path. Pick the command form that matches your use case:

### Form A — Plugin maintainer (you're working on the ask-llm repo itself)

Point at the local repo source via `$PWD` so the path resolves to whatever directory Claude Code was launched in (the workspace root). Always reflects your current branch's working tree — no manual update on version bumps, no hardcoded absolute paths to maintain, and the same config works for every contributor regardless of where they cloned the repo:

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
- Requires launching Claude Code from the repo root (so `$PWD` resolves there). If you launch from a parent directory the hook silently fails — easy to spot via `node packages/claude-plugin/scripts/codex-pair-log.mjs --latest`.
- Requires a POSIX shell (`sh`) in `PATH`. macOS, Linux, and WSL have this natively. **Windows users on cmd.exe or PowerShell without Git Bash** should install [Git for Windows](https://gitforwindows.org/) (which provides `sh` via the bundled MINGW64 environment) or use an absolute Windows path instead of `$PWD` in the `command` field.

### Form B — Plugin user (you installed via marketplace)

Resolve the highest semver-sorted version from the cache at invocation time, so the workaround keeps working across plugin updates without manual edits:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "sh -c 'V=$(ls -1d $HOME/.claude/plugins/cache/ask-llm-plugins/ask-llm/*/ 2>/dev/null | sort -V | tail -1); [ -n \"$V\" ] && node \"$V/scripts/codex-pair-watch.mjs\"'"
          }
        ]
      }
    ]
  }
}
```

The `sort -V | tail -1` picks the highest semver directory under the cache. Silent no-op if no install is present.

### After either form

Run `/reload-plugins` to pick up the new hook config. The next Edit/Write/MultiEdit should fire the hook automatically (proven by `codex-pair OK:`/`WARN:` systemMessage in the transcript + a new `.codex-pair/log.jsonl` entry — typical wall clock 5-30s per call).

Note: this workaround is per-developer (project-local) and gitignored. Once Claude Code's plugin-hook dispatch is fixed upstream, you can remove the `hooks` block and rely on the plugin's own registration again.

## CLI Binaries

The plugin also ships CLI binaries you can call directly from your shell — useful for piping diffs into a provider outside of any hook:

```bash
# Pipe a diff to Gemini
git diff | ask-gemini-run "Review these changes for critical issues"

# Pipe to Codex
git diff --staged | ask-codex-run "Any bugs in these staged changes?"

# Pipe to local Ollama
cat src/auth.ts | ask-ollama-run "Review this auth implementation"
```

All three binaries accept:
- **Positional argument:** The prompt
- **Stdin:** Piped content (code, diffs, files)
- **Combined:** `echo 'code' | ask-gemini-run "review this"`
