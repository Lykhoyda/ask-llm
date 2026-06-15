import type { UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { listModels } from "../utils/ollamaExecutor.js";

const pingArgsSchema = z.object({
  message: z.string().optional().describe("A message to echo back to test the connection"),
});

export const pingTool: UnifiedTool = {
  name: "ping",
  description: "Test connectivity with the Ollama MCP server and list locally available models",
  zodSchema: pingArgsSchema,
  annotations: {
    title: "Ping",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  prompt: {
    description: "Echo test message to verify MCP server is working and list available Ollama models",
  },
  category: "simple",
  execute: async (args) => {
    const message = args.message;
    if (message) return message as string;

    const models = await listModels();
    const modelList = models.length > 0 ? models.join(", ") : "none (run: ollama pull qwen3.6:27b)";
    return `Pong from Ollama MCP Server! Available models: ${modelList}`;
  },
};
