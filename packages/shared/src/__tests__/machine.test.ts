import { describe, expect, it } from "vitest";
import { classifyProviderFailure, machineRequestSchema, machineResultSchema, parseRolePayload } from "../machine.js";

const reviewPayload = {
  summary: "One issue",
  findings: [
    {
      id: "R1",
      severity: "high",
      confidence: 90,
      title: "Unsafe mutation",
      evidence: "The write occurs before validation.",
      recommendation: "Validate first.",
      file: "src/mutate.ts",
      line: 42,
    },
  ],
};

const resultProvenance = {
  schemaVersion: 1,
  requestId: "run-123-review-1",
  provider: "codex",
  actualModel: "gpt-5.6",
  rawResponseSha256: "a".repeat(64),
  durationMs: 123,
  usage: {
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
  },
  fallback: {
    occurred: false,
    requestedModel: "gpt-5.6",
    actualModel: "gpt-5.6",
  },
  session: {
    sessionId: "session-123",
    transcriptPath: null,
  },
  quotaSignal: {
    kind: "reported",
    usedPercent: 25,
    windowHours: 5,
  },
};

describe("machineRequestSchema", () => {
  it("accepts a bounded read-only Codex review request", () => {
    expect(
      machineRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: "run-123-review-1",
        role: "review",
        provider: "codex",
        prompt: "Review the supplied diff.",
        readOnly: true,
        writerProvider: "claude",
        includeDirs: ["packages/core"],
      }).success,
    ).toBe(true);
  });

  it.each(["codex", "claude", "grok", "antigravity"])("accepts the safe machine provider %s", (provider) => {
    expect(
      machineRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: "run-123-verify-1",
        role: "verify",
        provider,
        prompt: "Verify the supplied claims.",
        readOnly: true,
      }).success,
    ).toBe(true);
  });

  it.each(["gemini", "ollama"])("rejects the non-factory provider %s", (provider) => {
    expect(
      machineRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: "run-123-review-1",
        role: "review",
        provider,
        prompt: "Review",
        readOnly: true,
      }).success,
    ).toBe(false);
  });

  it("allows a writer from the full provider tuple", () => {
    expect(
      machineRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: "run-123-review-1",
        role: "review",
        provider: "codex",
        prompt: "Review",
        readOnly: true,
        writerProvider: "gemini",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown fields and a self-review quorum request", () => {
    expect(
      machineRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: "run-123-review-1",
        role: "review",
        provider: "codex",
        prompt: "Review",
        readOnly: true,
        writerProvider: "codex",
        surprise: true,
      }).success,
    ).toBe(false);
  });

  it("rejects self-review without relying on strict-object validation", () => {
    expect(
      machineRequestSchema.safeParse({
        schemaVersion: 1,
        requestId: "run-123-review-1",
        role: "review",
        provider: "claude",
        prompt: "Review",
        readOnly: true,
        writerProvider: "claude",
      }).success,
    ).toBe(false);
  });
});

describe("machineResultSchema", () => {
  it("accepts a strict role-matched success result", () => {
    expect(
      machineResultSchema.safeParse({
        ...resultProvenance,
        status: "success",
        role: "review",
        payload: reviewPayload,
        failure: null,
      }).success,
    ).toBe(true);
  });

  it("rejects a success result whose role and payload disagree", () => {
    expect(
      machineResultSchema.safeParse({
        ...resultProvenance,
        status: "success",
        role: "verify",
        payload: reviewPayload,
        failure: null,
      }).success,
    ).toBe(false);
  });

  it("accepts an explicit normalized failure result", () => {
    expect(
      machineResultSchema.safeParse({
        ...resultProvenance,
        status: "failed",
        role: "review",
        actualModel: null,
        rawResponseSha256: null,
        usage: null,
        fallback: {
          occurred: false,
          requestedModel: null,
          actualModel: null,
        },
        session: null,
        quotaSignal: { kind: "runtime_proxy_required" },
        payload: null,
        failure: {
          kind: "tool_unavailable",
          message: "Provider executable is unavailable",
        },
      }).success,
    ).toBe(true);
  });

  it("rejects a failure result whose envelope and fallback actual models contradict", () => {
    expect(
      machineResultSchema.safeParse({
        ...resultProvenance,
        status: "failed",
        role: "review",
        actualModel: null,
        payload: null,
        failure: {
          kind: "unavailable",
          message: "Provider is unavailable",
        },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-fallback result with different requested and actual models", () => {
    expect(
      machineResultSchema.safeParse({
        ...resultProvenance,
        status: "success",
        role: "review",
        fallback: {
          occurred: false,
          requestedModel: "gpt-5.5",
          actualModel: "gpt-5.6",
        },
        payload: reviewPayload,
        failure: null,
      }).success,
    ).toBe(false);
  });

  it("does not allow an unknown quota signal to invent a percentage", () => {
    expect(
      machineResultSchema.safeParse({
        ...resultProvenance,
        status: "failed",
        role: "review",
        quotaSignal: {
          kind: "runtime_proxy_required",
          usedPercent: 80,
        },
        payload: null,
        failure: {
          kind: "unavailable",
          message: "Provider is unavailable",
        },
      }).success,
    ).toBe(false);
  });
});

describe("classifyProviderFailure", () => {
  it.each([
    ["You have hit your usage limit", "rate_limited"],
    ["401 authentication required", "auth_failed"],
    ["spawn agy ENOENT", "tool_unavailable"],
    ["request timed out after 300000ms", "timeout"],
    ["Antigravity invocation lock remained busy", "unavailable"],
    ["provider is not loaded", "unavailable"],
    ["unexpected provider failure", "unavailable"],
  ])("maps %s to %s", (message, expected) => {
    expect(classifyProviderFailure(new Error(message))).toBe(expected);
  });

  it("applies auth classification before quota classification", () => {
    expect(classifyProviderFailure(new Error("401 authentication failed: quota unavailable"))).toBe("auth_failed");
  });
});

describe("parseRolePayload", () => {
  it("validates review findings rather than accepting arbitrary JSON", () => {
    const payload = parseRolePayload("review", JSON.stringify(reviewPayload));

    expect(payload.ok).toBe(true);
  });

  it("extracts the first balanced JSON object and respects quoted braces", () => {
    const payload = parseRolePayload(
      "brainstorm",
      'Preface {"recommendation":"Keep {quoted} braces","ideas":[{"title":"Bound output","rationale":"Safer \\"JSON\\" parsing","risks":[]}]} trailing {"ignored":true}',
    );

    expect(payload).toEqual({
      ok: true,
      payload: {
        recommendation: "Keep {quoted} braces",
        ideas: [
          {
            title: "Bound output",
            rationale: 'Safer "JSON" parsing',
            risks: [],
          },
        ],
      },
    });
  });

  it("ignores quoted braces in provider preamble text", () => {
    const payload = parseRolePayload(
      "review",
      `Provider note: the token "{example}" is illustrative. ${JSON.stringify(reviewPayload)}`,
    );

    expect(payload).toEqual({ ok: true, payload: reviewPayload });
  });

  it("skips an invalid balanced object before a valid role payload", () => {
    const payload = parseRolePayload("review", `Schema example: {"type":"object"}\n${JSON.stringify(reviewPayload)}`);

    expect(payload).toEqual({ ok: true, payload: reviewPayload });
  });

  it("returns a normalized schema failure without parser details", () => {
    expect(parseRolePayload("verify", "not JSON")).toEqual({
      ok: false,
      failure: {
        kind: "schema_invalid",
        message: "Provider output did not contain a valid verify payload",
      },
    });
  });
});
