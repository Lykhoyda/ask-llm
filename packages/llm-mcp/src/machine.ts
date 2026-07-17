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
import { PROVIDERS } from "./constants.js";
import type { ExecutorFn } from "./index.js";

type ExecutorResult = Awaited<ReturnType<ExecutorFn>>;
type JsonSchema = Record<string, unknown>;

export interface MachineDeps {
  loadExecutor: (provider: MachineProvider) => ExecutorFn | undefined | Promise<ExecutorFn | undefined>;
  now: () => number;
  env?: Readonly<Record<string, string | undefined>>;
}

export type MachineSchemaTarget = "request" | "result" | "failure";

export interface MachineSchemaRefinement {
  id: string;
  targets: MachineSchemaTarget[];
  when?: {
    pointer: string;
    equals: string | number | boolean | null;
  };
  assertion: {
    leftPointer: string;
    operator: "equals" | "notEquals";
    rightPointer: string;
  };
  message: string;
}

export interface MachineSchemaRefinementSet {
  version: 1;
  rules: MachineSchemaRefinement[];
}

export interface MachineSchemaRefinementViolation {
  id: string;
  message: string;
}

export interface MachineJsonSchemaBundle {
  digest: string;
  failure: JsonSchema;
  request: JsonSchema;
  refinements: MachineSchemaRefinementSet;
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

const machineSchemaRefinements: MachineSchemaRefinementSet = {
  version: 1,
  rules: [
    {
      id: "review-provider-differs-from-writer",
      targets: ["request"],
      when: { pointer: "/role", equals: "review" },
      assertion: {
        leftPointer: "/provider",
        operator: "notEquals",
        rightPointer: "/writerProvider",
      },
      message: "review provider must differ from writer",
    },
    {
      id: "non-fallback-models-match",
      targets: ["failure", "result"],
      when: { pointer: "/fallback/occurred", equals: false },
      assertion: {
        leftPointer: "/fallback/requestedModel",
        operator: "equals",
        rightPointer: "/fallback/actualModel",
      },
      message: "requested and actual models must match when fallback did not occur",
    },
    {
      id: "envelope-and-fallback-models-match",
      targets: ["failure", "result"],
      assertion: {
        leftPointer: "/actualModel",
        operator: "equals",
        rightPointer: "/fallback/actualModel",
      },
      message: "result and fallback actual models must match",
    },
  ],
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

function jsonPointerValue(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  if (!pointer.startsWith("/")) return undefined;

  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((value, segment) => {
      if (value === null || typeof value !== "object") return undefined;
      return (value as Record<string, unknown>)[segment];
    }, document);
}

export function validateMachineSchemaRefinements(
  target: MachineSchemaTarget,
  document: unknown,
  refinements: MachineSchemaRefinementSet,
): MachineSchemaRefinementViolation[] {
  const violations: MachineSchemaRefinementViolation[] = [];

  for (const rule of refinements.rules) {
    if (!rule.targets.includes(target)) continue;
    if (rule.when && !Object.is(jsonPointerValue(document, rule.when.pointer), rule.when.equals)) continue;

    const left = jsonPointerValue(document, rule.assertion.leftPointer);
    const right = jsonPointerValue(document, rule.assertion.rightPointer);
    const equal = Object.is(left, right);
    const accepted = rule.assertion.operator === "equals" ? equal : !equal;
    if (!accepted) violations.push({ id: rule.id, message: rule.message });
  }

  return violations;
}

function roleJsonSchema(role: MachineRequest["role"]): JsonSchema {
  return canonicalize(z.toJSONSchema(rolePayloadSchemas[role])) as JsonSchema;
}

export function buildRolePrompt(request: MachineRequest): string {
  return `${request.prompt}\n\nReturn only one JSON object matching this JSON Schema: ${JSON.stringify(roleJsonSchema(request.role))}`;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
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

function resolveEffectiveModel(request: MachineRequest, env: Readonly<Record<string, string | undefined>>): string {
  const provider = PROVIDERS[request.provider];
  const configuredModel = provider?.modelEnvVar ? env[provider.modelEnvVar] : undefined;
  return nonEmptyString(request.model) ?? nonEmptyString(configuredModel) ?? provider.defaultModel;
}

function fallbackFor(
  request: MachineRequest,
  result: ExecutorResult | undefined,
  effectiveRequestedModel: string,
): MachineFallback {
  const resolvedModel = actualModel(result);
  if (resolvedModel === null) return { occurred: false, requestedModel: null, actualModel: null };

  if (request.provider === "antigravity") {
    if (effectiveRequestedModel !== resolvedModel) {
      return { occurred: true, requestedModel: effectiveRequestedModel, actualModel: resolvedModel };
    }
    return { occurred: false, requestedModel: resolvedModel, actualModel: resolvedModel };
  }

  if (result?.usage?.fellBack === true) {
    return { occurred: true, requestedModel: effectiveRequestedModel, actualModel: resolvedModel };
  }
  return { occurred: false, requestedModel: resolvedModel, actualModel: resolvedModel };
}

function sessionFor(request: MachineRequest, result: ExecutorResult | undefined): SessionLocator | null {
  const sessionId =
    request.provider === "codex"
      ? nonEmptyString(result?.threadId)
      : request.provider === "claude"
        ? nonEmptyString(result?.sessionId)
        : null;
  const transcriptPath = request.provider === "antigravity" ? nonEmptyString(result?.transcriptPath) : null;
  if (sessionId !== null) return { sessionId, transcriptPath };
  if (transcriptPath !== null) return { sessionId, transcriptPath };
  return null;
}

function durationMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function resultEnvelope(
  request: MachineRequest,
  result: ExecutorResult | undefined,
  elapsedMs: number,
  rawResponseSha256: string | null,
  effectiveRequestedModel: string,
) {
  return {
    schemaVersion: 1 as const,
    requestId: request.requestId,
    provider: request.provider,
    actualModel: actualModel(result),
    rawResponseSha256,
    durationMs: durationMs(elapsedMs),
    usage: normalizeUsage(result),
    fallback: fallbackFor(request, result, effectiveRequestedModel),
    session: sessionFor(request, result),
    quotaSignal: { kind: "runtime_proxy_required" as const },
  };
}

function failureResult(
  request: MachineRequest,
  kind: ProviderFailureKind,
  elapsedMs: number,
  effectiveRequestedModel: string,
  result?: ExecutorResult,
  rawResponseSha256: string | null = null,
  message = failureMessages[kind],
): MachineResult {
  return machineResultSchema.parse({
    ...resultEnvelope(request, result, elapsedMs, rawResponseSha256, effectiveRequestedModel),
    status: "failed",
    role: request.role,
    payload: null,
    failure: { kind, message },
  });
}

function successResult(
  request: MachineRequest,
  result: ExecutorResult,
  elapsedMs: number,
  effectiveRequestedModel: string,
): MachineResult {
  const rawResponse = typeof result.response === "string" ? result.response : "";
  const rawResponseSha256 = createHash("sha256").update(rawResponse).digest("hex");
  const parsed = parseRolePayload(request.role, rawResponse);
  if (!parsed.ok) {
    return failureResult(
      request,
      "schema_invalid",
      elapsedMs,
      effectiveRequestedModel,
      result,
      rawResponseSha256,
      parsed.failure.message,
    );
  }
  return machineResultSchema.parse({
    ...resultEnvelope(request, result, elapsedMs, rawResponseSha256, effectiveRequestedModel),
    status: "success",
    role: request.role,
    payload: parsed.payload,
    failure: null,
  });
}

export async function runMachineRequest(input: unknown, deps: MachineDeps): Promise<MachineResult> {
  const request = machineRequestSchema.parse(input);
  const effectiveRequestedModel = resolveEffectiveModel(request, deps.env ?? process.env);
  const executor = await deps.loadExecutor(request.provider);
  if (!executor) return failureResult(request, "tool_unavailable", 0, effectiveRequestedModel);

  const started = deps.now();
  try {
    const result = await executor({
      prompt: buildRolePrompt(request),
      model: effectiveRequestedModel,
      includeDirs: request.includeDirs,
      sandbox: "read-only",
      readOnly: true,
      outputSchema: roleJsonSchema(request.role),
    });
    return successResult(request, result, deps.now() - started, effectiveRequestedModel);
  } catch (error) {
    return failureResult(request, classifyProviderFailure(error), deps.now() - started, effectiveRequestedModel);
  }
}

export function machineJsonSchemaBundle(): MachineJsonSchemaBundle {
  const schemas = canonicalize({
    failure: z.toJSONSchema(machineFailureResultSchema),
    request: z.toJSONSchema(machineRequestSchema, { io: "input" }),
    refinements: machineSchemaRefinements,
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
