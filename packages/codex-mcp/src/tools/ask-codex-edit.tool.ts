import { relativeDirSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { ERROR_MESSAGES, MODELS } from "../constants.js";
import { executeCodexCLI, processCodexEditOutput } from "../utils/codexExecutor.js";

const askCodexEditArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(100000)
    .describe(
      "Describe the code changes you want against existing files. Codex returns structured search/replace edit blocks (via --output-schema) that can be applied directly.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      `DO NOT set this parameter. The tool automatically uses ${MODELS.DEFAULT} and falls back to ${MODELS.FALLBACK} on quota errors.`,
    ),
  sessionId: z
    .string()
    .optional()
    .describe(
      "Optional Codex thread ID to resume a prior conversation. Use the [Thread ID: ...] value from a previous response to refine the same edit session.",
    ),
  includeDirs: z
    .array(relativeDirSchema)
    .optional()
    .describe(
      "Additional directories Codex may read alongside the working directory (maps to codex `--add-dir`). Must be relative paths (e.g., 'packages/api'). Useful in monorepos where relevant context spans sibling packages.",
    ),
});

export const askCodexEditTool: UnifiedTool = {
  name: "ask-codex-edit",
  description:
    "Send a code edit request to OpenAI Codex CLI and get structured search/replace edit blocks back (via codex --output-schema). Codex reads the existing files (read-only) and proposes precise, applyable changes for Claude to apply. Use this when you want Codex to suggest specific code modifications to existing files rather than just analysis. Mirrors ask-gemini-edit.",
  zodSchema: askCodexEditArgsSchema,
  annotations: {
    title: "Ask Codex (Edit Mode)",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: {
    description: "Execute Codex CLI with --output-schema to get structured edit suggestions for existing files.",
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
      editMode: true,
      onProgress,
    });

    if (result.usage) onUsage?.(result.usage);

    const threadLine = result.threadId ? `\n\n[Thread ID: ${result.threadId}]` : "";
    return `${processCodexEditOutput(result.response)}${threadLine}`;
  },
};
