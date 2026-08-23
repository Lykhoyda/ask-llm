import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  cursor: vi.fn(),
  grok: vi.fn(),
  codex: vi.fn(),
}));

vi.mock("@ask-llm/mcp/cursor", () => ({ executeCursorAgent: calls.cursor }));
vi.mock("@ask-llm/grok-mcp/executor", () => ({ executeGrok: calls.grok }));
vi.mock("@ask-llm/codex-mcp/executor", () => ({ executeCodexCLI: calls.codex }));

import {
  isSameProductResolution,
  parseBrainstormParticipant,
  parseBrainstormParticipantList,
  runBrainstormPanel,
  validateBrainstormPanel,
} from "../brainstorm-panel.js";

const cursorPanel = [
  parseBrainstormParticipant("grok@cursor-agent:cursor-grok-4.6-high"),
  parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-sol-high"),
];

function cursorResult(provider: "grok" | "codex", model: string, response = `${provider} answer`) {
  return {
    provider,
    model,
    reportedModel: provider === "grok" ? "Cursor Grok 4.6" : "GPT-5.6 Sol 1M High",
    response,
    harness: "cursor-agent",
    usage: { provider, model, fellBack: false },
  };
}

function grokResult(
  model: string,
  harness: "grok-cli" | "xai-api",
  overrides: { response?: string; reportedModel?: string } = {},
) {
  return {
    response: "direct grok answer",
    model,
    reportedModel: model,
    harness,
    usage: { provider: "grok", model, fellBack: false },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.cursor.mockImplementation(({ provider, model }) => Promise.resolve(cursorResult(provider, model)));
  calls.grok.mockResolvedValue(grokResult("grok-build", "grok-cli"));
  calls.codex.mockResolvedValue({
    response: "direct sol answer",
    usage: { provider: "codex", model: "gpt-5.6-sol", fellBack: false },
  });
});

describe("Grok + GPT-5.6 Sol brainstorm participant contract", () => {
  it("parses explicit provider, harness, and exact model identity without rewriting", () => {
    expect(parseBrainstormParticipant("grok@cursor-agent:cursor-grok-4.6-high")).toEqual({
      provider: "grok",
      harness: "cursor-agent",
      model: "cursor-grok-4.6-high",
    });
    expect(parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-sol-high")).toEqual({
      provider: "codex",
      harness: "cursor-agent",
      model: "gpt-5.6-sol-high",
    });
  });

  it("explicitly excludes Gemini, Cursor Auto, cross-provider routes, and non-Sol Codex models", () => {
    expect(() => parseBrainstormParticipant("gemini@cursor-agent:gemini-3-pro")).toThrow(/Invalid brainstorm/);
    expect(() => parseBrainstormParticipant("grok@cursor-agent:auto")).toThrow(/exact non-Auto/);
    expect(() => parseBrainstormParticipant("grok@codex-cli:gpt-5.6-sol")).toThrow(/Unsupported brainstorm route/);
    expect(() =>
      validateBrainstormPanel([
        parseBrainstormParticipant("grok@cursor-agent:cursor-grok-4.6-high"),
        parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-terra-high"),
      ]),
    ).toThrow(/exact GPT-5\.6 Sol/);
  });

  it("requires exactly one Grok and one Codex participant", () => {
    expect(() => validateBrainstormPanel([cursorPanel[0]])).toThrow(/exactly two/);
    expect(() => validateBrainstormPanel([cursorPanel[0], cursorPanel[0]])).toThrow(/one Grok.*one Codex/);
  });
});

