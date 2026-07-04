---
name: compare
description: This skill should be used when the user asks to "compare LLMs", "see how each provider answers", "side-by-side response", "what do Gemini, Codex, Ollama, and Antigravity think", or wants raw responses from multiple providers without synthesis. Unlike /brainstorm (which synthesizes findings) or /multi-review (which validates code reviews), /compare just shows each provider's answer side-by-side.
user_invocable: true
---

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
2. **Optional provider filter** — if the user says "compare gemini and codex", only those two; otherwise default to all four (gemini, codex, ollama, antigravity)
3. **Optional context files** — if the user references files (`@path/to/file`), preserve the `@` syntax in the per-provider prompt

If the question is missing or ambiguous, ask the user to clarify before dispatching.

### Phase 2: Dispatch in parallel via a single foreground Bash call

Use the **ADR-050 dispatch pattern** (direct backgrounding + per-PID wait, NOT subshells, NOT `run_in_background: true`):

```bash
rm -f /tmp/ask-llm-compare-*.out /tmp/ask-llm-compare-*.err

GMCPT_TIMEOUT_MS=480000 node ${CLAUDE_PLUGIN_ROOT}/dist/run.js "$PROMPT" > /tmp/ask-llm-compare-gemini.out 2> /tmp/ask-llm-compare-gemini.err &
gem_pid=$!

GMCPT_TIMEOUT_MS=480000 node ${CLAUDE_PLUGIN_ROOT}/dist/codex-run.js "$PROMPT" > /tmp/ask-llm-compare-codex.out 2> /tmp/ask-llm-compare-codex.err &
codex_pid=$!

GMCPT_TIMEOUT_MS=480000 node ${CLAUDE_PLUGIN_ROOT}/dist/ollama-run.js "$PROMPT" > /tmp/ask-llm-compare-ollama.out 2> /tmp/ask-llm-compare-ollama.err &
ollama_pid=$!

GMCPT_TIMEOUT_MS=480000 node ${CLAUDE_PLUGIN_ROOT}/dist/antigravity-run.js "$PROMPT" > /tmp/ask-llm-compare-antigravity.out 2> /tmp/ask-llm-compare-antigravity.err &
antigravity_pid=$!

gem_rc=0; wait $gem_pid || gem_rc=$?
codex_rc=0; wait $codex_pid || codex_rc=$?
ollama_rc=0; wait $ollama_pid || ollama_rc=$?
antigravity_rc=0; wait $antigravity_pid || antigravity_rc=$?

echo "exits: gemini=$gem_rc codex=$codex_rc ollama=$ollama_rc antigravity=$antigravity_rc"
echo "bytes: gemini=$(wc -c < /tmp/ask-llm-compare-gemini.out) codex=$(wc -c < /tmp/ask-llm-compare-codex.out) ollama=$(wc -c < /tmp/ask-llm-compare-ollama.out) antigravity=$(wc -c < /tmp/ask-llm-compare-antigravity.out)"
```

Set the Bash tool's `timeout` parameter to **600000ms** (10 minutes, the max). Default 2-minute Bash timeouts will SIGKILL the providers mid-response — this is the same bug class that ADR-050 fixed for the brainstorm-coordinator.

If the user asked for a subset of providers (e.g., "compare gemini and codex"), drop the dispatch lines for the excluded providers and the corresponding wait/echo lines.

### Phase 3: Read the outputs

After the Bash call returns, Read each `/tmp/ask-llm-compare-<provider>.out` file. If a provider's output is 0 bytes or its exit code is non-zero, also Read its `.err` file to surface the failure reason — DO NOT silently drop a provider.

### Phase 4: Present side-by-side

Output structure:

```markdown
## Comparison: <one-line restatement of the question>

### Gemini
> <verbatim provider response, do NOT paraphrase>

### Codex
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
