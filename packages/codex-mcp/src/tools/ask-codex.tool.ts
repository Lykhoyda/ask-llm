import { type AskResponse, askResponseSchema, relativeDirSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import {
  CODEX_REASONING_EFFORTS,
  type CodexReasoningEffort,
  ERROR_MESSAGES,
  FACTORY_DEFAULT_MODEL,
  FACTORY_DEFAULT_REASONING_EFFORT,
  MODELS,
  STATUS_MESSAGES,
} from "../constants.js";
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
  reasoningEffort: z
    .enum(CODEX_REASONING_EFFORTS)
    .optional()
    .describe(
      `Codex reasoning effort for this call. Defaults to ${FACTORY_DEFAULT_REASONING_EFFORT}; /codex-review and /brainstorm use high for quality-first work.`,
    ),
  sessionId: z
    .string()
    .optional()
    .describe(
      'Omit for an ephemeral one-off call. Pass an empty string ("") on the first call to create a persisted resumable thread; then pass the returned [Thread ID: ...] value on follow-up calls to continue with full prior context.',
    ),
  includeDirs: z
    .array(relativeDirSchema)
    .optional()
    .describe(
      "Additional directories Codex may access alongside the working directory on a fresh call (maps to codex `--add-dir`, repeatable). Rejected together with a resumed sessionId because `codex exec resume` has no --add-dir; directories are never silently dropped. Must be relative paths (e.g., 'packages/api'). Useful in monorepos where relevant context spans sibling packages.",
    ),
  preferred: z
    .boolean()
    .optional()
    .describe(
      `Opt into ASK_CODEX_PREFERRED_MODEL when it is configured to differ from the ${MODELS.DEFAULT} default. The built-in preferred value is also ${MODELS.PREFERRED}, so normal calls and review skills should leave this unset.`,
    ),
  sandbox: z
    .enum(["read-only", "workspace-write"])
    .optional()
    .default("read-only")
    .describe(
      "Codex sandbox mode for this call. Defaults to 'read-only', which enforces the core review contract (Codex reads and proposes, the MCP client edits). Set 'workspace-write' ONLY as an explicit opt-out for flows that need Codex to write files itself, e.g. image generation. Review, second-opinion, and analysis flows must never set this.",
    ),
});

export const askCodexTool: UnifiedTool = {
  name: "ask-codex",
  description: `Send a prompt to OpenAI Codex CLI (defaults to ${FACTORY_DEFAULT_MODEL} with automatic fallback on quota errors). Use for code review, second opinions, analysis, and AI-to-AI collaboration. Do not override the model parameter unless the user explicitly asks. Returns both human-readable text and a structured response (provider, model, sessionId, usage) via outputSchema. Calls are ephemeral by default; pass sessionId: "" on the first call to persist its Codex thread_id, then pass the returned sessionId on follow-up calls to continue the conversation.`,
  zodSchema: askCodexArgsSchema,
  outputSchema: askResponseSchema,
  annotations: {
    title: "Ask Codex",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: {
    description: "Execute Codex CLI to get OpenAI Codex's response for code review and analysis.",
  },
  category: "codex",
  execute: async (args, onProgress, onUsage, signal) => {
    const { prompt, model, reasoningEffort, sessionId, includeDirs, preferred, sandbox } = args;
    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }

    const result = await executeCodexCLI({
      prompt: prompt as string,
      model: model as string | undefined,
      reasoningEffort: reasoningEffort as CodexReasoningEffort | undefined,
      sessionId: sessionId as string | undefined,
      includeDirs: includeDirs as string[] | undefined,
      preferred: preferred as boolean | undefined,
      sandbox: sandbox as "read-only" | "workspace-write" | undefined,
      onProgress,
      signal,
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
