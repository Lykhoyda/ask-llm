# @ask-llm/claude-mcp

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
