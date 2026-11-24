import { askResponseSchema, formatCodexSelection, relativeDirSchema, type UnifiedTool } from "@ask-llm/shared";
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
import { compileOutputSchema, describeOutputSchemaRejection, validateOutput } from "../utils/codexOutput.js";

const outputSchemaArgument = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "A strict JSON Schema for the Codex reply. Set additionalProperties to false and list every property in required for each object. Bypasses the response cache. Set noFallback to make one model attempt.",
  );

const askCodexResponseSchema = askResponseSchema.extend({
  structuredResult: z.json().optional().describe("The parsed reply, present when it satisfies the requested schema."),
  validationError: z.string().optional().describe("Why the raw reply could not be parsed or validated."),
});

export const askCodexArgsSchema = z.object({
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
  noFallback: z
    .boolean()
    .optional()
    .describe(
      "Make one read-only model attempt with the explicit model or normal default. Bypasses the preferred model, fallback and response cache when true.",
    ),
  outputSchema: outputSchemaArgument,
  sandbox: z
    .literal("read-only")
    .optional()
    .default("read-only")
    .describe("Read-only sandbox. For file creation, including image generation, use ask-codex-write instead."),
});

export const askCodexTool: UnifiedTool = {
  name: "ask-codex",
  description: `Send a prompt to OpenAI Codex CLI (defaults to ${FACTORY_DEFAULT_MODEL} with automatic fallback on quota errors). Use for code review, second opinions, analysis, and AI-to-AI collaboration. Do not override the model parameter unless the user explicitly asks. Returns human-readable text and a structured response with provider, model, sessionId, and usage. Supply outputSchema to request a validated JSON reply in structuredContent.structuredResult. If validation fails, structuredContent contains the raw response and validationError. Calls are ephemeral by default; pass sessionId: "" on the first call to persist its Codex thread_id, then pass the returned sessionId on follow-up calls to continue the conversation.`,
  zodSchema: askCodexArgsSchema,
  outputSchema: askCodexResponseSchema,
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
  execute: (args, onProgress, onUsage, signal) => executeCodexRequest(args, "read-only", onProgress, onUsage, signal),
};

export async function executeCodexRequest(
  args: Parameters<UnifiedTool["execute"]>[0],
  sandbox: "read-only" | "workspace-write",
  onProgress?: Parameters<UnifiedTool["execute"]>[1],
  onUsage?: Parameters<UnifiedTool["execute"]>[2],
  signal?: AbortSignal,
) {
  const { prompt, model, reasoningEffort, sessionId, includeDirs, preferred, noFallback } = args;
  if (!prompt?.trim()) {
    throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
  }

  const outputSchema = sandbox === "read-only" ? outputSchemaArgument.parse(args.outputSchema) : undefined;
  signal?.throwIfAborted();
  const validate = outputSchema && compileOutputSchema(outputSchema);
  const result = await executeCodexCLI({
    prompt: prompt as string,
    model: model as string | undefined,
    reasoningEffort: reasoningEffort as CodexReasoningEffort | undefined,
    sessionId: sessionId as string | undefined,
    includeDirs: includeDirs as string[] | undefined,
    preferred: preferred as boolean | undefined,
    ...(sandbox === "read-only" && noFallback === true && { singleAttempt: true, strictOutcome: true }),
    ...(outputSchema && { outputSchema, rawResponse: true, strictOutcome: true }),
    sandbox,
    onProgress,
    signal,
  }).catch((error: unknown) => {
    const message = outputSchema && describeOutputSchemaRejection(error);
    if (message) throw new Error(message, { cause: error });
    throw error;
  });

  if (result.usage) onUsage?.(result.usage);

  const threadLine = result.threadId ? `\n\n[Thread ID: ${result.threadId}]` : "";
  const attribution = result.attempt
    ? formatCodexSelection(result.attempt, result.usage?.fellBack)
    : STATUS_MESSAGES.CODEX_RESPONSE;
  const output = validate && validateOutput(validate, result.response);
  const validationLine = output?.validationError ? `\n\n${output.validationError}` : "";
  const text = `${attribution}\n${result.response}${threadLine}${validationLine}`;
  const structured = {
    provider: "codex",
    response: result.response,
    model: result.attempt?.model ?? result.usage?.model ?? (model as string | undefined) ?? MODELS.DEFAULT,
    ...(result.attempt && { reasoningEffort: result.attempt.reasoningEffort }),
    sessionId: result.threadId,
    usage: result.usage,
    ...output,
  } satisfies z.infer<typeof askCodexResponseSchema>;
  return { text, structuredContent: structured };
}
