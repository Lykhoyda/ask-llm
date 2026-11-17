import { createRequire } from "node:module";
import {
  createSessionUsage,
  createUsageStatsTool,
  Logger,
  SERVER_INSTRUCTIONS,
  registerSessionUsageResource,
  registerTools,
  serveMcpStdio,
} from "@ask-llm/shared";
import { McpServer } from "@modelcontextprotocol/server";
import { executeTool, getPromptMessage, toolRegistry } from "./tools/index.js";

function readPackageJson(): { name: string; version: string } {
  try {
    const require = createRequire(import.meta.url);
    return require("../package.json") as { name: string; version: string };
  } catch {
    return { name: "@ask-llm/ollama-mcp", version: "0.0.0" };
  }
}

const { name, version } = readPackageJson();

const PROGRESS_MESSAGES = (op: string) => [
  `${op} - Ollama is analyzing your request...`,
  `${op} - Processing locally...`,
  `${op} - Generating response...`,
  `${op} - Still working (local inference can take a moment)...`,
];

export function buildServer(): McpServer {
  const server = new McpServer({ name, version }, { instructions: SERVER_INSTRUCTIONS });
  const sessionUsage = createSessionUsage();
  const usageTool = createUsageStatsTool(sessionUsage);
  const tools = [...toolRegistry, usageTool];

  registerTools({
    server,
    tools,
    executeTool: (name, args, onProgress, onUsage, signal) =>
      name === usageTool.name
        ? usageTool.execute(args, onProgress, onUsage, signal)
        : executeTool(name, args, onProgress, onUsage, signal),
    getPromptMessage,
    progressMessages: PROGRESS_MESSAGES,
    sessionUsage,
  });
  registerSessionUsageResource(server, sessionUsage);
  return server;
}

export async function startServer() {
  Logger.debug("init @ask-llm/ollama-mcp");
  Logger.checkNodeVersion();
  serveMcpStdio(buildServer);
  Logger.debug("@ask-llm/ollama-mcp listening on stdio");
}
