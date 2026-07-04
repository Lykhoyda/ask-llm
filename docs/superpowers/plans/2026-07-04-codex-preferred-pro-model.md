# Codex Preferred Pro Model (`gpt-5.5-pro`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/codex-review` and `/brainstorm` opportunistically use `gpt-5.5-pro`, transparently falling back to `gpt-5.5` (then the existing `gpt-5.4-mini` quota rung) when the account is not entitled.

**Architecture:** Two dispatch paths get two mechanisms. Path A (`/codex-review` → `ask-codex` MCP tool → `executeCodexCLI`) gains an opt-in `preferred` flag that runs `gpt-5.5-pro` first and, on **any** failure, downgrades to the standard `gpt-5.5 → gpt-5.4-mini` path. Path B (`/brainstorm` → raw backgrounded `codex exec`) uses a bash `||` fallback with `${VAR:-default}` shell expansion so the same env overrides apply.

**Tech Stack:** TypeScript (ESM, Node16), Vitest, Biome, tsdown; Claude Code plugin markdown (agents/skills); Changesets.

## Global Constraints

- Node runtime `>=20`; build toolchain `>=22.18`.
- Use explicit type imports (`import type { ... }`).
- Do not add unnecessary comments.
- This touches `packages/codex-mcp/src` and `packages/claude-plugin` only — **not** `packages/shared` — so the all-five-MCP changeset rule (ADR-119) does **not** apply. The changeset covers `ask-codex-mcp` + `@ask-llm/plugin`.
- Model slug is env-overridable: `ASK_CODEX_PREFERRED_MODEL` (factory default `gpt-5.5-pro`), base `ASK_CODEX_MODEL` (default `gpt-5.5`), quota fallback `ASK_CODEX_FALLBACK_MODEL` (default `gpt-5.4-mini`).
- The preferred downgrade is **unconditional on any primary-leg failure** — no signal matching (ADR-132). The existing `DEFAULT → FALLBACK` rung stays quota-gated and byte-for-byte unchanged when `preferred` is falsy.
- All work stays on branch `feat/codex-preferred-pro-model` (already created).

---

### Task 1: Executor preferred tier + `MODELS.PREFERRED`

**Files:**
- Modify: `packages/codex-mcp/src/constants.ts` (the `MODELS` object)
- Modify: `packages/codex-mcp/src/utils/codexExecutor.ts` (`CodexExecutorOptions`, `executeCodexCLI`)
- Test: `packages/codex-mcp/src/utils/__tests__/codexExecutor.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `executeCommand`, `MODELS`, `CLI`, `Logger`, `parseCodexJsonlOutput`, `buildArgs` (all existing).
- Produces:
  - `MODELS.PREFERRED: string` (`process.env.ASK_CODEX_PREFERRED_MODEL || "gpt-5.5-pro"`).
  - `CodexExecutorOptions.preferred?: boolean`.
  - `executeCodexCLI` honors `preferred`: runs `MODELS.PREFERRED` once (fresh, non-edit calls only); on any failure downgrades to `MODELS.DEFAULT` with `fellBack: true`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/codex-mcp/src/utils/__tests__/codexExecutor.test.ts`:

