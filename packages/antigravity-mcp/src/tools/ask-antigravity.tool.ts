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
  sessionId: z
    .string()
    .optional()
    .describe(
      "Prior Antigravity conversation ID to resume. Omit or pass an empty string to start fresh; reuse the returned sessionId on follow-ups.",
    ),
  includeDirs: z
    .array(relativeDirSchema)
    .optional()
    .describe(
      "Additional directories agy may access alongside the working directory (maps to agy `--add-dir`, repeatable). Must be relative paths (e.g., 'packages/api'). Useful in monorepos where relevant context spans sibling packages. Execution requires ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1; read-only isolation is not guaranteed.",
    ),
});

export const askAntigravityTool: UnifiedTool = {
  name: "ask-antigravity",
  description: `Consult Google's Antigravity CLI (agy) for a second opinion, code review, or analysis. For the unified tool, use ask-llm with provider "antigravity". Google does not support third-party headless use on consumer plans and describes third-party access as a terms violation. Requires agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION} signed in to the intended Google account and explicit local opt-in via ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1. Opted-in runs have no read-only guarantee. Confirm the account and its credit controls before the first Antigravity call. See https://lykhoyda.github.io/ask-llm/providers/antigravity. Ask LLM submits gemini-4-neon at high effort by default and gemini-4-hydrogen on a rate limit. Configure model and effort via ASK_ANTIGRAVITY_MODEL and ASK_ANTIGRAVITY_EFFORT. The response labels the submitted slug, or agy default after a model-less recovery. Backend model identity is unverified. Reuse the returned sessionId for follow-ups. Returns text and a structured response.`,
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
  execute: async (args, onProgress, onUsage, signal) => {
    const { prompt, includeDirs, sessionId } = args;
    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }
    const result = await executeAntigravityCLI({
      prompt: prompt as string,
      includeDirs: includeDirs as string[] | undefined,
      sessionId: sessionId as string | undefined,
      onProgress,
      signal,
    });
    if (result.usage) onUsage?.(result.usage);
    const idLine = result.sessionId ? `\n\n[Session ID: ${result.sessionId}]` : "";
    const text = `${STATUS_MESSAGES.ANTIGRAVITY_RESPONSE}\n${result.response}${idLine}`;
    const structured: AskResponse = {
      provider: "antigravity",
      response: result.response,
      model: result.model,
      sessionId: result.sessionId,
      usage: result.usage,
    };
    return { text, structuredContent: structured as unknown as Record<string, unknown> };
  },
};
