import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  cursor: vi.fn(),
  grok: vi.fn(),
  codex: vi.fn(),
}));

vi.mock("@ask-llm/mcp/cursor", () => ({ executeCursorAgent: calls.cursor }));
vi.mock("@ask-llm/grok-mcp/executor", () => ({ executeGrok: calls.grok }));
vi.mock("@ask-llm/codex-mcp/executor", () => ({ executeCodexCLI: calls.codex }));

import { parseBrainstormParticipant, runBrainstormPanel, validateBrainstormPanel } from "../brainstorm-panel.js";

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

beforeEach(() => {
  vi.clearAllMocks();
  calls.cursor.mockImplementation(({ provider, model }) => Promise.resolve(cursorResult(provider, model)));
  calls.grok.mockResolvedValue({
    response: "direct grok answer",
    model: "grok-build",
    harness: "grok-cli",
    usage: { provider: "grok", model: "grok-build", fellBack: false },
  });
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
      actualModel: "gpt-5.6-terra",
      status: "rejected",
      error: expect.stringMatching(/reported "gpt-5\.6-terra"|model fallback/),
    });
    expect(report.consensusEligible).toBe(false);
  });

  it("keeps requested catalog IDs and reported display labels separate in attribution", async () => {
    const report = await runBrainstormPanel({ prompt: "architecture", participants: cursorPanel });
    expect(report.participants).toEqual([
      expect.objectContaining({
        provider: "grok",
        harness: "cursor-agent",
        requestedModel: "cursor-grok-4.6-high",
        actualModel: "cursor-grok-4.6-high",
        reportedModel: "Cursor Grok 4.6",
      }),
      expect.objectContaining({
        provider: "codex",
        harness: "cursor-agent",
        requestedModel: "gpt-5.6-sol-high",
        actualModel: "gpt-5.6-sol-high",
        reportedModel: "GPT-5.6 Sol 1M High",
      }),
    ]);
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
});