```ts
describe("preferred model tier (gpt-5.5-pro → default → mini)", () => {
  const AGENT = (t: string) => `{"type":"item.completed","item":{"type":"agent_message","text":"${t}"}}`;
  const modelOf = (call: number) => {
    const [, args] = mockExecuteCommand.mock.calls[call];
    return args[args.indexOf(CLI.FLAGS.MODEL) + 1];
  };

  it("runs MODELS.PREFERRED when preferred:true and it succeeds (no downgrade)", async () => {
    mockExecuteCommand.mockResolvedValueOnce(AGENT("pro answer"));
    const result = await executeCodexCLI({ prompt: "review", preferred: true });
    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    expect(modelOf(0)).toBe(MODELS.PREFERRED);
    expect(result.response).toContain("pro answer");
    expect(result.usage?.model).toBe(MODELS.PREFERRED);
    expect(result.usage?.fellBack).toBe(false);
  });

  it("downgrades to DEFAULT on an ARBITRARY (non-quota, non-signal) preferred failure", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("some totally unrecognized model access error"))
      .mockResolvedValueOnce(AGENT("default answer"));
    const result = await executeCodexCLI({ prompt: "review", preferred: true });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
    expect(modelOf(0)).toBe(MODELS.PREFERRED);
    expect(modelOf(1)).toBe(MODELS.DEFAULT);
    expect(result.response).toContain("default answer");
    expect(result.usage?.model).toBe(MODELS.DEFAULT);
    expect(result.usage?.fellBack).toBe(true);
  });

  it("full ladder: preferred quota → default quota → mini", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockRejectedValueOnce(new Error("rate_limit_exceeded"))
      .mockResolvedValueOnce(AGENT("mini answer"));
    const result = await executeCodexCLI({ prompt: "review", preferred: true });
    expect(mockExecuteCommand).toHaveBeenCalledTimes(3);
    expect([modelOf(0), modelOf(1), modelOf(2)]).toEqual([MODELS.PREFERRED, MODELS.DEFAULT, MODELS.FALLBACK]);
    expect(result.response).toContain("mini answer");
  });

  it("surfaces a non-quota DEFAULT error after downgrade (base→mini stays quota-gated)", async () => {
    mockExecuteCommand
      .mockRejectedValueOnce(new Error("preferred boom"))
      .mockRejectedValueOnce(new Error("hard parse error in prompt"));
    await expect(executeCodexCLI({ prompt: "review", preferred: true })).rejects.toThrow("hard parse error in prompt");
    expect(mockExecuteCommand).toHaveBeenCalledTimes(2);
  });

  it("preferred:false leaves behavior unchanged (single DEFAULT call)", async () => {
    mockExecuteCommand.mockResolvedValueOnce(AGENT("x"));
    await executeCodexCLI({ prompt: "review", preferred: false });
    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    expect(modelOf(0)).toBe(MODELS.DEFAULT);
  });

  it("explicit model wins over preferred (no pro attempt)", async () => {
    mockExecuteCommand.mockResolvedValueOnce(AGENT("x"));
    await executeCodexCLI({ prompt: "review", preferred: true, model: "o3" });
    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    const [, args] = mockExecuteCommand.mock.calls[0];
    expect(args).toContain("o3");
    expect(args).not.toContain(MODELS.PREFERRED);
  });

  it("skips the preferred attempt when preferred:true but a sessionId is present", async () => {
    mockExecuteCommand.mockResolvedValueOnce(AGENT("resumed"));
    await executeCodexCLI({ prompt: "review", preferred: true, sessionId: "thread-1" });
    expect(mockExecuteCommand).toHaveBeenCalledOnce();
    expect(modelOf(0)).toBe(MODELS.DEFAULT);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn workspace ask-codex-mcp run test -- codexExecutor`
Expected: FAIL — the `preferred` option is not yet honored (e.g. preferred test calls `executeCommand` once with `MODELS.DEFAULT`, not `MODELS.PREFERRED`), and `MODELS.PREFERRED` is `undefined`.

- [ ] **Step 3: Add `MODELS.PREFERRED` to constants**

In `packages/codex-mcp/src/constants.ts`, extend the `MODELS` object (add after the `DEFAULT` line):

```ts
export const MODELS = {
  DEFAULT: process.env.ASK_CODEX_MODEL || FACTORY_DEFAULT_MODEL,
  // Opportunistic higher-reasoning tier for /codex-review and /brainstorm only.
  // ChatGPT Pro subscribers are entitled to gpt-5.5-pro; everyone else is not,
  // so the preferred leg downgrades to DEFAULT on any failure (ADR-132).
  PREFERRED: process.env.ASK_CODEX_PREFERRED_MODEL || "gpt-5.5-pro",
  FALLBACK: process.env.ASK_CODEX_FALLBACK_MODEL || "gpt-5.4-mini",
};
```

- [ ] **Step 4: Add the `preferred` option to `CodexExecutorOptions`**

