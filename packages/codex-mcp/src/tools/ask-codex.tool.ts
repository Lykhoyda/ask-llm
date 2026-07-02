import { type AskResponse, askResponseSchema, relativeDirSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { ERROR_MESSAGES, FACTORY_DEFAULT_MODEL, MODELS, STATUS_MESSAGES } from "../constants.js";
import { executeCodexCLI } from "../utils/codexExecutor.js";

const askCodexArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(100000)
    .describe("The question, code review request, or analysis task to send to Codex CLI"),
  model: z
    .string()
    .optional()
    .describe(
      `DO NOT set this parameter. The tool automatically uses ${MODELS.DEFAULT} and falls back to ${MODELS.FALLBACK} on quota errors. Only set this if the user explicitly requests a specific model.`,
    ),
  sessionId: z
    .string()
    .optional()
    .describe(
      "Optional Codex thread ID to resume a prior conversation. Use the [Thread ID: ...] value from a previous response to continue the same chat with full prior context.",
    ),
  includeDirs: z
    .array(relativeDirSchema)
    .optional()
    .describe(
      "Additional directories Codex may access alongside the working directory (maps to codex `--add-dir`, repeatable). Must be relative paths (e.g., 'packages/api'). Useful in monorepos where relevant context spans sibling packages.",
    ),
});

export const askCodexTool: UnifiedTool = {
  name: "ask-codex",
  description: `Send a prompt to OpenAI Codex CLI (defaults to ${FACTORY_DEFAULT_MODEL} with automatic fallback on quota errors). Use for code review, second opinions, analysis, and AI-to-AI collaboration. Do not override the model parameter unless the user explicitly asks. Returns both human-readable text and a structured response (provider, model, sessionId, usage) via outputSchema. The returned sessionId field maps to Codex's thread_id and can be passed back as sessionId to continue the conversation.`,
  zodSchema: askCodexArgsSchema,
  outputSchema: askResponseSchema,
  annotations: {
    title: "Ask Codex",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: {
    description: "Execute Codex CLI to get OpenAI Codex's response for code review and analysis.",
  },
  category: "codex",
  execute: async (args, onProgress, onUsage) => {
    const { prompt, model, sessionId, includeDirs } = args;
    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    const result = await executeCodexCLI({
      prompt: prompt as string,
      model: model as string | undefined,
      sessionId: sessionId as string | undefined,
      includeDirs: includeDirs as string[] | undefined,
      onProgress,
    });

    if (result.usage) onUsage?.(result.usage);

    const threadLine = result.threadId ? `\n\n[Thread ID: ${result.threadId}]` : "";
    const text = `${STATUS_MESSAGES.CODEX_RESPONSE}\n${result.response}${threadLine}`;
    const structured: AskResponse = {
      provider: "codex",
      response: result.response,
      model: result.usage?.model ?? (model as string | undefined) ?? MODELS.DEFAULT,
      sessionId: result.threadId,
      usage: result.usage,
    };
    return { text, structuredContent: structured as unknown as Record<string, unknown> };
  },
};
