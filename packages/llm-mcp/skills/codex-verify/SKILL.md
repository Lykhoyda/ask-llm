---
name: codex-verify
description: Verifies what the assistant claims to have done — proves the work against actual state using OpenAI Codex with a read-only tool surface. Use when the user asks to "verify with Codex", "check the assistant's claims", "did Codex actually do what it said", "verify this turn", "prove the work", or wants a trust check distinct from issue review. Different from `/codex-review`, which finds new issues.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Capture the prior assistant message verbatim, decompose it into atomic claims, and verify those claims against actual repository state with a read-only Codex consultation where useful. This is claim verification, not issue hunting. Preserve the Report block, five-grade confidence ladder, parser fallback, and explicit unverifiable state.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Apply only the portable contract in `../../agents/codex-verifier.md` inline and call native `ask-codex` for focused claim checks. Do not claim an isolated verifier context.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Codex Claim Verification

Prove or disprove what the assistant agent claims to have done in the current turn, independently. This is a **trust check**, not an issue hunt — separate from `/codex-review`.

## Why this is separate from `/codex-review`

- `/codex-review` looks for new bugs in the diff (issue hunt).
- `/codex-verify` proves the assistant's claims against actual state (trust verification).

A single tool would dilute both contracts. The verifier is **structurally narrowed by design**: it does not propose fixes, does not list issues outside the assistant's claims, does not drift into "while I'm here let me also...". That narrowness is the feature — it forces every "verified" verdict to be backed by a deterministic tool output.

The two skills compose. Run both when you want both questions answered. Do not merge their outputs.

## Instructions

### Phase 1: Gather inputs

1. Combine the diff:
   - `git diff` (unstaged changes)
   - `git diff --cached` (staged changes)
2. **If the diff is empty**, stop and tell the user "no changes to verify."
3. Capture the assistant's last message — the message in the prior turn where the assistant stated what it did. This is the source of claims to verify. Pass it through verbatim — do not summarize, do not paraphrase. The agent decomposes claims directly from this text.

If the conversation has no prior assistant message stating what was done (e.g., the diff exists but came from a manual edit), tell the user: "no assistant claim to verify — run `/codex-review` for issue review instead."

### Phase 2: Dispatch the verifier agent

Launch the `codex-verifier` agent with two inputs:
- The combined diff
- The assistant's last message (verbatim)

The agent owns the contract: read-only tool surface, claim decomposition, per-claim deterministic verification, and the `## Report` output block. Wait for its output.

### Phase 3: Defensive parse of the Report block

Find the `## Report` block in the agent's output. Extract:

- **`STATUS:`** — one of `verified`, `failed`, `unsure`. If missing, treat as `unsure`.
- **`CONFIDENCE:`** — one of `PERFECT`, `VERIFIED`, `PARTIAL`, `FEEDBACK`, `FAILED`. **If missing, derive from STATUS:**
  - `verified → VERIFIED`
  - `failed → FEEDBACK`
  - `unsure → FAILED`

  This fallback mirrors the Pi verifier's defensive parser — LLMs occasionally drop the second adjacent metadata line, and the consumer should not abort on that.
- The five sections: "What did you verify?", "What could you not verify?", "Corrective feedback", "What do you need to verify this next time?", "Verification metadata".

### Phase 4: Present the result

```markdown
## Codex Verification — <CONFIDENCE>

**Status:** <verified | failed | unsure>
**Atomic claims:** <total> total · <V> verified · <F> failed · <U> unverifiable

### Verified
- <claim> — <evidence: file:line, command output>

### Failed
- <claim> — <evidence>

### Unverifiable
- <claim> — <reason: missing oracle/fixture/runtime>

### Corrective feedback (when STATUS=failed)
> <verbatim from the agent's report — the user can paste this back to the assistant>

### What's missing for next time
<from "What do you need to verify this next time?" — these gaps are templates/fixtures/scripts the operator should add to the project to make future verifications stronger>
```

### Phase 5: Surface the right signal for each grade

- **PERFECT / VERIFIED** — Brief output. Don't bury the lede; one or two sentences confirming the claims are true.
- **PARTIAL** — **Surface the gaps loudly.** PARTIAL is the most actionable grade for project-level investment: every unverifiable claim is a fixture or script you should consider adding. Highlight the "what's missing for next time" section.
- **FEEDBACK** — Surface the corrective feedback verbatim. The operator can paste it back to start the next turn with a concrete fix.
- **FAILED** — The verification harness itself is the bottleneck. Tell the user explicitly: "Codex couldn't verify — the gap is in our verification surface, not in the work." Suggest the missing pieces.

## Important rules

- **Do not merge `/codex-verify` and `/codex-review` outputs.** They answer different questions. If a user wants both, run them separately and present them separately.
- **Do not rewrite the corrective feedback.** Pass it through verbatim. The agent wrote it precisely; paraphrasing dilutes the actionability.
- **PARTIAL is a real verdict, not a softer VERIFIED.** Surface the unverifiable claims clearly — those gaps are the next thing the operator templates into the project.
- **Don't reuse the verifier for "review my code."** That's `/codex-review`'s job. The verifier is structurally narrowed by design and will not return useful issue-hunt output.
- **No silent drops.** If parsing the Report block fails (e.g., agent didn't emit the block, output truncated), surface that to the user with the raw agent output rather than fabricating a verdict.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