In `packages/codex-mcp/src/utils/codexExecutor.ts`, add to the `CodexExecutorOptions` interface (after `editMode?`):

```ts
  // Opt-in for /codex-review and /brainstorm: try MODELS.PREFERRED first and
  // downgrade to MODELS.DEFAULT on any failure. Honored only for fresh
  // (no sessionId), non-edit calls with no explicit model. See ADR-132.
  preferred?: boolean;
```

- [ ] **Step 5: Implement the preferred leg in `executeCodexCLI`**

In `packages/codex-mcp/src/utils/codexExecutor.ts`, locate this block (just before `const startedAt = Date.now();`):

```ts
  const timeoutMs = resolveTimeoutMs(EXECUTION.CODEX_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CODEX_TIMEOUT_MS);

  const startedAt = Date.now();
```

Insert the preferred leg between them:

```ts
  const timeoutMs = resolveTimeoutMs(EXECUTION.CODEX_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CODEX_TIMEOUT_MS);

  // Preferred tier (opt-in, fresh non-edit calls only): try MODELS.PREFERRED
  // once. The preferred model is opportunistic, so ANY failure downgrades to the
  // standard MODELS.DEFAULT path below (which carries the quota→FALLBACK ladder).
  // Deliberately NOT signal-matched — an unknown entitlement-rejection string
  // must still fall back. See ADR-132.
  let downgradedFromPreferred = false;
  if (options.preferred === true && !options.model && !wantsSession && !editMode && MODELS.PREFERRED !== MODELS.DEFAULT) {
    const preferredArgs = buildArgs(options.prompt, MODELS.PREFERRED, undefined, useStdin, options.includeDirs, false, undefined);
    const preferredStartedAt = Date.now();
    try {
      const raw = await executeCommand(CLI.COMMANDS.CODEX, preferredArgs, options.onProgress, undefined, stdinPayload, timeoutMs);
      return parseCodexJsonlOutput(raw, MODELS.PREFERRED, Date.now() - preferredStartedAt, false);
    } catch (preferredError) {
      const reason = preferredError instanceof Error ? preferredError.message : String(preferredError);
      Logger.warn(`Preferred Codex model ${MODELS.PREFERRED} unavailable (${reason}); falling back to ${MODELS.DEFAULT}.`);
      downgradedFromPreferred = true;
    }
  }

  const startedAt = Date.now();
```

Then, in the same function, change the primary-success parse line so the downgrade is reflected in `fellBack`. Find:

```ts
      const result = parseCodexJsonlOutput(raw, model, Date.now() - startedAt, false);
```

Replace with:

```ts
      const result = parseCodexJsonlOutput(raw, model, Date.now() - startedAt, downgradedFromPreferred);
```

Notes for the implementer:
- `wantsSession`, `useStdin`, `stdinPayload`, `model` (= `options.model || MODELS.DEFAULT`) are already declared earlier in the function — reuse them.
- The preferred success path intentionally does **not** write the response cache (the top-level `cacheKey` is keyed to `MODELS.DEFAULT`; caching a pro answer under it would be cross-tier). Only clean DEFAULT successes cache, exactly as today.
- Do not add the archived-session guard here — the preferred leg only runs when `!wantsSession`, so there is no session to be archived.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn workspace ask-codex-mcp run test -- codexExecutor`
Expected: PASS (all preferred-tier tests plus the pre-existing suite).

- [ ] **Step 7: Lint**

Run: `yarn workspace ask-codex-mcp run lint`
Expected: no errors (Biome may auto-format; re-stage if it does).

- [ ] **Step 8: Commit**

```bash
git add packages/codex-mcp/src/constants.ts packages/codex-mcp/src/utils/codexExecutor.ts packages/codex-mcp/src/utils/__tests__/codexExecutor.test.ts
git commit -m "feat(codex): preferred gpt-5.5-pro tier with unconditional downgrade to gpt-5.5

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Expose `preferred` on the `ask-codex` tool + docs

