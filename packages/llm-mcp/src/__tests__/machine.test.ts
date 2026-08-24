import { createHash } from "node:crypto";
import {
  brainstormPayloadSchema,
  machineFailureResultSchema,
  machineRequestSchema,
  machineResultSchema,
  reviewPayloadSchema,
  verificationPayloadSchema,
} from "@ask-llm/shared";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ExecutorFn } from "../index.js";
import {
  buildRolePrompt,
  type MachineDeps,
  machineJsonSchemaBundle,
  runMachineRequest,
  validateMachineSchemaRefinements,
} from "../machine.js";

const reviewPayload = {
  summary: "One issue",
  findings: [
    {
      id: "R1",
      severity: "high" as const,
      confidence: 92,
      title: "Unsafe mutation",
      evidence: "The write occurs before validation.",
      recommendation: "Validate first.",
      file: "src/mutate.ts",
      line: 42,
    },
  ],
};

const brainstormPayload = {
  recommendation: "Prefer the smaller surface.",
  ideas: [{ title: "Typed adapter", rationale: "It preserves one contract.", risks: ["Migration cost"] }],
};

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestId: "run-123-review-1",
    role: "review",
    provider: "codex",
    prompt: "Review the supplied diff.",
    model: "gpt-primary",
    readOnly: true,
    writerProvider: "claude",
    includeDirs: ["packages/core"],
    ...overrides,
  };
}

function successResult(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestId: "run-123-review-1",
    status: "success",
    role: "review",
    provider: "codex",
    actualModel: "gpt-primary",
    rawResponseSha256: "a".repeat(64),
    durationMs: 45,
    usage: null,
    fallback: {
      occurred: false,
      requestedModel: "gpt-primary",
      actualModel: "gpt-primary",
    },
    session: { sessionId: "thread-abc", transcriptPath: null },
    quotaSignal: { kind: "runtime_proxy_required" },
    payload: reviewPayload,
    failure: null,
    ...overrides,
  };
}

function failureResult(overrides: Record<string, unknown> = {}) {
  return {
    ...successResult(),
    status: "failed",
    payload: null,
    failure: { kind: "unavailable", message: "Provider execution failed" },
    ...overrides,
  };
}

function clock(...timestamps: number[]): () => number {
  const now = vi.fn();
  for (const timestamp of timestamps) now.mockReturnValueOnce(timestamp);
  return now;
}

function deps(
  executor: ExecutorFn | undefined,
  options: {
    now?: () => number;
    env?: Readonly<Record<string, string | undefined>>;
  } = {},
): MachineDeps {
  return {
    loadExecutor: vi.fn().mockResolvedValue(executor),
    now: options.now ?? clock(100, 145),
    env: options.env ?? {},
  };
}

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

describe("buildRolePrompt", () => {
  it.each([
    ["brainstorm", brainstormPayloadSchema],
    ["review", reviewPayloadSchema],
    ["verify", verificationPayloadSchema],
  ] as const)("appends one deterministic %s JSON response contract", (role, schema) => {
    const input = machineRequestSchema.parse(
      request({
        requestId: `run-123-${role}-1`,
        role,
        ...(role === "review" ? {} : { writerProvider: undefined }),
      }),
    );
    const expectedSchema = JSON.stringify(canonicalize(z.toJSONSchema(schema)));

    expect(buildRolePrompt(input)).toBe(
      `${input.prompt}\n\nReturn only one JSON object matching this JSON Schema: ${expectedSchema}`,
    );
    expect(buildRolePrompt(input)).toBe(buildRolePrompt(input));
    expect(buildRolePrompt(input)).not.toMatch(/shell command|controller policy|read-only/i);
  });
});

