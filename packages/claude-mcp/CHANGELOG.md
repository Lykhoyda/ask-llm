# @ask-llm/claude-mcp

## 0.1.5

### Patch Changes

- [#246](https://github.com/Lykhoyda/ask-llm/pull/246) [`a1f62ad`](https://github.com/Lykhoyda/ask-llm/commit/a1f62ad1625c4248876c40842801fe0c4403c561) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Improve shared CLI diagnostics with cross-platform command lookup and provider version assessment, update the antigravity provider default model to agy 1.1.5's stable base slug `gemini-3.1-pro`, and exclude detected unsupported installations from dispatch with actionable diagnostics ([#243](https://github.com/Lykhoyda/ask-llm/issues/243)).

## 0.1.4

### Patch Changes

- [#237](https://github.com/Lykhoyda/ask-llm/pull/237) [`ba569cc`](https://github.com/Lykhoyda/ask-llm/commit/ba569cc1f8346ef2db76e6733fa9d9f222f61242) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add an escape hatch to the nested-session guard. `ask-claude` hard-fails whenever
  `CLAUDECODE` is set, but IDE extensions set that variable in their integrated
  terminals, where a human may legitimately run Codex or another non-Claude-Code MCP
  host. The guard now throws only when `CLAUDECODE` is set AND the new
  `ASK_CLAUDE_ALLOW_NESTED` override is not truthy (`1`/`true`). The blocked-session
  error message now points IDE-terminal users at the override.

## 0.1.3

### Patch Changes

- [#227](https://github.com/Lykhoyda/ask-llm/pull/227) [`a3c3ba3`](https://github.com/Lykhoyda/ask-llm/commit/a3c3ba38fc1643059f4d5a75208b99e580ae9d4b) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a safe typed machine protocol for subscription-backed factory planning, review, and verification.

## 0.1.2

### Patch Changes

- [#230](https://github.com/Lykhoyda/ask-llm/pull/230) [`394c305`](https://github.com/Lykhoyda/ask-llm/commit/394c305806607ca5db4803c666a0ebdc3304c2db) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Move every public MCP package into the canonical `@ask-llm` npm organization,
  while preserving the existing executable names for compatibility.

## 0.1.1

### Patch Changes

- [#224](https://github.com/Lykhoyda/ask-llm/pull/224) [`4717bd8`](https://github.com/Lykhoyda/ask-llm/commit/4717bd8cd9b30715deb8e1beaef0797f7623b242) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Publish the Claude provider under the `@anton-lykhoyda` npm scope because npm
  rejects the unscoped name as too similar to an existing package. The executable
  remains `@anton-lykhoyda/ask-claude-mcp`, and the unified server now imports the scoped package.

## 0.1.0

### Minor Changes

- [#222](https://github.com/Lykhoyda/ask-llm/pull/222) [`ae7780c`](https://github.com/Lykhoyda/ask-llm/commit/ae7780c67327224eea760ade42b61df3d9a32b54) Thanks [@Lykhoyda](https://github.com/Lykhoyda)! - Add a first-class Claude Code CLI provider so Codex and other MCP clients can
  ask Claude for a read-only second opinion. The new `@anton-lykhoyda/ask-claude-mcp` package
  supports native sessions, Opus-to-Sonnet fallback, usage reporting, relative
  context directories, and a hard Read/Glob/Grep-only tool boundary. The unified
  orchestrator now auto-detects Claude and can include it in `ask-llm`,
  `multi-llm`, diagnostics, and the REPL.