**Files:**
- Modify: `packages/codex-mcp/src/tools/ask-codex.tool.ts` (schema + execute)
- Test: `packages/codex-mcp/src/tools/__tests__/toolSchemas.test.ts` (append one test)
- Modify: `apps/docs/public/llms.txt:34`
- Modify: `apps/docs/public/llms-full.txt` (ask-codex Parameters block + env-var table)

**Interfaces:**
- Consumes: `MODELS.PREFERRED`, `MODELS.DEFAULT` (Task 1), `executeCodexCLI` `preferred` option (Task 1).
- Produces: `ask-codex` accepts `preferred?: boolean` and forwards it to `executeCodexCLI`.

- [ ] **Step 1: Write the failing test**

Append inside the `describe("tool contract (drift guards)", ...)` block in `packages/codex-mcp/src/tools/__tests__/toolSchemas.test.ts`:

```ts
  it("ask-codex accepts an optional `preferred` boolean (default off)", () => {
    expect(askCodexTool.zodSchema.safeParse({ prompt: "p" }).success).toBe(true);
    expect(askCodexTool.zodSchema.safeParse({ prompt: "p", preferred: true }).success).toBe(true);
    expect(askCodexTool.zodSchema.safeParse({ prompt: "p", preferred: "yes" }).success).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn workspace ask-codex-mcp run test -- toolSchemas`
Expected: FAIL — `preferred: "yes"` currently parses `true` because unknown keys are stripped, so `.success` is `true` not `false`.

- [ ] **Step 3: Add `preferred` to the tool schema**

In `packages/codex-mcp/src/tools/ask-codex.tool.ts`, add to `askCodexArgsSchema` (after the `includeDirs` field):

```ts
  preferred: z
    .boolean()
    .optional()
    .describe(
      `Prefer the higher-reasoning model (${MODELS.PREFERRED}) and fall back to ${MODELS.DEFAULT} automatically if it is unavailable. Used by /codex-review and /brainstorm; leave unset for normal calls.`,
    ),
```

- [ ] **Step 4: Forward `preferred` through `execute`**

In the same file, update the destructure and the executor call:

```ts
    const { prompt, model, sessionId, includeDirs, preferred } = args;
```

```ts
    const result = await executeCodexCLI({
      prompt: prompt as string,
      model: model as string | undefined,
      sessionId: sessionId as string | undefined,
      includeDirs: includeDirs as string[] | undefined,
      preferred: preferred as boolean | undefined,
      onProgress,
    });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn workspace ask-codex-mcp run test -- toolSchemas`
Expected: PASS.

- [ ] **Step 6: Update the AI-readable docs**

In `apps/docs/public/llms.txt`, change line 34 from:

```
| ask-codex | ask-codex-mcp | prompt (required), model (optional), sessionId (optional), includeDirs (optional) | Send prompts to Codex CLI. sessionId resumes a Codex thread. |
```

to:

```
| ask-codex | ask-codex-mcp | prompt (required), model (optional), sessionId (optional), includeDirs (optional), preferred (optional) | Send prompts to Codex CLI. sessionId resumes a Codex thread. preferred=true prefers gpt-5.5-pro with automatic fallback (used by /codex-review, /brainstorm). |
```

In `apps/docs/public/llms-full.txt`, add a bullet to the `### ask-codex` Parameters block (after the `includeDirs` line, currently line 177):

```
  - `preferred` (boolean, optional): Prefer the higher-reasoning model (gpt-5.5-pro) and fall back to gpt-5.5 automatically if unavailable. Used by /codex-review and /brainstorm; leave unset for normal calls.
```

And add a row to the env-var table (after the `ASK_CODEX_MODEL` row, currently line 396):

```
| ASK_CODEX_PREFERRED_MODEL | gpt-5.5-pro | Preferred model for /codex-review and /brainstorm; falls back to ASK_CODEX_MODEL if unavailable |
```

- [ ] **Step 7: Lint**

Run: `yarn workspace ask-codex-mcp run lint`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/codex-mcp/src/tools/ask-codex.tool.ts packages/codex-mcp/src/tools/__tests__/toolSchemas.test.ts apps/docs/public/llms.txt apps/docs/public/llms-full.txt
git commit -m "feat(codex): add opt-in preferred arg to ask-codex tool + docs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire `/codex-review` (agent + skill) to request the preferred model

