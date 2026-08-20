import { z } from "zod";
import { relativeDirSchema } from "./pathValidation.js";
import { PROVIDERS } from "./providers.js";

export const providerFailureKindSchema = z.enum([
  "rate_limited",
  "auth_failed",
  "unavailable",
  "timeout",
  "schema_invalid",
  "tool_unavailable",
]);

export const machineRoleSchema = z.enum(["brainstorm", "review", "verify"]);
export const MACHINE_PROVIDERS = ["codex", "claude", "grok", "antigravity"] as const;
export const machineProviderSchema = z.enum(MACHINE_PROVIDERS);
export const actorProviderSchema = z.enum(PROVIDERS);

const requestIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/);
const nonBlankStringSchema = z.string().regex(/\S/, "Value must contain a non-whitespace character");
const machineRelativeDirSchema = relativeDirSchema
  .max(1024)
  .regex(/^(?!.*\.\.)(?!~)(?!\/)(?![A-Za-z]:[\\/])(?!\\).*$/, "Directory paths must be relative without '..' or '~'");

export const machineRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    requestId: requestIdSchema,
    role: machineRoleSchema,
    provider: machineProviderSchema,
    prompt: z.string().min(1).max(150_000),
    model: nonBlankStringSchema.max(256).optional(),
    readOnly: z.literal(true),
    writerProvider: actorProviderSchema.optional(),
    includeDirs: z.array(machineRelativeDirSchema).max(16).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.role === "review" && value.writerProvider === value.provider) {
      ctx.addIssue({ code: "custom", message: "review provider must differ from writer" });
    }
  });

export const reviewFindingSchema = z
  .object({
    id: z.string().min(1),
    severity: z.enum(["critical", "high", "medium", "low"]),
    confidence: z.number().int().min(0).max(100),
    title: z.string().min(1),
    evidence: z.string().min(1),
    recommendation: z.string().min(1),
    file: z.string().min(1).nullable(),
    line: z.number().int().positive().nullable(),
  })
  .strict();

export const reviewPayloadSchema = z
  .object({
    summary: z.string(),
    findings: z.array(reviewFindingSchema),
  })
  .strict();

