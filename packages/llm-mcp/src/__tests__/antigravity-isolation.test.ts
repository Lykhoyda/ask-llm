import { executeCommand, Logger } from "@ask-llm/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askAntigravityTool } from "../../../antigravity-mcp/src/tools/ask-antigravity.tool.js";
import { executeAntigravityCLI } from "../../../antigravity-mcp/src/utils/antigravityExecutor.js";
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
      args[0] === "--version" ? "1.2.12" : JSON.stringify({ response: JSON.stringify(payload), status: "SUCCESS" }),
    );
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", undefined);
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
    expect(Logger.warn).toHaveBeenCalledWith(expect.stringContaining("read-only isolation is not guaranteed"));
  });
});