**Files:**
- Modify: `packages/claude-plugin/agents/codex-reviewer.md` (Phase 2)
- Modify: `packages/claude-plugin/skills/codex-review/SKILL.md` (Instructions)

**Interfaces:**
- Consumes: the `ask-codex` `preferred` arg (Task 2).
- Produces: the review path calls `ask-codex` with `preferred: true`.

- [ ] **Step 1: Add the instruction to the codex-reviewer agent**

In `packages/claude-plugin/agents/codex-reviewer.md`, find the Phase 2 opening line:

```
When calling `ask-codex`, structure the prompt to request confidence scoring AND severity classification:
```

Replace it with:

```
When calling `ask-codex`, set `preferred: true` (this reviews with the higher-reasoning model `gpt-5.5-pro` when your Codex account is entitled, and transparently falls back to `gpt-5.5` otherwise). Structure the prompt to request confidence scoring AND severity classification:
```

- [ ] **Step 2: Note it in the codex-review skill**

In `packages/claude-plugin/skills/codex-review/SKILL.md`, find step 3 under `## Instructions`:

```
3. Launch the `codex-reviewer` agent with the diff content. The agent handles the Codex prompt structure and output formatting.
```

Replace with:

```
3. Launch the `codex-reviewer` agent with the diff content. The agent handles the Codex prompt structure and output formatting, and requests the preferred higher-reasoning model (`gpt-5.5-pro`, auto-falling back to `gpt-5.5`).
```

- [ ] **Step 3: Verify the edits landed**

Run: `grep -n "preferred: true" packages/claude-plugin/agents/codex-reviewer.md && grep -n "gpt-5.5-pro" packages/claude-plugin/skills/codex-review/SKILL.md`
Expected: both matches print.

- [ ] **Step 4: Commit**

```bash
git add packages/claude-plugin/agents/codex-reviewer.md packages/claude-plugin/skills/codex-review/SKILL.md
git commit -m "feat(plugin): codex-review requests the preferred gpt-5.5-pro tier

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Brainstorm coordinator — preferred codex model with shell-default fallback

**Files:**
- Modify: `packages/claude-plugin/agents/brainstorm-coordinator.md` (the codex dispatch line in the Phase 3A template, currently ~lines 144-146)

**Interfaces:**
- Consumes: nothing new (raw `codex exec`).
- Produces: the codex leg tries `${ASK_CODEX_PREFERRED_MODEL:-gpt-5.5-pro}` then `${ASK_CODEX_MODEL:-gpt-5.5}`.

- [ ] **Step 1: Replace the codex dispatch block**

In `packages/claude-plugin/agents/brainstorm-coordinator.md`, find:

```bash
# Only include this line if codex was requested (in the default set):
codex exec --sandbox workspace-write - < "$workdir/prompt.md" > "$workdir/codex.out" 2> "$workdir/codex.err" &
pid_codex=$!
```

Replace with:

```bash
# Only include this block if codex was requested (in the default set).
# Prefer gpt-5.5-pro (ChatGPT Pro subscribers); on ANY failure fall back to the
# base model. Both models honor env overrides via ${VAR:-default} so the escape
# hatch matches the ask-codex executor (ADR-132). prompt.md is a FILE (not a
# pipe), so both attempts can re-read it. The whole `{ ...; }` group is
# backgrounded as one job so pid_codex/`wait` capture the leg's final exit code.
codex_pref="${ASK_CODEX_PREFERRED_MODEL:-gpt-5.5-pro}"
codex_base="${ASK_CODEX_MODEL:-gpt-5.5}"
{ codex exec --sandbox workspace-write -m "$codex_pref" - < "$workdir/prompt.md" \
  || codex exec --sandbox workspace-write -m "$codex_base" - < "$workdir/prompt.md"; } \
  > "$workdir/codex.out" 2> "$workdir/codex.err" &
