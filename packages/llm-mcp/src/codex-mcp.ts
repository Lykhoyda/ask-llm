#!/usr/bin/env node

// The Codex-only MCP server (tools `ask-codex`, `ask-codex-edit`, `ping`, usage stats) that the
// Claude Code plugin registers as `codex`, shipped inside this package so the plugin can pin it to
// its own release. Tool names and schemas are those of `@ask-llm/codex-mcp`.

import { Logger } from "@ask-llm/shared";
import { startServer } from "@ask-llm/codex-mcp";

startServer().catch((error) => {
  Logger.error("Fatal error:", error);
  process.exit(1);
});
