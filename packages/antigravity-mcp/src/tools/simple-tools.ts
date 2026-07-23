import type { UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { assertSupportedAgyVersion } from "../utils/agyVersion.js";

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
  execute: async (args) => {
    const message = (args.message as string) || "Pong from Antigravity MCP Server!";
    try {
      const version = await assertSupportedAgyVersion();
      return `${message} (agy detected: ${version})`;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `${message} (warning: ${detail})`;
    }
  },
};
