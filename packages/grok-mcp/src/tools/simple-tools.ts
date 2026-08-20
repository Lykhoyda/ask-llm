import type { UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { FACTORY_DEFAULT_MODEL, GROK_HARNESSES, XAI_API_KEY_ENV } from "../constants.js";
import { listGrokModels } from "../utils/grokRouter.js";

const pingArgsSchema = z.object({
  message: z.string().optional().describe("A message to echo back without contacting a provider"),
  harness: z.enum(GROK_HARNESSES).optional().describe("Harness whose exact model catalog should be listed"),
});

export const pingTool: UnifiedTool = {
  name: "ping",
  description:
    "Verify Grok MCP configuration and list exact model IDs available to the configured xAI API key. Model discovery does not make a billed inference call.",
  zodSchema: pingArgsSchema,
  annotations: {
    title: "Ping",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  prompt: {
    description: "Verify xAI credentials and discover available Grok model IDs without running inference",
  },
  category: "simple",
  execute: async (args, _onProgress, _onUsage, signal) => {
    if (typeof args.message === "string" && args.message) return args.message;
    const selectedHarness = GROK_HARNESSES.find((value) => value === args.harness);
    const models = await listGrokModels(selectedHarness, signal);
    const defaultStatus = models.includes(FACTORY_DEFAULT_MODEL) ? "available" : "not listed for this API team";
    return `Pong from Grok MCP Server! Selected harness is configured (${XAI_API_KEY_ENV} is used only by xai-api). Factory default ${FACTORY_DEFAULT_MODEL}: ${defaultStatus}. Available model IDs: ${models.join(", ") || "none"}.`;
  },
};
