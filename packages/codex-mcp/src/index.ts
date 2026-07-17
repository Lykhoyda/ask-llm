import { createRequire } from "node:module";
import {
  createSessionUsage,
  createUsageStatsTool,
  Logger,
  registerSessionUsageResource,
  registerTools,
} from "@ask-llm/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { executeTool, getPromptMessage, toolRegistry } from "./tools/index.js";

function readPackageJson(): { name: string; version: string } {
  try {
    const require = createRequire(import.meta.url);
    return require("../package.json") as { name: string; version: string };
  } catch {
    return { name: "@ask-llm/codex-mcp", version: "0.0.0" };
  }
}

const { name, version } = readPackageJson();

const PROGRESS_MESSAGES = (op: string) => [
  `${op} - Codex is analyzing your request...`,
  `${op} - Processing and generating insights...`,
  `${op} - Creating structured response for your review...`,
  `${op} - Large analysis in progress (this is normal for big requests)...`,
  `${op} - Still working... Codex takes time for quality results...`,
];

const server = new McpServer({ name, version });
const sessionUsage = createSessionUsage();
toolRegistry.push(createUsageStatsTool(sessionUsage));

registerTools({
  server,
  tools: toolRegistry,
  executeTool,
  getPromptMessage,
  progressMessages: PROGRESS_MESSAGES,
  sessionUsage,
});
registerSessionUsageResource(server, sessionUsage);

export async function startServer() {
  Logger.debug("init @ask-llm/codex-mcp");
  Logger.checkNodeVersion();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.debug("@ask-llm/codex-mcp listening on stdio");
}