pid_codex=$!
```

- [ ] **Step 2: Syntax-check the new bash snippet**

Extract-and-check the group command is well-formed (this validates the shell grammar without running codex):

Run:
```bash
bash -n <(printf '%s\n' 'workdir=/tmp/x' 'codex_pref="${ASK_CODEX_PREFERRED_MODEL:-gpt-5.5-pro}"' 'codex_base="${ASK_CODEX_MODEL:-gpt-5.5}"' '{ echo a -m "$codex_pref" < "$workdir/prompt.md" || echo b -m "$codex_base" < "$workdir/prompt.md"; } > /tmp/o 2> /tmp/e &' 'wait $! 2>/dev/null')
```
Expected: no output (exit 0 = valid syntax).

- [ ] **Step 3: Commit**

```bash
git add packages/claude-plugin/agents/brainstorm-coordinator.md
git commit -m "feat(plugin): brainstorm prefers gpt-5.5-pro with shell-default fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: ADR, provider-parity, roadmap, changeset

**Files:**
- Modify: `docs/DECISIONS.md` (append ADR-132)
- Modify: `docs/PROVIDER-PARITY.md` (note the codex review-tier ladder)
- Modify: `docs/ROADMAP.md` (dated run entry)
- Create: `.changeset/codex-preferred-pro-model.md`

**Interfaces:** none (documentation + release metadata).

- [ ] **Step 1: Append ADR-132 to `docs/DECISIONS.md`**

Add at the end of the file:

```markdown
## ADR-132: Preferred `gpt-5.5-pro` tier for /codex-review and /brainstorm

**Status:** Accepted (2026-07-04)

**Context:** ChatGPT Pro subscribers are entitled to `gpt-5.5-pro` ("maximum
reasoning or quality"); standard plans are not (confirmed empirically — the slug
is absent from a ChatGPT-plan account's `~/.codex/models_cache.json`). The
second-opinion commands `/codex-review` and `/brainstorm` are exactly where the
extra reasoning is worth the latency/cost, but the raw `ask-codex` tool,
`codex-pair`, `/multi-review`, and `/codex-verify` should stay on `gpt-5.5`.

**Decision:** Add an opt-in preferred tier scoped to those two commands.
- `MODELS.PREFERRED = ASK_CODEX_PREFERRED_MODEL || "gpt-5.5-pro"`.
- `executeCodexCLI({ preferred: true })` (fresh non-edit calls only) runs the
  preferred model once and, on **any** failure, downgrades to `MODELS.DEFAULT`,
  below which the existing quota-gated `DEFAULT → FALLBACK` rung is unchanged.
  Ladder: `gpt-5.5-pro → gpt-5.5 → gpt-5.4-mini`.
- `/codex-review` opts in via the `ask-codex` `preferred` arg; `/brainstorm`
  (raw backgrounded `codex exec`) uses `-m "${ASK_CODEX_PREFERRED_MODEL:-gpt-5.5-pro}" || -m "${ASK_CODEX_MODEL:-gpt-5.5}"`.

**Why unconditional (not signal-matched):** the existing `isModelUnavailableError`
/ `isQuotaError` predicates are narrow substring matchers. The exact
entitlement-rejection string for `gpt-5.5-pro` is unverified, so gating the
downgrade on them would risk a hard failure for the exact non-Pro users the
feature protects. Any preferred-leg failure downgrades; a WARN log carries the
reason for observability. This also makes Path A symmetric with Path B's
unconditional `||`.

**Alternatives rejected:** env-only trigger (can't distinguish review from
codex-pair in the shared long-lived MCP server); routing brainstorm through the
`ask-codex-run` binary (adds a fragile `${CLAUDE_PLUGIN_ROOT}` dependency to the
ADR-#23 background-lifecycle block); signal-matching bash fallback (duplicates
`MODEL_UNAVAILABLE_SIGNALS` outside TypeScript, violating single-source-of-truth).

**Consequence:** not a `packages/shared` change, so ADR-119's all-five-MCP
changeset rule does not apply; the changeset covers `ask-codex-mcp` + `@ask-llm/plugin`.
```

