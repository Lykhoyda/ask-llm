import { type AskResponse, askResponseSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { ERROR_MESSAGES, STATUS_MESSAGES } from "../constants.js";
import { executeAntigravityCLI } from "../utils/antigravityExecutor.js";

const askAntigravityArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(100000)
    .describe("The question, code review request, or analysis task to send to Antigravity (agy)"),
  includeDirs: z
    .array(z.string())
    .optional()
    .describe(
      "Additional directories agy may access alongside the working directory (maps to agy `--add-dir`, repeatable). Useful in monorepos where relevant context spans sibling packages. Paths are forwarded to agy as-is and trusted (agy runs with --dangerously-skip-permissions), so only pass directories you intend the model to read.",
    ),
});

export const askAntigravityTool: UnifiedTool = {
  name: "ask-antigravity",
  description:
    "Send a prompt to Google's Antigravity CLI (agy) for a subscription-backed second opinion, code review, or analysis. EXPERIMENTAL: agy's headless mode does not print to stdout, so this reads agy's transcript files; one-shot only (no model selection, no multi-turn). Requires `agy` installed and logged in once. Returns human-readable text plus a structured response.",
  zodSchema: askAntigravityArgsSchema,
  outputSchema: askResponseSchema,
  annotations: {
    title: "Ask Antigravity (experimental)",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: {
    description: "Execute Antigravity CLI (agy) to get a second opinion for code review and analysis.",
  },
  category: "utility",
  execute: async (args, onProgress) => {
    const { prompt, includeDirs } = args;
    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }
    const result = await executeAntigravityCLI({
      prompt: prompt as string,
      includeDirs: includeDirs as string[] | undefined,
      onProgress,
    });
    const text = `${STATUS_MESSAGES.ANTIGRAVITY_RESPONSE}\n${result.response}`;
    const structured: AskResponse = {
      provider: "antigravity",
      response: result.response,
      model: "antigravity",
      sessionId: undefined,
      usage: undefined,
    };
    return { text, structuredContent: structured as unknown as Record<string, unknown> };
  },
};
