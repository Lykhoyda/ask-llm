---
name: compare
description: This skill should be used when the user asks to "compare LLMs", "see how each provider answers", "side-by-side response", "what do Gemini, Codex, Grok, Ollama, and Antigravity think", or wants raw responses from multiple providers without synthesis. Unlike /brainstorm (which synthesizes findings) or /multi-review (which validates code reviews), /compare just shows each provider's answer side-by-side.
---

<!-- PORTABLE-CONTRACT:START -->
## Portable contract

Send the exact same bounded prompt to two to five selected providers concurrently. Preserve input order in the result, show each response verbatim without synthesis or adjudication, and show every provider failure instead of silently dropping it. Never invoke raw provider CLIs when a canonical Ask LLM bridge is available.
<!-- PORTABLE-CONTRACT:END -->

## Host adapters

### Pi adapter

Use one native `ask-multi` call. Put the common prompt in `prompt` and two to five unique names in `providers`; its implementation, not model-emitted sibling calls, guarantees concurrent bounded dispatch and stable ordering.

<!-- HOST-ADAPTER:CLAUDE-CODE:START -->
### Claude Code adapter

The existing detailed workflow below is the Claude Code adapter. Its Agent, MCP, hook, `CLAUDE_PLUGIN_ROOT`, and `AskUserQuestion` mechanics apply only on Claude Code; they do not override the Pi adapter above.



# Compare Provider Responses Side-by-Side

Send the same question to multiple LLM providers and present their responses verbatim, side-by-side. No synthesis, no consensus highlighting, no validation pipeline — just raw outputs so the user can compare directly.

This is the right tool when:
- You want to see how each provider phrases the same answer (style, depth, confidence)
- You want a sanity check before picking one provider's recommendation
- You want to evaluate which provider best fits a specific kind of question
- You explicitly want to AVOID Claude synthesizing or weighting the responses

If you want consensus extraction → use `/brainstorm` instead.
If you're reviewing a code diff → use `/multi-review` instead.

## Instructions

### Phase 1: Parse the request

Extract from the user's message:
1. **The question/prompt** to send to all providers (the meaningful payload)
2. **Optional provider filter** — if the user says "compare gemini and codex", only those two; otherwise default to all five (gemini, codex, grok, ollama, antigravity)
3. **Optional context files** — if the user references files (`@path/to/file`), Read each referenced file and inline its contents into the shared provider prompt under a clearly labeled `<context_file path="...">` block. `@file` expansion is Gemini-only; passing the literal path to Codex, Ollama, Grok, or Antigravity silently drops the context. For a file too large to inline safely, include the relevant excerpts and state what was omitted.

If the question is missing or ambiguous, ask the user to clarify before dispatching.

### Phase 2: Dispatch in parallel via a single foreground Bash call

Use the **ADR-050 dispatch pattern** (direct backgrounding + per-PID wait, NOT subshells, NOT `run_in_background: true`):