describe("participant list classification", () => {
  it("keeps an all-bare provider list on the compatible standard path", () => {
    expect(parseBrainstormParticipantList(["antigravity", "codex"])).toEqual({
      mode: "bare",
      providers: ["antigravity", "codex"],
    });
    expect(parseBrainstormParticipantList(["gemini", "grok", "ollama"])).toEqual({
      mode: "bare",
      providers: ["gemini", "grok", "ollama"],
    });
  });

  it("returns the exact routed panel participants for an all-routed list", () => {
    expect(
      parseBrainstormParticipantList(["grok@cursor-agent:cursor-grok-4.6-high", "codex@cursor-agent:gpt-5.6-sol-high"]),
    ).toEqual({ mode: "exact", participants: cursorPanel });
  });

  it.each([
    [["grok@cursor-agent:cursor-grok-4.6-high", "antigravity"]],
    [["antigravity", "grok@cursor-agent:cursor-grok-4.6-high"]],
    [["codex@cursor-agent:gpt-5.6-sol-high", "grok"]],
    [["gemini", "codex", "grok@grok-cli:grok-build"]],
  ])("refuses the mixed routed-and-bare list %j before any executor call", (specs) => {
    expect(() => parseBrainstormParticipantList(specs)).toThrow(
      /Mixed brainstorm participant lists are not supported.*No participant was substituted, rerouted, or dispatched/,
    );
    expect(calls.cursor).not.toHaveBeenCalled();
    expect(calls.grok).not.toHaveBeenCalled();
    expect(calls.codex).not.toHaveBeenCalled();
  });

  it("rejects unknown bare providers and empty lists without selecting a substitute", () => {
    expect(() => parseBrainstormParticipantList(["claude"])).toThrow(/Unknown brainstorm provider "claude"/);
    expect(() => parseBrainstormParticipantList([" ", ""])).toThrow(/empty/);
    expect(calls.cursor).not.toHaveBeenCalled();
    expect(calls.grok).not.toHaveBeenCalled();
    expect(calls.codex).not.toHaveBeenCalled();
  });
});

describe("exact panel routing", () => {
  it("starts both Cursor Agent participants concurrently with exact provider/model pairs", async () => {
    const started: string[] = [];
    const releases = new Map<string, () => void>();
    calls.cursor.mockImplementation(
      ({ provider, model }) =>
        new Promise((resolve) => {
          started.push(provider);
          releases.set(provider, () => resolve(cursorResult(provider, model)));
        }),
    );

    const pending = runBrainstormPanel({ prompt: "same bytes", participants: cursorPanel });
    await vi.waitFor(() => expect(started).toEqual(["grok", "codex"]));
    releases.get("codex")?.();
    releases.get("grok")?.();
    const report = await pending;

    expect(calls.cursor).toHaveBeenNthCalledWith(1, {
      provider: "grok",
      model: "cursor-grok-4.6-high",
      prompt: "same bytes",
      signal: undefined,
      onProgress: undefined,
    });
    expect(calls.cursor).toHaveBeenNthCalledWith(2, {
      provider: "codex",
      model: "gpt-5.6-sol-high",
      prompt: "same bytes",
      signal: undefined,
      onProgress: undefined,
    });
    expect(calls.grok).not.toHaveBeenCalled();
    expect(calls.codex).not.toHaveBeenCalled();
    expect(report.participants.map(({ provider }) => provider)).toEqual(["grok", "codex"]);
  });

  it("supports Grok Build only as an explicit direct alternative while Sol stays on its selected route", async () => {
    const participants = [
      parseBrainstormParticipant("grok@grok-cli:grok-build"),
      parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-sol-high"),
    ];
    await runBrainstormPanel({ prompt: "architecture", participants });

    expect(calls.grok).toHaveBeenCalledWith({
      prompt: "architecture",
      model: "grok-build",
      harness: "grok-cli",
      reasoningEffort: "high",
      signal: undefined,
      onProgress: undefined,
    });
    expect(calls.cursor).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "codex", model: "gpt-5.6-sol-high" }),
    );
  });

  it("does not pivot from a failed direct Grok route to Cursor, API, Codex, or Gemini", async () => {
    calls.grok.mockRejectedValueOnce(new Error("Grok CLI authentication failed; no fallback was attempted"));
    const report = await runBrainstormPanel({
      prompt: "architecture",
      participants: [
        parseBrainstormParticipant("grok@grok-cli:grok-build"),
        parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-sol-high"),
      ],
    });

    expect(calls.grok).toHaveBeenCalledTimes(1);
    expect(calls.grok.mock.calls[0][0].harness).toBe("grok-cli");
    expect(calls.cursor).toHaveBeenCalledTimes(1);
    expect(calls.cursor.mock.calls[0][0].provider).toBe("codex");
    expect(calls.codex).not.toHaveBeenCalled();
    expect(report.participants[0]).toMatchObject({
      provider: "grok",
      harness: "grok-cli",
      status: "rejected",
      error: expect.stringContaining("authentication failed"),
    });
    expect(report.participants[0].modelVerification).toBeUndefined();
  });

  it("prefixes progress with provider, harness, and exact model instead of a display label", async () => {
    const progress: string[] = [];
    calls.cursor.mockImplementation(({ provider, model, onProgress }) => {
      onProgress("still working");
      return Promise.resolve(cursorResult(provider, model));
    });
    await runBrainstormPanel({
      prompt: "architecture",
      participants: cursorPanel,
      onProgress: (text) => progress.push(text),
    });

    expect(progress).toEqual([
      "[grok via cursor-agent (cursor-grok-4.6-high)] still working",
      "[codex via cursor-agent (gpt-5.6-sol-high)] still working",
    ]);
    expect(progress.join(" ")).not.toContain("Cursor Grok 4.6");
  });

  it.each([
    "Cursor Agent authentication failed. Run `agent login`. No fallback was attempted.",
    "Cursor Agent harness is unavailable. Install Cursor CLI. No provider or model fallback was attempted.",
  ])("preserves actionable Cursor failure without trying another route: %s", async (message) => {
    calls.cursor.mockImplementation(({ provider, model }) =>
      provider === "grok" ? Promise.reject(new Error(message)) : Promise.resolve(cursorResult(provider, model)),
    );
    const report = await runBrainstormPanel({ prompt: "architecture", participants: cursorPanel });

    expect(report.participants[0]).toMatchObject({
      provider: "grok",
      harness: "cursor-agent",
      requestedModel: "cursor-grok-4.6-high",
      status: "rejected",
      error: message,
    });
    expect(calls.cursor).toHaveBeenCalledTimes(2);
    expect(calls.grok).not.toHaveBeenCalled();
    expect(calls.codex).not.toHaveBeenCalled();
  });
});

