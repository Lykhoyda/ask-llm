import { type AskResponse, askResponseSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { ERROR_MESSAGES, FACTORY_DEFAULT_MODEL, MODELS, STATUS_MESSAGES } from "../constants.js";
import { executeGeminiCLI } from "../utils/geminiExecutor.js";

const askGeminiArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(100000)
    .describe(
      "The question, code review request, or analysis task to send to Gemini CLI. Use @ syntax to include files (e.g., '@largefile.js explain this')",
    ),
  model: z
    .string()
    .optional()
    .describe(
      `DO NOT set this parameter. The tool automatically uses ${MODELS.PRO} and falls back to ${MODELS.FLASH} on quota errors. Only set this if the user explicitly requests a specific model.`,
    ),
  sessionId: z
    .string()
    .optional()
    .describe(
      "Optional Gemini session ID to resume a prior conversation. Use the [Session ID: ...] value from a previous response to continue the same chat with full prior context.",
    ),
});

export const askGeminiTool: UnifiedTool = {
  name: "ask-gemini",
  description: `Send a prompt to Gemini CLI (defaults to ${FACTORY_DEFAULT_MODEL} with automatic Flash fallback on quota errors). Use for code review, second opinions, analysis, and AI-to-AI collaboration. Do not override the model parameter unless the user explicitly asks. Returns both human-readable text and a structured response (provider, model, sessionId, usage) via outputSchema.`,
  zodSchema: askGeminiArgsSchema,
  outputSchema: askResponseSchema,
  annotations: {
    title: "Ask Gemini",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: {
    description: "Execute Gemini CLI to get Google Gemini's response for code review and analysis.",
  },
  category: "gemini",
  execute: async (args, onProgress, onUsage) => {
    const { prompt, model, sessionId } = args;
    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    const result = await executeGeminiCLI({
      prompt: prompt as string,
      model: model as string | undefined,
      sessionId: sessionId as string | undefined,
      onProgress,
    });

    if (result.usage) onUsage?.(result.usage);

    const sessionLine = result.sessionId ? `\n\n[Session ID: ${result.sessionId}]` : "";
    const text = `${STATUS_MESSAGES.GEMINI_RESPONSE}\n${result.response}${sessionLine}`;
    const structured: AskResponse = {
      provider: "gemini",
      response: result.response,
      model: result.usage?.model ?? (model as string | undefined) ?? MODELS.PRO,
      sessionId: result.sessionId,
      usage: result.usage,
    };
    return { text, structuredContent: structured as unknown as Record<string, unknown> };
  },
};