export const brainstormPayloadSchema = z
  .object({
    recommendation: z.string().min(1),
    ideas: z
      .array(
        z
          .object({
            title: z.string().min(1),
            rationale: z.string().min(1),
            risks: z.array(z.string()),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const verificationPayloadSchema = z
  .object({
    verdict: z.enum(["verified", "partial", "failed"]),
    claims: z.array(
      z
        .object({
          claim: z.string().min(1),
          status: z.enum(["proven", "disproven", "unverifiable"]),
          evidence: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const normalizedTokenUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .strict();

export const fallbackSchema = z
  .discriminatedUnion("occurred", [
    z
      .object({
        occurred: z.literal(false),
        requestedModel: nonBlankStringSchema.nullable(),
        actualModel: nonBlankStringSchema.nullable(),
      })
      .strict(),
    z
      .object({
        occurred: z.literal(true),
        requestedModel: nonBlankStringSchema,
        actualModel: nonBlankStringSchema,
      })
      .strict(),
  ])
  .refine((value) => value.occurred || value.requestedModel === value.actualModel, {
    message: "requested and actual models must match when fallback did not occur",
    path: ["actualModel"],
  });

export const sessionLocatorSchema = z.union([
  z
    .object({
      sessionId: nonBlankStringSchema,
      transcriptPath: nonBlankStringSchema.nullable(),
    })
    .strict(),
  z
    .object({
      sessionId: nonBlankStringSchema.nullable(),
      transcriptPath: nonBlankStringSchema,
    })
    .strict(),
]);

export const quotaSignalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("reported"),
      usedPercent: z.number().min(0).max(100),
      windowHours: z.number().positive(),
    })
    .strict(),
  z.object({ kind: z.literal("runtime_proxy_required") }).strict(),
]);

export const normalizedProviderFailureSchema = z
  .object({
    kind: providerFailureKindSchema,
    message: z.string().min(1),
  })
  .strict();

const resultEnvelopeShape = {
  schemaVersion: z.literal(1),
  requestId: requestIdSchema,
  provider: machineProviderSchema,
  actualModel: nonBlankStringSchema.nullable(),
  rawResponseSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  durationMs: z.number().int().nonnegative(),
  usage: normalizedTokenUsageSchema.nullable(),
  fallback: fallbackSchema,
  session: sessionLocatorSchema.nullable(),
  quotaSignal: quotaSignalSchema,
};

const brainstormSuccessResultSchema = z
  .object({
    ...resultEnvelopeShape,
    status: z.literal("success"),
    role: z.literal("brainstorm"),
    payload: brainstormPayloadSchema,
    failure: z.null(),
  })
  .strict();

const reviewSuccessResultSchema = z
  .object({
    ...resultEnvelopeShape,
    status: z.literal("success"),
    role: z.literal("review"),
    payload: reviewPayloadSchema,
    failure: z.null(),
  })
  .strict();

const verificationSuccessResultSchema = z
  .object({
    ...resultEnvelopeShape,
    status: z.literal("success"),
    role: z.literal("verify"),
    payload: verificationPayloadSchema,
    failure: z.null(),
  })
  .strict();

export const machineSuccessResultSchema = z
  .discriminatedUnion("role", [
    brainstormSuccessResultSchema,
    reviewSuccessResultSchema,
    verificationSuccessResultSchema,
  ])
  .refine((value) => value.actualModel === value.fallback.actualModel, {
    message: "result and fallback actual models must match",
    path: ["fallback", "actualModel"],
  });

export const machineFailureResultSchema = z
  .object({
    ...resultEnvelopeShape,
    status: z.literal("failed"),
    role: machineRoleSchema,
    payload: z.null(),
    failure: normalizedProviderFailureSchema,
  })
  .strict()
  .refine((value) => value.actualModel === value.fallback.actualModel, {
    message: "result and fallback actual models must match",
    path: ["fallback", "actualModel"],
  });

export const machineResultSchema = z.discriminatedUnion("status", [
  machineSuccessResultSchema,
  machineFailureResultSchema,
]);

const rolePayloadSchemas = {
  brainstorm: brainstormPayloadSchema,
  review: reviewPayloadSchema,
  verify: verificationPayloadSchema,
} as const;

const AUTH_FAILURE_SIGNALS = [
  /\b401\b/,
  /\b403\b/,
  /auth(?:entication)? (?:failed|required)/,
  /unauthori[sz]ed/,
  /forbidden/,
  /invalid api key/,
  /not logged in/,
  /login required/,
];

const QUOTA_FAILURE_SIGNALS = [
  /\b429\b/,
  /usage limit/,
  /rate[_ -]?limit/,
  /quota/,
  /resource[_ -]?exhausted/,
  /exhausted (?:your )?capacity/,
  /out of credits/,
  /spend cap/,
  /too many requests/,
];

const TIMEOUT_FAILURE_SIGNALS = [/timed out/, /timeout/, /etimedout/, /deadline exceeded/];

const TOOL_FAILURE_SIGNALS = [
  /enoent/,
  /command not found/,
  /executable not found/,
  /no such file or directory/,
  /cannot find (?:the )?command/,
];

function matchesAny(message: string, signals: RegExp[]): boolean {
  return signals.some((signal) => signal.test(message));
}

export function classifyProviderFailure(error: unknown): ProviderFailureKind {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (matchesAny(message, AUTH_FAILURE_SIGNALS)) return "auth_failed";
  if (matchesAny(message, QUOTA_FAILURE_SIGNALS)) return "rate_limited";
  if (matchesAny(message, TIMEOUT_FAILURE_SIGNALS)) return "timeout";
  if (matchesAny(message, TOOL_FAILURE_SIGNALS)) return "tool_unavailable";
  return "unavailable";
}

function* extractJsonObjects(raw: string): Generator<string> {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];

    if (start === -1) {
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
      } else if (character === '"') {
        inString = true;
      } else if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        yield raw.slice(start, index + 1);
        start = -1;
      }
    }
  }
}

type RolePayloadByRole = {
  brainstorm: BrainstormPayload;
  review: ReviewPayload;
  verify: VerificationPayload;
};

export type ParsedRolePayload<Role extends MachineRole = MachineRole> =
  | { ok: true; payload: RolePayloadByRole[Role] }
  | { ok: false; failure: { kind: "schema_invalid"; message: string } };

export function parseRolePayload<Role extends MachineRole>(role: Role, raw: string): ParsedRolePayload<Role> {
  for (const jsonObject of extractJsonObjects(raw)) {
    try {
      const result = rolePayloadSchemas[role].safeParse(JSON.parse(jsonObject));
      if (result.success) {
        return { ok: true, payload: result.data as RolePayloadByRole[Role] };
      }
    } catch {
      // Continue looking for the provider's next complete object.
    }
  }

  return {
    ok: false,
    failure: {
      kind: "schema_invalid",
      message: `Provider output did not contain a valid ${role} payload`,
    },
  };
}

export type ProviderFailureKind = z.infer<typeof providerFailureKindSchema>;
export type MachineRole = z.infer<typeof machineRoleSchema>;
export type MachineProvider = z.infer<typeof machineProviderSchema>;
export type ActorProvider = z.infer<typeof actorProviderSchema>;
export type MachineRequest = z.infer<typeof machineRequestSchema>;
export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReviewPayload = z.infer<typeof reviewPayloadSchema>;
export type BrainstormPayload = z.infer<typeof brainstormPayloadSchema>;
export type VerificationPayload = z.infer<typeof verificationPayloadSchema>;
export type NormalizedTokenUsage = z.infer<typeof normalizedTokenUsageSchema>;
export type MachineFallback = z.infer<typeof fallbackSchema>;
export type SessionLocator = z.infer<typeof sessionLocatorSchema>;
export type QuotaSignal = z.infer<typeof quotaSignalSchema>;
export type NormalizedProviderFailure = z.infer<typeof normalizedProviderFailureSchema>;
export type MachineSuccessResult = z.infer<typeof machineSuccessResultSchema>;
export type MachineFailureResult = z.infer<typeof machineFailureResultSchema>;
export type MachineResult = z.infer<typeof machineResultSchema>;
