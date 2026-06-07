import { executeCommand, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";

const pingArgsSchema = z.object({
  message: z.string().optional().describe("A message to echo back to test the connection"),
});

export const pingTool: UnifiedTool = {
  name: "ping",
  description: "Test connectivity with the Antigravity MCP server and check whether agy is installed",
  zodSchema: pingArgsSchema,
  annotations: {
    title: "Ping",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  prompt: {
    description: "Verify the Antigravity MCP server is working and agy is reachable",
  },
  category: "simple",
  execute: async (args, onProgress) => {
    const message = (args.message as string) || "Pong from Antigravity MCP Server!";
    try {
      // 5s ceiling for a version probe — never inherit the 210s default; a hung
      // agy must not block ping for minutes (matches isCommandAvailable, #153 review).
      const version = await executeCommand("agy", ["--version"], onProgress, undefined, undefined, 5_000);
      return `${message} (agy detected: ${version.trim()})`;
    } catch {
      return `${message} (warning: agy not found on PATH — install Antigravity CLI and run \`agy\` once to log in)`;
    }
  },
};