describe("truthful model attribution", () => {
  it("treats Cursor's echoed requested ID as selected-only and keeps the display label a separate label", async () => {
    const report = await runBrainstormPanel({ prompt: "architecture", participants: cursorPanel });

    expect(report.status).toBe("complete");
    expect(report.participants).toEqual([
      expect.objectContaining({
        provider: "grok",
        harness: "cursor-agent",
        requestedModel: "cursor-grok-4.6-high",
        reportedModel: "Cursor Grok 4.6",
        modelVerification: "selected-unverified",
        status: "fulfilled",
      }),
      expect.objectContaining({
        provider: "codex",
        harness: "cursor-agent",
        requestedModel: "gpt-5.6-sol-high",
        reportedModel: "GPT-5.6 Sol 1M High",
        modelVerification: "selected-unverified",
        status: "fulfilled",
      }),
    ]);
    for (const participant of report.participants) {
      expect(participant).not.toHaveProperty("observedModel");
      expect(participant).not.toHaveProperty("actualModel");
      expect(participant.attributionNote).toMatch(/selected-only and unverifiable/);
      expect(participant.attributionNote).toContain(`"${participant.reportedModel}"`);
    }
  });

  it("records the served ID as observed for direct Grok routes when it matches the request", async () => {
    const report = await runBrainstormPanel({
      prompt: "architecture",
      participants: [
        parseBrainstormParticipant("grok@grok-cli:grok-build"),
        parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-sol-high"),
      ],
    });

    expect(report.participants[0]).toMatchObject({
      requestedModel: "grok-build",
      observedModel: "grok-build",
      modelVerification: "observed-exact",
      status: "fulfilled",
    });
    expect(report.participants[0]).not.toHaveProperty("reportedModel");
  });

  it("keeps a direct Grok response selected-only when the harness reports no served model ID", async () => {
    calls.grok.mockResolvedValueOnce(grokResult("grok-build", "grok-cli", { reportedModel: undefined }));
    const report = await runBrainstormPanel({
      prompt: "architecture",
      participants: [
        parseBrainstormParticipant("grok@grok-cli:grok-build"),
        parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-sol-high"),
      ],
    });

    expect(report.status).toBe("complete");
    expect(report.participants[0]).toMatchObject({
      requestedModel: "grok-build",
      modelVerification: "selected-unverified",
      status: "fulfilled",
      attributionNote: expect.stringContaining("reported no served model ID"),
    });
    expect(report.participants[0]).not.toHaveProperty("observedModel");
    expect(report.participants[0].attributionNote).not.toMatch(/reported served model/);
  });

  it("treats a documented xAI -latest alias resolving to a dated same-product ID as observed-alias", async () => {
    calls.grok.mockResolvedValueOnce(grokResult("grok-4-0709", "xai-api"));
    const report = await runBrainstormPanel({
      prompt: "architecture",
      participants: [
        parseBrainstormParticipant("grok@xai-api:grok-4-latest"),
        parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-sol-high"),
      ],
    });

    expect(calls.grok).toHaveBeenCalledWith(expect.objectContaining({ model: "grok-4-latest" }));
    expect(report.status).toBe("complete");
    expect(report.participants[0]).toMatchObject({
      requestedModel: "grok-4-latest",
      observedModel: "grok-4-0709",
      modelVerification: "observed-alias",
      status: "fulfilled",
    });
  });

  it("keeps a disclosed same-product xAI alias/snapshot resolution eligible without rewriting the request", async () => {
    calls.grok.mockResolvedValueOnce(grokResult("grok-4.6-1015", "xai-api"));
    const report = await runBrainstormPanel({
      prompt: "architecture",
      participants: [
        parseBrainstormParticipant("grok@xai-api:grok-4.6"),
        parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-sol-high"),
      ],
    });

    expect(calls.grok).toHaveBeenCalledWith(expect.objectContaining({ model: "grok-4.6", harness: "xai-api" }));
    expect(report.status).toBe("complete");
    expect(report.consensusEligible).toBe(true);
    expect(report.participants[0]).toMatchObject({
      requestedModel: "grok-4.6",
      observedModel: "grok-4.6-1015",
      modelVerification: "observed-alias",
      status: "fulfilled",
      attributionNote: expect.stringContaining('served "grok-4.6-1015" for requested "grok-4.6"'),
    });
  });

  it("rejects a direct Grok response served by a different model as a mismatch", async () => {
    calls.grok.mockResolvedValueOnce(grokResult("grok-3", "xai-api"));
    const report = await runBrainstormPanel({
      prompt: "architecture",
      participants: [
        parseBrainstormParticipant("grok@xai-api:grok-4.6"),
        parseBrainstormParticipant("codex@cursor-agent:gpt-5.6-sol-high"),
      ],
    });

    expect(report.status).toBe("partial");
    expect(report.consensusEligible).toBe(false);
    expect(report.participants[0]).toMatchObject({
      requestedModel: "grok-4.6",
      observedModel: "grok-3",
      modelVerification: "mismatch",
      status: "rejected",
      error: expect.stringContaining('requested exact model "grok-4.6" but reported "grok-3"'),
    });
    expect(calls.grok).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["grok-4.6", "grok-4.6", true],
    ["grok-4.6", "GROK-4.6", true],
    ["grok-4.6", "grok-4.6-1015", true],
    ["grok-4.6", "grok-4.6-2026-08-01", true],
    ["grok-4.6", "grok-4.6-fast", false],
    ["grok-4.6", "grok-4.61", false],
    ["grok-4.6", "grok-3", false],
    ["grok-4.6-1015", "grok-4.6", false],
    ["grok-4-latest", "grok-4-latest", true],
    ["grok-4-latest", "grok-4-0709", true],
    ["grok-4-latest", "grok-4", false],
    ["grok-4-latest", "grok-4-fast", false],
    ["grok-4-latest", "grok-4-latest-0709", false],
    ["-latest", "-0709", false],
  ])("same-product resolution of requested %s served %s is %s", (requested, served, expected) => {
    expect(isSameProductResolution(requested, served)).toBe(expected);
  });

  it("rejects a direct Codex fallback instead of attributing Terra as Sol", async () => {
    calls.codex.mockResolvedValueOnce({
      response: "terra answered",
      usage: { provider: "codex", model: "gpt-5.6-terra", fellBack: true },
    });
    const report = await runBrainstormPanel({
      prompt: "architecture",
      participants: [
        parseBrainstormParticipant("grok@grok-cli:grok-build"),
        parseBrainstormParticipant("codex@codex-cli:gpt-5.6-sol"),
      ],
    });

    expect(report.participants[1]).toMatchObject({
      provider: "codex",
      requestedModel: "gpt-5.6-sol",
      modelVerification: "fallback",
      status: "rejected",
      error: expect.stringContaining('fallback to "gpt-5.6-terra" for requested "gpt-5.6-sol"'),
    });
    expect(report.participants[1]).not.toHaveProperty("response");
    expect(report.consensusEligible).toBe(false);
  });

  it("keeps a direct Codex response served from the response cache eligible but selected-only", async () => {
    calls.codex.mockResolvedValueOnce({ response: "cached sol answer", threadId: undefined, usage: undefined });
    const report = await runBrainstormPanel({
      prompt: "architecture",
      participants: [
        parseBrainstormParticipant("grok@grok-cli:grok-build"),
        parseBrainstormParticipant("codex@codex-cli:gpt-5.6-sol"),
      ],
    });

    expect(report.status).toBe("complete");
    expect(report.participants[1]).toMatchObject({
      provider: "codex",
      harness: "codex-cli",
      requestedModel: "gpt-5.6-sol",
      modelVerification: "selected-unverified",
      response: "cached sol answer",
      status: "fulfilled",
      attributionNote: expect.stringContaining("response cache"),
    });
    expect(report.participants[1]).not.toHaveProperty("observedModel");
  });

  it("rejects a direct Codex run that reports a different model without a fallback flag", async () => {
    calls.codex.mockResolvedValueOnce({
      response: "other model answered",
      usage: { provider: "codex", model: "gpt-5.6", fellBack: false },
    });
    const report = await runBrainstormPanel({
      prompt: "architecture",
      participants: [
        parseBrainstormParticipant("grok@grok-cli:grok-build"),
        parseBrainstormParticipant("codex@codex-cli:gpt-5.6-sol"),
      ],
    });

    expect(report.participants[1]).toMatchObject({
      modelVerification: "mismatch",
      status: "rejected",
      error: expect.stringContaining('ran "gpt-5.6" instead of requested "gpt-5.6-sol"'),
    });
    expect(report.status).toBe("partial");
  });
});

