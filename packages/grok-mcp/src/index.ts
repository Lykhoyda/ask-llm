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
    return { name: "@ask-llm/grok-mcp", version: "0.0.0" };
  }
}

const { name, version } = readPackageJson();
const PROGRESS_MESSAGES = (operation: string) => [
  `${operation} - Grok is reasoning through your request...`,
  `${operation} - Waiting for the xAI Responses API...`,
  `${operation} - Long-running Grok reasoning is still in progress...`,
  `${operation} - Still working within the configured timeout...`,
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

export async function startServer(): Promise<void> {
  Logger.debug("init @ask-llm/grok-mcp");
  Logger.checkNodeVersion();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.debug("@ask-llm/grok-mcp listening on stdio");
}
