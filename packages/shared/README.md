# @ask-llm/shared

Internal shared library for the [Ask LLM](https://github.com/Lykhoyda/ask-llm) monorepo. Not published to npm.

## What's Inside

| Module | Description |
|--------|-------------|
| `registry.ts` | `UnifiedTool` interface, `toolRegistry`, `executeTool()`, `getPromptMessage()` |
| `progressTracker.ts` | `ProgressHandle` interface, `createProgressTracker()` — shared by all 4 MCP servers |
| `logger.ts` | Logger class with level filtering via `GMCPT_LOG_LEVEL` env var |
| `commandExecutor.ts` | Child process wrapper with timeout and progress callbacks |
| `constants.ts` | `PROTOCOL`, `EXECUTION`, `LOG_PREFIX`, `BaseToolArguments` interface |
| `responseCache.ts` | In-memory LRU response cache (30min TTL, 10MB max) |
| `changeMode/` | Parser, chunker, translator for Gemini's structured edit format |
| `chunkCache.ts` | File-based cache at `/tmp/gemini-mcp-chunks/` (10min TTL, 50 file max) |

## Usage

Referenced by all packages via `workspace:*`:

```typescript
import { createProgressTracker, Logger, PROTOCOL } from "@ask-llm/shared";
import type { BaseToolArguments, ProgressHandle, UnifiedTool } from "@ask-llm/shared";
```

## License

MIT