describe("deterministic two-model synthesis eligibility", () => {
  it("allows two-model consensus only after both exact participants succeed", async () => {
    const report = await runBrainstormPanel({ prompt: "architecture", participants: cursorPanel });
    expect(report).toMatchObject({
      panel: "grok+gpt-5.6-sol",
      status: "complete",
      consensusEligible: true,
      synthesisRule: expect.stringContaining("only when both requested participants fulfilled"),
    });
  });

  it("marks one failure partial and forbids representing it as two-model consensus", async () => {
    calls.cursor.mockImplementation(({ provider, model }) => {
      if (provider === "grok") {
        return Promise.reject(
          new Error(
            'Cursor Agent model "cursor-grok-4.6-high" is unavailable. Run `agent --list-models`. No fallback was attempted.',
          ),
        );
      }
      return Promise.resolve(cursorResult(provider, model, "Sol-only insight"));
    });
    const report = await runBrainstormPanel({ prompt: "architecture", participants: cursorPanel });

    expect(report.status).toBe("partial");
    expect(report.consensusEligible).toBe(false);
    expect(report.participants[0]).toMatchObject({
      provider: "grok",
      status: "rejected",
      error: expect.stringContaining("model"),
    });
    expect(report.participants[1]).toMatchObject({
      provider: "codex",
      status: "fulfilled",
      response: "Sol-only insight",
    });
    expect(report.synthesisRule).toContain("attribute surviving insights to that participant only");
  });

  it("reports failed with no consensus when both participants fail", async () => {
    calls.cursor.mockRejectedValue(new Error("Cursor Agent harness is unavailable. No fallback was attempted."));
    const report = await runBrainstormPanel({ prompt: "architecture", participants: cursorPanel });

    expect(report.status).toBe("failed");
    expect(report.consensusEligible).toBe(false);
    expect(report.participants.every(({ status }) => status === "rejected")).toBe(true);
  });
});
