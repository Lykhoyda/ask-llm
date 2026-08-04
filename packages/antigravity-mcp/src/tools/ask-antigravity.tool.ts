import { type AskResponse, askResponseSchema, relativeDirSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { ANTIGRAVITY, ERROR_MESSAGES, STATUS_MESSAGES } from "../constants.js";
import { executeAntigravityCLI } from "../utils/antigravityExecutor.js";

const askAntigravityArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(100000)
    .describe("The question, code review request, or analysis task to send to Antigravity (agy)"),
  includeDirs: z
    .array(relativeDirSchema)
    .optional()
    .describe(
      "Additional directories agy may access alongside the working directory (maps to agy `--add-dir`, repeatable). Must be relative paths (e.g., 'packages/api'). Useful in monorepos where relevant context spans sibling packages. agy runs with --dangerously-skip-permissions, so only pass directories you intend the model to read.",
    ),
});

export const askAntigravityTool: UnifiedTool = {
  name: "ask-antigravity",
  description: `Send a prompt to Google's Antigravity CLI (agy) for a subscription-backed second opinion, code review, or analysis. Requires agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION}, installed and logged in once; unsupported versions fail before model invocation. Defaults to the gemini-3.1-pro model at high reasoning effort, falling back to gemini-3.5-flash on a rate limit (override via the ASK_ANTIGRAVITY_MODEL / ASK_ANTIGRAVITY_EFFORT env vars; run \`agy models\` for options); single-turn only (no multi-turn). Returns human-readable text plus a structured response.`,
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
  execute: async (args, onProgress, onUsage) => {
    const { prompt, includeDirs } = args;
    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }
    const result = await executeAntigravityCLI({
      prompt: prompt as string,
      includeDirs: includeDirs as string[] | undefined,
      onProgress,
    });
    if (result.usage) onUsage?.(result.usage);
    const text = `${STATUS_MESSAGES.ANTIGRAVITY_RESPONSE}\n${result.response}`;
    const structured: AskResponse = {
      provider: "antigravity",
      response: result.response,
      model: result.model,
      sessionId: undefined,
      usage: result.usage,
    };
    return { text, structuredContent: structured as unknown as Record<string, unknown> };
  },
};