describe("runMachineRequest", () => {
  it("gives Codex a read-only sandbox and the role JSON schema", async () => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(reviewPayload),
      model: "gpt-primary",
      threadId: "thread-abc",
      usage: {
        provider: "codex",
        model: "gpt-primary",
        inputTokens: 20,
        outputTokens: 10,
        cachedTokens: 0,
        thinkingTokens: 1,
        durationMs: 40,
        fellBack: false,
      },
    });

    const result = await runMachineRequest(request(), deps(executor));

    expect(executor).toHaveBeenCalledOnce();
    expect(executor).toHaveBeenCalledWith({
      prompt: buildRolePrompt(machineRequestSchema.parse(request())),
      model: "gpt-primary",
      includeDirs: ["packages/core"],
      sandbox: "read-only",
      readOnly: true,
      outputSchema: canonicalize(z.toJSONSchema(reviewPayloadSchema)),
    });
    expect(result).toMatchObject({
      status: "success",
      provider: "codex",
      actualModel: "gpt-primary",
      payload: reviewPayload,
      durationMs: 45,
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      fallback: { occurred: false, requestedModel: "gpt-primary", actualModel: "gpt-primary" },
      session: { sessionId: "thread-abc", transcriptPath: null },
      quotaSignal: { kind: "runtime_proxy_required" },
    });
    expect(machineResultSchema.safeParse(result).success).toBe(true);
  });

  it("passes Grok a strict role schema and reports no fallback or session", async () => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(reviewPayload),
      model: "grok-4.6",
      usage: {
        provider: "grok",
        model: "grok-4.6",
        inputTokens: 30,
        outputTokens: 12,
        cachedTokens: 0,
        thinkingTokens: 5,
        durationMs: 40,
        fellBack: false,
      },
    });
    const input = request({ provider: "grok", model: "grok-4.6", writerProvider: "claude" });

    const result = await runMachineRequest(input, deps(executor));

    expect(executor).toHaveBeenCalledWith({
      prompt: buildRolePrompt(machineRequestSchema.parse(input)),
      model: "grok-4.6",
      includeDirs: ["packages/core"],
      sandbox: "read-only",
      readOnly: true,
      outputSchema: canonicalize(z.toJSONSchema(reviewPayloadSchema)),
    });
    expect(result).toMatchObject({
      status: "success",
      provider: "grok",
      actualModel: "grok-4.6",
      fallback: { occurred: false, requestedModel: "grok-4.6", actualModel: "grok-4.6" },
      session: null,
      usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 },
    });
  });

  it("leaves an unpinned Grok model to the selected harness and reports the model it actually used", async () => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(reviewPayload),
      model: "grok-build",
      usage: { provider: "grok", model: "grok-build", inputTokens: 3, outputTokens: 2, durationMs: 5, fellBack: false },
    });
    const { model: _omitted, ...unpinned } = request({ provider: "grok", writerProvider: "claude" });

    const result = await runMachineRequest(unpinned, deps(executor));

    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ model: undefined }));
    expect(result).toMatchObject({
      status: "success",
      actualModel: "grok-build",
      fallback: { occurred: false, requestedModel: "grok-build", actualModel: "grok-build" },
    });
  });

  it("validates Grok CLI structured replies once at the shared boundary and labels mismatches schema_invalid", async () => {
    const rawResponse = 'Sure:\n```json\n{"summary":"x","findings":[],"extra":1}\n```';
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: rawResponse,
      model: "grok-build",
      harness: "grok-cli",
      usage: { provider: "grok", model: "grok-build", inputTokens: 3, outputTokens: 2, durationMs: 5, fellBack: false },
    });
    const { model: _omitted, ...unpinned } = request({ provider: "grok", writerProvider: "claude" });

    const result = await runMachineRequest(unpinned, deps(executor));

    expect(result).toMatchObject({
      status: "failed",
      actualModel: "grok-build",
      rawResponseSha256: createHash("sha256").update(rawResponse).digest("hex"),
      failure: { kind: "schema_invalid", message: "Provider output did not contain a valid review payload" },
    });

    const conforming = `Here you go:\n\`\`\`json\n${JSON.stringify(reviewPayload)}\n\`\`\``;
    const okExecutor: ExecutorFn = vi.fn().mockResolvedValue({ response: conforming, model: "grok-build" });
    await expect(runMachineRequest(unpinned, deps(okExecutor))).resolves.toMatchObject({
      status: "success",
      actualModel: "grok-build",
      payload: reviewPayload,
    });
  });

  it("pins the Grok model from ASK_GROK_MODEL when the request leaves it unset", async () => {
    const executor: ExecutorFn = vi
      .fn()
      .mockResolvedValue({ response: JSON.stringify(reviewPayload), model: "grok-4.6" });
    const { model: _omitted, ...unpinned } = request({ provider: "grok", writerProvider: "claude" });

    await runMachineRequest(unpinned, deps(executor, { env: { ASK_GROK_MODEL: "grok-4.6" } }));

    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ model: "grok-4.6" }));
  });

  it("gives Antigravity read-only mode and reports its actual fallback model and transcript", async () => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(brainstormPayload),
      model: "Gemini Flash",
      sessionId: undefined,
      transcriptPath: "/tmp/agy/conversation.pb",
      usage: undefined,
    });

    const result = await runMachineRequest(
      request({
        requestId: "run-123-brainstorm-1",
        role: "brainstorm",
        provider: "antigravity",
        model: "Gemini Pro",
        writerProvider: undefined,
      }),
      deps(executor),
    );

    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true, sandbox: "read-only" }));
    expect(result).toMatchObject({
      status: "success",
      provider: "antigravity",
      actualModel: "Gemini Flash",
      fallback: { occurred: true, requestedModel: "Gemini Pro", actualModel: "Gemini Flash" },
      session: { sessionId: null, transcriptPath: "/tmp/agy/conversation.pb" },
      usage: null,
    });
  });

  it("does not report Claude alias canonicalization as a fallback", async () => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(reviewPayload),
      model: "claude-opus-4-6",
      sessionId: "session-claude",
      usage: {
        provider: "claude",
        model: "claude-opus-4-6",
        inputTokens: 20,
        outputTokens: 10,
        cachedTokens: 0,
        thinkingTokens: 0,
        durationMs: 40,
        fellBack: false,
      },
    });

    const result = await runMachineRequest(
      request({ provider: "claude", model: "opus", writerProvider: "codex" }),
      deps(executor),
    );

    expect(result).toMatchObject({
      actualModel: "claude-opus-4-6",
      fallback: {
        occurred: false,
        requestedModel: "claude-opus-4-6",
        actualModel: "claude-opus-4-6",
      },
    });
  });

  it.each([
    {
      provider: "codex" as const,
      writerProvider: "claude" as const,
      actualModel: "gpt-5.5-mini",
      requestedModel: "gpt-5.6-sol",
    },
    {
      provider: "claude" as const,
      writerProvider: "codex" as const,
      actualModel: "claude-sonnet-4-6",
      requestedModel: "opus",
    },
  ])("preserves $provider fallback evidence when the request omits model", async (testCase) => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(reviewPayload),
      model: testCase.actualModel,
      usage: {
        provider: testCase.provider,
        model: testCase.actualModel,
        inputTokens: 20,
        outputTokens: 10,
        cachedTokens: 0,
        thinkingTokens: 0,
        durationMs: 40,
        fellBack: true,
      },
    });

    const result = await runMachineRequest(
      request({
        provider: testCase.provider,
        writerProvider: testCase.writerProvider,
        model: undefined,
      }),
      deps(executor),
    );

    expect(result).toMatchObject({
      actualModel: testCase.actualModel,
      fallback: {
        occurred: true,
        requestedModel: testCase.requestedModel,
        actualModel: testCase.actualModel,
      },
    });
  });

  it("derives an omitted-model Antigravity fallback from its configured default", async () => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(brainstormPayload),
      model: "gemini-3.5-flash",
      usage: undefined,
    });

    const result = await runMachineRequest(
      request({
        requestId: "run-123-brainstorm-2",
        role: "brainstorm",
        provider: "antigravity",
        model: undefined,
        writerProvider: undefined,
      }),
      deps(executor),
    );

    expect(result).toMatchObject({
      actualModel: "gemini-3.5-flash",
      fallback: {
        occurred: true,
        requestedModel: "gemini-3.1-pro",
        actualModel: "gemini-3.5-flash",
      },
    });
  });

  it.each([
    {
      label: "Codex override without fallback",
      provider: "codex" as const,
      writerProvider: "claude" as const,
      envVar: "ASK_CODEX_MODEL",
      configuredModel: "codex-stable-alias",
      actualModel: "gpt-5.6-sol",
      fellBack: false,
    },
    {
      label: "Codex override with fallback",
      provider: "codex" as const,
      writerProvider: "claude" as const,
      envVar: "ASK_CODEX_MODEL",
      configuredModel: "gpt-custom-primary",
      actualModel: "gpt-5.6-luna",
      fellBack: true,
    },
    {
      label: "Antigravity override without fallback",
      provider: "antigravity" as const,
      writerProvider: "claude" as const,
      envVar: "ASK_ANTIGRAVITY_MODEL",
      configuredModel: "Custom Pro",
      actualModel: "Custom Pro",
      fellBack: false,
    },
    {
      label: "Antigravity override with fallback",
      provider: "antigravity" as const,
      writerProvider: "claude" as const,
      envVar: "ASK_ANTIGRAVITY_MODEL",
      configuredModel: "Custom Pro",
      actualModel: "Gemini 3.5 Flash (High)",
      fellBack: true,
    },
  ])("uses the injected effective model for $label", async (testCase) => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(reviewPayload),
      model: testCase.actualModel,
      usage:
        testCase.provider === "codex"
          ? {
              provider: "codex",
              model: testCase.actualModel,
              inputTokens: 20,
              outputTokens: 10,
              cachedTokens: 0,
              thinkingTokens: 0,
              durationMs: 40,
              fellBack: testCase.fellBack,
            }
          : undefined,
    });

    const result = await runMachineRequest(
      request({
        provider: testCase.provider,
        writerProvider: testCase.writerProvider,
        model: undefined,
      }),
      deps(executor, { env: { [testCase.envVar]: testCase.configuredModel } }),
    );

    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ model: testCase.configuredModel }));
    expect(result).toMatchObject({
      actualModel: testCase.actualModel,
      fallback: testCase.fellBack
        ? {
            occurred: true,
            requestedModel: testCase.configuredModel,
            actualModel: testCase.actualModel,
          }
        : {
            occurred: false,
            requestedModel: testCase.actualModel,
            actualModel: testCase.actualModel,
          },
    });
  });

  it("normalizes a padded Antigravity model override before dispatch and provenance comparison", async () => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(reviewPayload),
      model: "Custom Pro",
      usage: undefined,
    });

    const result = await runMachineRequest(
      request({ provider: "antigravity", writerProvider: "claude", model: undefined }),
      deps(executor, { env: { ASK_ANTIGRAVITY_MODEL: " Custom Pro " } }),
    );

    expect(executor).toHaveBeenCalledWith(expect.objectContaining({ model: "Custom Pro" }));
    expect(result).toMatchObject({
      actualModel: "Custom Pro",
      fallback: {
        occurred: false,
        requestedModel: "Custom Pro",
        actualModel: "Custom Pro",
      },
    });
  });

  it("rejects a writer reviewing itself before loading an executor", async () => {
    const machineDeps = deps(vi.fn());

    await expect(runMachineRequest(request({ writerProvider: "codex" }), machineDeps)).rejects.toThrow(
      "review provider must differ from writer",
    );
    expect(machineDeps.loadExecutor).not.toHaveBeenCalled();
  });

  it("turns invalid provider JSON into a schema-valid failure without echoing it", async () => {
    const rawResponse = "credential sk-secret and parser position 17";
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: rawResponse,
      model: "claude-sonnet",
      sessionId: "session-claude",
    });

    const result = await runMachineRequest(
      request({ provider: "claude", model: "claude-sonnet", writerProvider: "codex" }),
      deps(executor),
    );

    expect(result).toMatchObject({
      status: "failed",
      provider: "claude",
      actualModel: "claude-sonnet",
      payload: null,
      rawResponseSha256: createHash("sha256").update(rawResponse).digest("hex"),
      failure: {
        kind: "schema_invalid",
        message: "Provider output did not contain a valid review payload",
      },
      session: { sessionId: "session-claude", transcriptPath: null },
    });
    expect(machineResultSchema.safeParse(result).success).toBe(true);
    expect(machineFailureResultSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(rawResponse);
    expect(JSON.stringify(result)).not.toContain("Review the supplied diff.");
  });

  it.each([
    ["You have hit your usage limit; token=sk-secret", "rate_limited"],
    ["401 authentication required for sk-secret", "auth_failed"],
    ["request timed out after 300000ms", "timeout"],
    ["spawn codex ENOENT /private/bin/codex", "tool_unavailable"],
    ["provider crashed with credential sk-secret", "unavailable"],
  ] as const)("normalizes provider errors as %s", async (message, kind) => {
    const executor: ExecutorFn = vi.fn().mockRejectedValue(new Error(message));

    const result = await runMachineRequest(request(), deps(executor));

    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("Expected a failed result");
    expect(result.failure.kind).toBe(kind);
    expect(machineResultSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain(message);
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });

  it("returns tool_unavailable when no executor is loaded", async () => {
    const result = await runMachineRequest(request(), deps(undefined));

    expect(result).toMatchObject({
      status: "failed",
      actualModel: null,
      durationMs: 0,
      rawResponseSha256: null,
      failure: { kind: "tool_unavailable" },
    });
    expect(machineResultSchema.safeParse(result).success).toBe(true);
    expect(machineFailureResultSchema.safeParse(result).success).toBe(true);
  });

  it("represents unknown subscription quota without inventing a percentage", async () => {
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(reviewPayload),
      model: "gpt-primary",
    });

    const result = await runMachineRequest(request(), deps(executor));

    expect(result.quotaSignal).toEqual({ kind: "runtime_proxy_required" });
    expect(result.quotaSignal).not.toHaveProperty("usedPercent");
  });

  it("round-trips requests and results through the shared schemas", async () => {
    const parsedRequest = machineRequestSchema.parse(JSON.parse(JSON.stringify(request())));
    const executor: ExecutorFn = vi.fn().mockResolvedValue({
      response: JSON.stringify(reviewPayload),
      model: "gpt-primary",
    });

    const result = await runMachineRequest(parsedRequest, deps(executor));
    const roundTripped = machineResultSchema.parse(JSON.parse(JSON.stringify(result)));

    expect(roundTripped).toEqual(result);
  });
});

