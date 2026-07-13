import { createHash } from "node:crypto";
import {
  brainstormPayloadSchema,
  machineFailureResultSchema,
  machineRequestSchema,
  machineResultSchema,
  reviewPayloadSchema,
  verificationPayloadSchema,
} from "@ask-llm/shared";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ExecutorFn } from "../index.js";
import { buildRolePrompt, type MachineDeps, machineJsonSchemaBundle, runMachineRequest } from "../machine.js";

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

function clock(...timestamps: number[]): () => number {
  const now = vi.fn();
  for (const timestamp of timestamps) now.mockReturnValueOnce(timestamp);
  return now;
}

function deps(executor: ExecutorFn | undefined, now: () => number = clock(100, 145)): MachineDeps {
  return {
    loadExecutor: vi.fn().mockResolvedValue(executor),
    now,
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
      model: "Gemini 3.5 Flash (High)",
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
      actualModel: "Gemini 3.5 Flash (High)",
      fallback: {
        occurred: true,
        requestedModel: "Gemini 3.1 Pro (High)",
        actualModel: "Gemini 3.5 Flash (High)",
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
    expect(first.request).toEqual(canonicalize(z.toJSONSchema(machineRequestSchema)));
    expect(first.result).toEqual(canonicalize(z.toJSONSchema(machineResultSchema)));
    expect(first.failure).toEqual(canonicalize(z.toJSONSchema(machineFailureResultSchema)));
    expect(first.rolePayloads).toEqual({
      brainstorm: canonicalize(z.toJSONSchema(brainstormPayloadSchema)),
      review: canonicalize(z.toJSONSchema(reviewPayloadSchema)),
      verify: canonicalize(z.toJSONSchema(verificationPayloadSchema)),
    });
  });
});
