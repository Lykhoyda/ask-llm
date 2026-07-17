# Benchmark Run Protocol

Follow this protocol to collect latency and quality data for the approach comparison benchmark.

**Prerequisite:** All packages built (`yarn build`), Gemini CLI installed and authenticated.

## Scenarios

### S1: Small (~143 lines)
- **File:** `packages/shared/src/chunkCache.ts`
- **Prompt:** "Review @packages/shared/src/chunkCache.ts for bugs, edge cases, and potential improvements"

### S2: Medium (~355 lines)
- **File:** `packages/gemini-mcp/src/utils/geminiExecutor.ts`
- **Prompt:** "Review @packages/gemini-mcp/src/utils/geminiExecutor.ts for bugs, logic errors, and security concerns"

### S3: Large (~868 lines diff)
- **File:** `docs/benchmarks/fixtures/s3-codex-diff.patch`
- **Prompt:** "Review this diff for bugs, missing edge cases, and architectural concerns: [paste patch contents]"

## Approaches

### A1: Standalone MCP (@ask-llm/gemini-mcp)
- **MCP config:** `claude mcp add gemini-cli -- npx -y @ask-llm/gemini-mcp`
- **Invocation:** Claude calls `ask-gemini` tool directly

### A2: Orchestrator MCP (@ask-llm/mcp)
- **MCP config:** `claude mcp add ask-llm -- npx -y @ask-llm/mcp`
- **Invocation:** Claude calls `ask-gemini` tool (loaded via orchestrator)

### A3: Skill (/gemini-review)
- **Plugin:** `claude plugin install packages/claude-plugin`
- **Invocation:** User types `/gemini-review`

### A4: Subagent (gemini-reviewer)
- **Plugin:** `claude plugin install packages/claude-plugin`
- **Invocation:** User asks Claude to "use the gemini-reviewer agent to review..."

## Run Template

Copy this template for each of the 60 runs (4 approaches x 3 scenarios x 5 runs).

```
### Run [N]

**Approach:** [A1 / A2 / A3 / A4]
**Scenario:** [S1 / S2 / S3]
**Run #:** [1-5]
**Date:** YYYY-MM-DD

#### Setup
1. Start fresh Claude Code session (no prior context)
2. Verify server: ping tool returns response
3. Note session start time: __:__

#### Execution
4. Paste exact scenario prompt
5. Wait for complete response

#### Measurements
- Wall-clock time (seconds): ___
- Gemini thinking tokens: ___
- Gemini input tokens: ___
- Gemini output tokens: ___

#### Quality Assessment
- Findings count: ___
- Critical/High findings: ___
- Medium/Low findings: ___
- Key findings summary:
  1. ___
  2. ___
  3. ___
```

## Aggregation

After completing all 60 runs, compute per approach x scenario:
- **Latency:** mean, min, max of 5 runs
- **Quality:** compare findings across approaches for the same scenario. Score: Equivalent / Mostly Equivalent / Divergent

Record aggregated results in `docs/benchmarks/results.md`.
