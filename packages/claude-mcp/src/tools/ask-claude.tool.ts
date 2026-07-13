import { type AskResponse, askResponseSchema, relativeDirSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { ERROR_MESSAGES, FACTORY_DEFAULT_MODEL, MODELS, STATUS_MESSAGES } from "../constants.js";
import { executeClaudeCLI } from "../utils/claudeExecutor.js";

const askClaudeArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(100000)
    .describe("The question, code review request, or analysis task to send to Anthropic Claude Code CLI"),
  model: z
    .string()
    .optional()
    .describe(
      `Do not set this parameter unless the user explicitly requests a Claude model. Defaults to ${MODELS.DEFAULT}, with ${MODELS.FALLBACK} as the CLI fallback.`,
    ),
  sessionId: z
    .string()
    .optional()
    .describe(
      "Optional Claude conversation ID to resume. Pass the [Session ID: ...] value from a previous response to continue with native Claude session context.",
    ),
  includeDirs: z
    .array(relativeDirSchema)
    .optional()
    .describe(
      "Additional relative directories Claude may read alongside the working directory. Claude remains restricted to Read, Glob, and Grep tools.",
    ),
});

export const askClaudeTool: UnifiedTool = {
  name: "ask-claude",
  description: `Send a prompt to Anthropic Claude Code CLI for an independent second opinion, code review, or architecture critique. Defaults to ${FACTORY_DEFAULT_MODEL} with ${MODELS.FALLBACK} fallback. Claude runs in safe mode with only Read, Glob, and Grep tools, so it can inspect context but cannot edit files or execute commands. Supports native sessions via sessionId and returns a structured AskResponse.`,
  zodSchema: askClaudeArgsSchema,
  outputSchema: askResponseSchema,
  annotations: {
    title: "Ask Claude",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: {
    description: "Execute Claude Code CLI to get Anthropic Claude's independent analysis.",
  },
  category: "claude",
  execute: async (args, onProgress, onUsage) => {
    const { prompt, model, sessionId, includeDirs } = args;
    if (!prompt?.trim()) throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);

    const result = await executeClaudeCLI({
      prompt: prompt as string,
      model: model as string | undefined,
      sessionId: sessionId as string | undefined,
      includeDirs: includeDirs as string[] | undefined,
      onProgress,
    });
    onUsage?.(result.usage);

    const idLine = result.sessionId ? `\n\n[Session ID: ${result.sessionId}]` : "";
    const text = `${STATUS_MESSAGES.CLAUDE_RESPONSE}\n${result.response}${idLine}`;
    const structured: AskResponse = {
      provider: "claude",
      response: result.response,
      model: result.model,
      sessionId: result.sessionId,
      usage: result.usage,
    };
    return { text, structuredContent: structured as unknown as Record<string, unknown> };
  },
};