- [ ] **Step 2: Note the variance in `docs/PROVIDER-PARITY.md`**

Add a row/note (match the file's existing table or section style) recording that
codex has a **three-tier** model ladder for the review/brainstorm tier
(`gpt-5.5-pro → gpt-5.5 → gpt-5.4-mini`) whereas its default tier and the other
providers do not. Open the file first to match its format, then add:

```markdown
- **Codex review/brainstorm tier (ADR-132):** `/codex-review` and `/brainstorm`
  prefer `gpt-5.5-pro` and downgrade unconditionally to `gpt-5.5`, then to
  `gpt-5.4-mini` on quota. This preferred rung is opt-in (`preferred` arg /
  `ASK_CODEX_PREFERRED_MODEL`) and does NOT apply to the raw `ask-codex` tool,
  `codex-pair`, `/multi-review`, or `/codex-verify`.
```

- [ ] **Step 3: Add a dated entry to `docs/ROADMAP.md`**

Add under a `## 2026-07-04` heading (create it if absent):

```markdown
## 2026-07-04
- Codex review/brainstorm preferred model: `/codex-review` and `/brainstorm` now
  prefer `gpt-5.5-pro` (ChatGPT Pro) with unconditional fallback to `gpt-5.5`,
  then the existing `gpt-5.4-mini` quota rung. Opt-in `preferred` arg on
  `ask-codex` + `ASK_CODEX_PREFERRED_MODEL`. ADR-132.
```

- [ ] **Step 4: Create the changeset**

Create `.changeset/codex-preferred-pro-model.md`:

```markdown
---
"ask-codex-mcp": minor
"@ask-llm/plugin": minor
---

Codex `/codex-review` and `/brainstorm` now prefer `gpt-5.5-pro` when the Codex
account is entitled, falling back transparently to `gpt-5.5` (then `gpt-5.4-mini`
on quota). Those two commands opt in automatically; the raw `ask-codex` tool can
opt in with the new `preferred` arg. `ASK_CODEX_PREFERRED_MODEL` customizes which
model the preferred tier uses (default `gpt-5.5-pro`) — it does not by itself
enable preferred mode. `codex-pair`, `/multi-review`, and `/codex-verify` are
unchanged. (ADR-132)
```

- [ ] **Step 5: Verify changeset guard passes**

Run: `node scripts/check-shared-changeset.mjs`
Expected: pass (no `packages/shared` change, so the all-five rule is not triggered).

- [ ] **Step 6: Commit**

```bash
git add docs/DECISIONS.md docs/PROVIDER-PARITY.md docs/ROADMAP.md .changeset/codex-preferred-pro-model.md
git commit -m "docs: ADR-132 preferred codex model + parity/roadmap/changeset

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Build the codex package (tsdown inlines shared)**

Run: `yarn workspace ask-codex-mcp run build`
Expected: build succeeds.

- [ ] **Step 2: Full test + lint across the repo**

Run: `yarn test && yarn lint`
Expected: all tests pass; Biome + `tsc --noEmit` clean.

- [ ] **Step 3: Confirm the tool description still pins the factory default (drift guard)**

Run: `yarn workspace ask-codex-mcp run test -- toolSchemas`
Expected: PASS — including "ask-codex's description names the factory default model".

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/codex-preferred-pro-model
gh pr create --fill --base main
```

Note: the pre-push husky smoke test runs live providers; a codex quota error skips-with-warning (ADR-051). If the smoke test fails for a reason provably unrelated to this diff, `--no-verify` is the documented escape.

## Notes / accepted caveats (from the spec)

- **Preferred attempt is not response-cached** (top-level cache key is DEFAULT-scoped); review prompts are near-unique diffs, so the loss is negligible. A previously cached DEFAULT answer short-circuits before the preferred leg — acceptable given the short cache TTL.
- **Brainstorm double-run on genuine timeout:** if a Pro run truly times out (rather than fails fast), the sequential `|| ` retry could approach the 600s Bash cap and get the leg killed. Rare; the coordinator already degrades gracefully on a failed codex leg. Documented, not mitigated in v1.
