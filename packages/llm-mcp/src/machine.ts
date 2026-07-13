import { createHash } from "node:crypto";
import {
  brainstormPayloadSchema,
  classifyProviderFailure,
  type MachineFallback,
  type MachineProvider,
  type MachineRequest,
  type MachineResult,
  machineFailureResultSchema,
  machineRequestSchema,
  machineResultSchema,
  type NormalizedTokenUsage,
  type ProviderFailureKind,
  parseRolePayload,
  reviewPayloadSchema,
  type SessionLocator,
  verificationPayloadSchema,
} from "@ask-llm/shared";
import { z } from "zod";
import type { ExecutorFn } from "./index.js";

type ExecutorResult = Awaited<ReturnType<ExecutorFn>>;
type JsonSchema = Record<string, unknown>;

export interface MachineDeps {
  loadExecutor: (provider: MachineProvider) => ExecutorFn | undefined | Promise<ExecutorFn | undefined>;
  now: () => number;
}

export interface MachineJsonSchemaBundle {
  digest: string;
  failure: JsonSchema;
  request: JsonSchema;
  result: JsonSchema;
  rolePayloads: {
    brainstorm: JsonSchema;
    review: JsonSchema;
    verify: JsonSchema;
  };
}

const rolePayloadSchemas = {
  brainstorm: brainstormPayloadSchema,
  review: reviewPayloadSchema,
  verify: verificationPayloadSchema,
} as const;

const failureMessages: Record<ProviderFailureKind, string> = {
  rate_limited: "Provider rate limit or quota was reached",
  auth_failed: "Provider authentication failed",
  unavailable: "Provider execution failed",
  timeout: "Provider request timed out",
  schema_invalid: "Provider output did not match the role schema",
  tool_unavailable: "Provider tool is unavailable",
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function roleJsonSchema(role: MachineRequest["role"]): JsonSchema {
  return canonicalize(z.toJSONSchema(rolePayloadSchemas[role])) as JsonSchema;
}

export function buildRolePrompt(request: MachineRequest): string {
  return `${request.prompt}\n\nReturn only one JSON object matching this JSON Schema: ${JSON.stringify(roleJsonSchema(request.role))}`;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function actualModel(result: ExecutorResult | undefined): string | null {
  return nonEmptyString(result?.usage?.model) ?? nonEmptyString(result?.model);
}

function normalizeUsage(result: ExecutorResult | undefined): NormalizedTokenUsage | null {
  const inputTokens = result?.usage?.inputTokens;
  const outputTokens = result?.usage?.outputTokens;
  if (
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens) ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    inputTokens < 0 ||
    outputTokens < 0
  ) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function fallbackFor(request: MachineRequest, result: ExecutorResult | undefined): MachineFallback {
  const requestedModel = nonEmptyString(request.model);
  const resolvedModel = actualModel(result);
  if (requestedModel !== null && resolvedModel !== null) {
    if (requestedModel !== resolvedModel || result?.usage?.fellBack === true) {
      return { occurred: true, requestedModel, actualModel: resolvedModel };
    }
    return { occurred: false, requestedModel, actualModel: resolvedModel };
  }
  if (requestedModel === null && resolvedModel !== null) {
    return { occurred: false, requestedModel: resolvedModel, actualModel: resolvedModel };
  }
  return { occurred: false, requestedModel: null, actualModel: null };
}

function sessionFor(request: MachineRequest, result: ExecutorResult | undefined): SessionLocator | null {
  const sessionId =
    request.provider === "codex"
      ? nonEmptyString(result?.threadId)
      : request.provider === "claude"
        ? nonEmptyString(result?.sessionId)
        : null;
  const transcriptPath = request.provider === "antigravity" ? nonEmptyString(result?.transcriptPath) : null;
  return sessionId === null && transcriptPath === null ? null : { sessionId, transcriptPath };
}

function durationMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function resultEnvelope(
  request: MachineRequest,
  result: ExecutorResult | undefined,
  elapsedMs: number,
  rawResponseSha256: string | null,
) {
  return {
    schemaVersion: 1 as const,
    requestId: request.requestId,
    provider: request.provider,
    actualModel: actualModel(result),
    rawResponseSha256,
    durationMs: durationMs(elapsedMs),
    usage: normalizeUsage(result),
    fallback: fallbackFor(request, result),
    session: sessionFor(request, result),
    quotaSignal: { kind: "runtime_proxy_required" as const },
  };
}

function failureResult(
  request: MachineRequest,
  kind: ProviderFailureKind,
  elapsedMs: number,
  result?: ExecutorResult,
  rawResponseSha256: string | null = null,
  message = failureMessages[kind],
): MachineResult {
  return machineResultSchema.parse({
    ...resultEnvelope(request, result, elapsedMs, rawResponseSha256),
    status: "failed",
    role: request.role,
    payload: null,
    failure: { kind, message },
  });
}

function successResult(request: MachineRequest, result: ExecutorResult, elapsedMs: number): MachineResult {
  const rawResponse = typeof result.response === "string" ? result.response : "";
  const rawResponseSha256 = createHash("sha256").update(rawResponse).digest("hex");
  const parsed = parseRolePayload(request.role, rawResponse);
  if (!parsed.ok) {
    return failureResult(request, "schema_invalid", elapsedMs, result, rawResponseSha256, parsed.failure.message);
  }
  return machineResultSchema.parse({
    ...resultEnvelope(request, result, elapsedMs, rawResponseSha256),
    status: "success",
    role: request.role,
    payload: parsed.payload,
    failure: null,
  });
}

export async function runMachineRequest(input: unknown, deps: MachineDeps): Promise<MachineResult> {
  const request = machineRequestSchema.parse(input);
  const executor = await deps.loadExecutor(request.provider);
  if (!executor) return failureResult(request, "tool_unavailable", 0);

  const started = deps.now();
  try {
    const result = await executor({
      prompt: buildRolePrompt(request),
      model: request.model,
      includeDirs: request.includeDirs,
      sandbox: "read-only",
      readOnly: true,
      outputSchema: roleJsonSchema(request.role),
    });
    return successResult(request, result, deps.now() - started);
  } catch (error) {
    return failureResult(request, classifyProviderFailure(error), deps.now() - started);
  }
}

export function machineJsonSchemaBundle(): MachineJsonSchemaBundle {
  const schemas = canonicalize({
    failure: z.toJSONSchema(machineFailureResultSchema),
    request: z.toJSONSchema(machineRequestSchema),
    result: z.toJSONSchema(machineResultSchema),
    rolePayloads: {
      brainstorm: z.toJSONSchema(brainstormPayloadSchema),
      review: z.toJSONSchema(reviewPayloadSchema),
      verify: z.toJSONSchema(verificationPayloadSchema),
    },
  }) as Omit<MachineJsonSchemaBundle, "digest">;
  const digest = createHash("sha256").update(JSON.stringify(schemas)).digest("hex");
  return canonicalize({ ...schemas, digest }) as MachineJsonSchemaBundle;
}
