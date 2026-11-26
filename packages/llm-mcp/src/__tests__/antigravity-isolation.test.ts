import { executeCommand, Logger } from "@ask-llm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askAntigravityTool } from "../../../antigravity-mcp/src/tools/ask-antigravity.tool.js";
import { executeAntigravityCLI } from "../../../antigravity-mcp/src/utils/antigravityExecutor.js";
import { buildAskLlmSchema, runAskLlm } from "../index.js";
import { runMachineRequest } from "../machine.js";

vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return { ...actual, executeCommand: vi.fn() };
});

const payload = { summary: "No issues", findings: [] };
const machineRequest = {
  schemaVersion: 1,
  requestId: "agy-isolation",
  role: "review",
  provider: "antigravity",
  writerProvider: "claude",
  prompt: "Review fixture",
  readOnly: true,
};

// Real tool, machine, and executor; process execution is the stubbed boundary.
describe("Antigravity tool and machine isolation", { timeout: 5_000 }, () => {
  const mockExec = vi.mocked(executeCommand);

  beforeEach(() => {
    mockExec.mockReset();
    mockExec.mockImplementation(async (_command, args) =>
      args[0] === "--version" ? "1.5.9" : JSON.stringify({ response: JSON.stringify(payload), status: "SUCCESS" }),
    );
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", undefined);
    vi.stubEnv("ASK_ANTIGRAVITY_MODEL", undefined);
    vi.stubEnv("ASK_ANTIGRAVITY_EFFORT", undefined);
    vi.spyOn(Logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const runMachine = () =>
    runMachineRequest(machineRequest, {
      loadExecutor: () => executeAntigravityCLI,
      now: () => Date.now(),
    });

  it("refuses the published tool before even the version probe spawns", async () => {
    await expect(askAntigravityTool.execute({ prompt: "Review fixture" })).rejects.toThrow(
      "ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1",
    );
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("returns a machine failure without spawning agy", async () => {
    const result = await runMachine();
    expect(result.status).toBe("failed");
    expect(result.failure?.kind).toBe("unavailable");
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("recovers a rejected machine default and surfaces the same rejection for an explicit unified pin", async () => {
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", "1");
    mockExec.mockImplementation(async (_command, args) => {
      if (args[0] === "--version") return "1.5.9";
      if (args.includes("--model")) throw new Error('invalid model selection (--model "gemini-4-neon")');
      return JSON.stringify({ response: JSON.stringify(payload), status: "SUCCESS" });
    });

    expect(await runMachine()).toMatchObject({
      status: "success",
      payload,
      fallback: { occurred: true, requestedModel: "gemini-4-neon", actualModel: "agy default" },
    });
    const modelInvocations = () => mockExec.mock.calls.map(([, args]) => args).filter((args) => args[0] === "-p");
    const [primary, recovery] = modelInvocations();
    expect(modelInvocations()).toHaveLength(2);
    expect(primary[primary.indexOf("--model") + 1]).toBe("gemini-4-neon");
    expect(recovery).not.toContain("--model");

    mockExec.mockClear();
    await expect(
      runAskLlm(
        buildAskLlmSchema(["antigravity"]),
        { provider: "antigravity", model: "gemini-4-neon", prompt: "Review fixture" },
        { getExecutor: () => executeAntigravityCLI },
      ),
    ).rejects.toThrow(/rejected model "gemini-4-neon".*agy models/s);
    expect(modelInvocations()).toHaveLength(1);
  });

  it.each(["tool", "machine"])("explicit opt-in warns and never bypasses permissions on the %s path", async (path) => {
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", "1");
    if (path === "tool") {
      const result = await askAntigravityTool.execute({ prompt: "Review fixture" });
      expect(result.structuredContent).toMatchObject({ response: JSON.stringify(payload) });
    } else {
      expect(await runMachine()).toMatchObject({ status: "success", payload });
    }
    const argv = mockExec.mock.calls.flatMap(([, args]) => args);
    expect(argv).toContain("--version");
    expect(argv).toContain("-p");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    // Every model spawn carries the enforced deny overlay; plan mode is no longer passed (ADR-194).
    const spawns = mockExec.mock.calls.map(([, args]) => args).filter((args) => args[0] === "-p");
    expect(spawns.length).toBeGreaterThan(0);
    for (const args of spawns) {
      const overlay = JSON.parse(args[args.indexOf("--settings") + 1]);
      expect(overlay).toEqual({ agentMode: "", permissions: { deny: ["write_file(*)", "command(*)"] } });
      expect(args).not.toContain("--mode");
    }
    expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining("read-only isolation is not guaranteed"));
  });
});

it("round-trips Antigravity session IDs through the real unified route and executor", async () => {
  vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", "1");
  vi.spyOn(Logger, "warn").mockImplementation(() => {});
  const mockExec = vi.mocked(executeCommand);
  mockExec.mockReset();
  mockExec.mockImplementation(async (_command, args) =>
    args[0] === "--version"
      ? "1.5.10"
      : JSON.stringify({ response: "answer", conversation_id: "actual-id", status: "SUCCESS" }),
  );
  try {
    const schema = buildAskLlmSchema(["antigravity"]);
    const call = { getExecutor: () => executeAntigravityCLI };
    const first = await runAskLlm(schema, { provider: "antigravity", prompt: "remember" }, call);
    expect(first.structured.sessionId).toBe("actual-id");
    expect(first.text).toContain("[Session ID: actual-id]");
    const next = await runAskLlm(
      schema,
      {
        provider: "antigravity",
        prompt: "recall",
        sessionId: first.structured.sessionId,
        includeDirs: ["pkg/a"],
      },
      call,
    );
    expect(next.structured.sessionId).toBe("actual-id");
    const spawns = mockExec.mock.calls.map(([, args]) => args).filter((args) => args[0] === "-p");
    expect(spawns).toHaveLength(2);
    expect(spawns[0]).not.toContain("--conversation");
    const args = spawns[1];
    expect(args[args.indexOf("--conversation") + 1]).toBe("actual-id");
    expect(args).toContain("--sandbox");
    expect(JSON.parse(args[args.indexOf("--settings") + 1])).toEqual({
      agentMode: "",
      permissions: { deny: ["write_file(*)", "command(*)"] },
    });
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});
