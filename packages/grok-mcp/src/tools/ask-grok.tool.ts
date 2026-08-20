import { type AskResponse, askResponseSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import {
  ERROR_MESSAGES,
  FACTORY_DEFAULT_HARNESS,
  FACTORY_DEFAULT_MODEL,
  FACTORY_DEFAULT_REASONING_EFFORT,
  GROK_CLI_FACTORY_DEFAULT_MODEL,
  GROK_HARNESSES,
  MODELS,
  REASONING_EFFORTS,
  STATUS_MESSAGES,
} from "../constants.js";
import { executeGrok } from "../utils/grokRouter.js";

const askGrokArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(100000)
    .describe("The question, code review request, or analysis task to send to Grok through the selected harness"),
  model: z
    .string()
    .optional()
    .describe(
      `Exact model ID understood by the selected harness. Do not set unless the user explicitly requests one. Defaults to ${MODELS.DEFAULT} on xai-api or ${GROK_CLI_FACTORY_DEFAULT_MODEL} on grok-cli; Ask LLM never rewrites or falls back from the requested model.`,
    ),
  harness: z
    .enum(GROK_HARNESSES)
    .optional()
    .describe(
      `Execution harness, kept separate from the Grok model selection: xai-api or grok-cli. Defaults to ${FACTORY_DEFAULT_HARNESS}; no harness fallback is attempted.`,
    ),
  reasoningEffort: z
    .enum(REASONING_EFFORTS)
    .optional()
    .describe(
      `Reasoning depth: ${REASONING_EFFORTS.join(", ")}. Defaults to ${FACTORY_DEFAULT_REASONING_EFFORT}; this is a request parameter, not a model-name suffix.`,
    ),
});

export const askGrokTool: UnifiedTool = {
  name: "ask-grok",
  description: `Send a prompt to Grok through either the supported xAI Responses API or Grok Build's headless CLI (default harness: ${FACTORY_DEFAULT_HARNESS}; default API model: ${FACTORY_DEFAULT_MODEL}; CLI default: ${GROK_CLI_FACTORY_DEFAULT_MODEL}; reasoning effort: ${FACTORY_DEFAULT_REASONING_EFFORT}). Requires XAI_API_KEY and can incur xAI API charges. Ask LLM never enables billing, priority processing, credits, overage, model substitution, or fallback. Returns the actual provider/model and usage through the standard structured AskResponse.`,
  zodSchema: askGrokArgsSchema,
  outputSchema: askResponseSchema,
  annotations: {
    title: "Ask Grok",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: {
    description: "Execute a Grok consultation through the explicitly selected API or CLI harness.",
  },
  category: "grok",
  execute: async (args, onProgress, onUsage, signal) => {
    const { prompt, model, harness, reasoningEffort } = args;
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    const selectedHarness = GROK_HARNESSES.find((value) => value === harness);
    const selectedEffort = REASONING_EFFORTS.find((value) => value === reasoningEffort);

    const result = await executeGrok({
      prompt,
      model: typeof model === "string" ? model : undefined,
      harness: selectedHarness,
      reasoningEffort: selectedEffort,
      onProgress,
      signal,
    });
    if (result.usage) onUsage?.(result.usage);

    const text = `${STATUS_MESSAGES.GROK_RESPONSE}\n${result.response}`;
    const structured: AskResponse = {
      provider: "grok",
      response: result.response,
      model: result.model,
      usage: result.usage,
      harness: result.harness,
    };
    const structuredContent: Record<string, unknown> = { ...structured };
    return { text, structuredContent };
  },
};
