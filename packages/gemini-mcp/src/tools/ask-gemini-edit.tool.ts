import { relativeDirSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { ERROR_MESSAGES, MODELS } from "../constants.js";
import { executeGeminiCLI, processChangeModeOutput } from "../utils/geminiExecutor.js";

const askGeminiEditArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(100000)
    .describe(
      "Describe the code changes you want. Reference files with @ syntax (e.g., '@src/app.ts refactor the error handling'). Gemini will return structured OLD/NEW edit blocks that can be applied directly.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      `DO NOT set this parameter. The tool automatically uses ${MODELS.PRO} and falls back to ${MODELS.FLASH} on quota errors.`,
    ),
  includeDirs: z
    .array(relativeDirSchema)
    .optional()
    .describe(
      "Additional directories to include in Gemini's context. Must be relative paths (e.g., 'packages/api'). Useful for monorepos.",
    ),
});

export const askGeminiEditTool: UnifiedTool = {
  name: "ask-gemini-edit",
  description:
    "Send a code edit request to Gemini CLI and get structured OLD/NEW edit blocks back. Gemini analyzes the files and returns precise, applicable code changes. Use this when you want Gemini to suggest specific code modifications rather than just analysis.",
  zodSchema: askGeminiEditArgsSchema,
  annotations: {
    title: "Ask Gemini (Edit Mode)",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: {
    description: "Execute Gemini CLI in change mode to get structured edit suggestions.",
  },
  category: "gemini",
  execute: async (args, onProgress, onUsage) => {
    const { prompt, model, includeDirs } = args;
    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    const result = await executeGeminiCLI({
      prompt: prompt as string,
      model: model as string | undefined,
      changeMode: true,
      includeDirs: includeDirs as string[] | undefined,
      onProgress,
    });

    if (result.usage) onUsage?.(result.usage);

    const sessionLine = result.sessionId ? `\n\n[Session ID: ${result.sessionId}]` : "";
    const changeModeOutput = processChangeModeOutput(result.response, undefined, undefined, prompt as string);
    return `${changeModeOutput}${sessionLine}`;
  },
};