```bash
set +e
workdir=$(mktemp -d /tmp/ask-llm-compare-XXXXXX)
trap 'rm -rf "$workdir"' EXIT

GMCPT_TIMEOUT_MS=480000 node ${CLAUDE_PLUGIN_ROOT}/dist/run.js "$PROMPT" > "$workdir/gemini.out" 2> "$workdir/gemini.err" &
gem_pid=$!

GMCPT_TIMEOUT_MS=480000 node ${CLAUDE_PLUGIN_ROOT}/dist/codex-run.js "$PROMPT" > "$workdir/codex.out" 2> "$workdir/codex.err" &
codex_pid=$!

GMCPT_TIMEOUT_MS=480000 node ${CLAUDE_PLUGIN_ROOT}/dist/grok-run.js "$PROMPT" > "$workdir/grok.out" 2> "$workdir/grok.err" &
grok_pid=$!

GMCPT_TIMEOUT_MS=480000 node ${CLAUDE_PLUGIN_ROOT}/dist/ollama-run.js "$PROMPT" > "$workdir/ollama.out" 2> "$workdir/ollama.err" &
ollama_pid=$!

GMCPT_TIMEOUT_MS=480000 node ${CLAUDE_PLUGIN_ROOT}/dist/antigravity-run.js "$PROMPT" > "$workdir/antigravity.out" 2> "$workdir/antigravity.err" &
antigravity_pid=$!

gemini_rc=0; wait $gem_pid || gemini_rc=$?
codex_rc=0; wait $codex_pid || codex_rc=$?
grok_rc=0; wait $grok_pid || grok_rc=$?
ollama_rc=0; wait $ollama_pid || ollama_rc=$?
antigravity_rc=0; wait $antigravity_pid || antigravity_rc=$?

dump_provider() {
  provider="$1"
  rc="$2"
  echo "===== ${provider} (rc=${rc}) ====="
  cat "$workdir/${provider}.out" 2>/dev/null
  if [ "$rc" -ne 0 ] || [ ! -s "$workdir/${provider}.out" ]; then
    echo "===== ${provider} stderr ====="
    sed -n '1,20p' "$workdir/${provider}.err" 2>/dev/null
  fi
}

dump_provider gemini "$gemini_rc"
dump_provider codex "$codex_rc"
dump_provider grok "$grok_rc"
dump_provider ollama "$ollama_rc"
dump_provider antigravity "$antigravity_rc"
```

Set the Bash tool's `timeout` parameter to **600000ms** (10 minutes, the max). Default 2-minute Bash timeouts will SIGKILL the providers mid-response — this is the same bug class that ADR-050 fixed for the brainstorm-coordinator.

If the user asked for a subset of providers (e.g., "compare gemini and codex"), drop the dispatch lines for excluded providers and their corresponding wait and `dump_provider` lines.

### Phase 3: Read the captured output

The Bash call dumps every provider response and relevant stderr before its EXIT trap removes the unique work directory. Parse those labeled blocks directly from the Bash result. If a provider's output is empty or its exit code is non-zero, surface the captured stderr — DO NOT silently drop a provider. Never reuse fixed files under `/tmp`; overlapping sessions must remain isolated.

### Phase 4: Present side-by-side

Output structure:

```markdown
## Comparison: <one-line restatement of the question>

### Gemini
> <verbatim provider response, do NOT paraphrase>

### Codex
> <verbatim provider response>

### Grok
> <verbatim provider response>

### Ollama
> <verbatim provider response>

### Antigravity
> <verbatim provider response>

### Where they differ
- One bullet per substantive disagreement (1-2 sentences each)
- If they all agree, say "All providers gave substantively the same answer."
- Do NOT take a position on who's right — present the differences neutrally
```

If a provider failed:

```markdown
### Gemini
**Failed** (exit 1): <first 3 lines of stderr>
```

### Output discipline

- **Quote responses verbatim**: do not paraphrase, summarize, or condense. The user invoked `/compare` because they want raw output.
- **Stay neutral in the "Where they differ" section**: surface the disagreement, do not adjudicate it. If the user wants a recommendation, they will ask follow-up questions.
- **Keep your own commentary minimal**: a one-line question restatement at the top, the verbatim sections in the middle, the differences callout at the end. That's it.
- **Do not call `/brainstorm` or `/multi-review` instead** — `/compare` is intentionally simpler. If the user wanted synthesis they would have asked for it.

## Sub-Agent Background Job Lifecycle (must read)

Sub-agents in Claude Code cannot own background processes that outlive their turn. The ADR-050 lesson applies here exactly as it did for the brainstorm-coordinator:

- ❌ Do not use `run_in_background: true` on the dispatch Bash call
- ❌ Do not use `(cmd &) && wait` — the subshell detaches the child and `wait` returns immediately
- ❌ Do not split the dispatch across multiple Bash calls
- ✅ Single foreground blocking Bash call with direct backgrounding (`cmd & pid=$!`) and per-PID `wait`
- ✅ `timeout: 600000` on the Bash tool call

Without these, providers that take longer than the surrounding turn will be SIGKILLed mid-response and you will silently get 0-byte outputs.

<!-- HOST-ADAPTER:CLAUDE-CODE:END -->