describe("machineJsonSchemaBundle", () => {
  const parityCorpus = [
    {
      label: "request with omitted defaulted includeDirs",
      target: "request" as const,
      document: request({ includeDirs: undefined }),
      expected: true,
    },
    {
      label: "request with a traversal directory",
      target: "request" as const,
      document: request({ includeDirs: ["../secrets"] }),
      expected: false,
    },
    {
      label: "request with an absolute directory",
      target: "request" as const,
      document: request({ includeDirs: ["/etc"] }),
      expected: false,
    },
    {
      label: "self-review request",
      target: "request" as const,
      document: request({ writerProvider: "codex" }),
      expected: false,
    },
    {
      label: "request with a blank model",
      target: "request" as const,
      document: request({ model: "   " }),
      expected: false,
    },
    {
      label: "result with a blank session locator",
      target: "result" as const,
      document: successResult({ session: { sessionId: "   ", transcriptPath: null } }),
      expected: false,
    },
    {
      label: "result with an empty session locator",
      target: "result" as const,
      document: successResult({ session: { sessionId: null, transcriptPath: null } }),
      expected: false,
    },
    {
      label: "result with a blank model",
      target: "result" as const,
      document: successResult({
        actualModel: "   ",
        fallback: { occurred: false, requestedModel: "   ", actualModel: "   " },
      }),
      expected: false,
    },
    {
      label: "result with contradictory no-fallback models",
      target: "result" as const,
      document: successResult({
        fallback: { occurred: false, requestedModel: "gpt-primary", actualModel: "gpt-secondary" },
      }),
      expected: false,
    },
    {
      label: "success result with contradictory envelope and fallback models",
      target: "result" as const,
      document: successResult({
        actualModel: "gpt-secondary",
        fallback: { occurred: true, requestedModel: "gpt-primary", actualModel: "gpt-fallback" },
      }),
      expected: false,
    },
    {
      label: "failure result with contradictory envelope and fallback models",
      target: "failure" as const,
      document: failureResult({
        actualModel: "gpt-secondary",
        fallback: { occurred: true, requestedModel: "gpt-primary", actualModel: "gpt-fallback" },
      }),
      expected: false,
    },
  ];

  it.each(parityCorpus)("keeps runtime and public-schema parity for $label", ({ target, document, expected }) => {
    const bundle = machineJsonSchemaBundle();
    const validate = new Ajv2020({ strict: true }).compile(bundle[target]);
    const runtimeSchema =
      target === "request"
        ? machineRequestSchema
        : target === "failure"
          ? machineFailureResultSchema
          : machineResultSchema;
    const runtimeAccepted = runtimeSchema.safeParse(document).success;
    const publicContractAccepted =
      validate(document) && validateMachineSchemaRefinements(target, document, bundle.refinements).length === 0;

    expect(runtimeAccepted).toBe(expected);
    expect(publicContractAccepted).toBe(runtimeAccepted);
  });

  it("reports refinement violations deterministically", () => {
    const bundle = machineJsonSchemaBundle();
    const document = successResult({
      actualModel: "gpt-primary",
      fallback: { occurred: false, requestedModel: "gpt-requested", actualModel: "gpt-fallback" },
    });

    expect(validateMachineSchemaRefinements("result", document, bundle.refinements)).toEqual([
      {
        id: "non-fallback-models-match",
        message: "requested and actual models must match when fallback did not occur",
      },
      {
        id: "envelope-and-fallback-models-match",
        message: "result and fallback actual models must match",
      },
    ]);
  });

  it("exports canonical request, result, failure, and role schemas with a stable digest", () => {
    const first = machineJsonSchemaBundle();
    const second = machineJsonSchemaBundle();
    const { digest, ...schemas } = first;

    expect(first).toEqual(second);
    expect(first).toEqual(canonicalize(first));
    expect(JSON.stringify(first)).toBe(JSON.stringify(canonicalize(first)));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).toBe(
      createHash("sha256")
        .update(JSON.stringify(canonicalize(schemas)))
        .digest("hex"),
    );
    expect(first.request).toEqual(canonicalize(z.toJSONSchema(machineRequestSchema, { io: "input" })));
    expect(first.result).toEqual(canonicalize(z.toJSONSchema(machineResultSchema)));
    expect(first.failure).toEqual(canonicalize(z.toJSONSchema(machineFailureResultSchema)));
    expect(first.refinements).toEqual(
      canonicalize({
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
      }),
    );
    expect(first.rolePayloads).toEqual({
      brainstorm: canonicalize(z.toJSONSchema(brainstormPayloadSchema)),
      review: canonicalize(z.toJSONSchema(reviewPayloadSchema)),
      verify: canonicalize(z.toJSONSchema(verificationPayloadSchema)),
    });
  });
});
