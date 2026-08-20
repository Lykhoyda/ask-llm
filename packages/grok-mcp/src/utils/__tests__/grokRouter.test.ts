import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  apiAvailable: vi.fn(),
  cli: vi.fn(),
  cliAvailable: vi.fn(),
}));
vi.mock("../grokExecutor.js", () => ({
  executeGrokAPI: mocks.api,
  isProviderAvailable: mocks.apiAvailable,
  listModels: vi.fn(),
}));
vi.mock("../grokCliExecutor.js", () => ({
  executeGrokCLI: mocks.cli,
  probeGrokCli: mocks.cliAvailable,
  listGrokCliModels: vi.fn(),
}));

import { executeGrok, isGrokProviderAvailable } from "../grokRouter.js";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ASK_GROK_HARNESS;
  mocks.api.mockResolvedValue({ response: "api", model: "grok-4.6", harness: "xai-api" });
  mocks.cli.mockResolvedValue({ response: "cli", model: "grok-4.6", harness: "grok-cli" });
});

describe("Grok harness routing", () => {
  it("defaults to xAI API without silently probing or falling back to the CLI", async () => {
    await expect(executeGrok({ prompt: "review" })).resolves.toMatchObject({ harness: "xai-api" });
    expect(mocks.api).toHaveBeenCalledOnce();
    expect(mocks.cli).not.toHaveBeenCalled();
  });

  it("routes an explicit Grok CLI request without touching the API", async () => {
    await expect(executeGrok({ prompt: "review", harness: "grok-cli" })).resolves.toMatchObject({
      harness: "grok-cli",
    });
    expect(mocks.cli).toHaveBeenCalledOnce();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("forwards the output schema to the Grok CLI harness for local validation", async () => {
    const outputSchema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] };
    const onProgress = vi.fn();
    await executeGrok({ prompt: "judge", harness: "grok-cli", outputSchema, onProgress });
    expect(mocks.cli).toHaveBeenCalledWith(expect.objectContaining({ outputSchema, harness: "grok-cli" }));
    expect(onProgress).toHaveBeenCalledWith(expect.stringMatching(/shared machine boundary validates/));
  });

  it("checks readiness only for the configured default harness", async () => {
    mocks.apiAvailable.mockResolvedValue(true);
    await expect(isGrokProviderAvailable()).resolves.toBe(true);
    expect(mocks.cliAvailable).not.toHaveBeenCalled();

    process.env.ASK_GROK_HARNESS = "grok-cli";
    mocks.cliAvailable.mockResolvedValue(true);
    await expect(isGrokProviderAvailable()).resolves.toBe(true);
    expect(mocks.apiAvailable).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown harnesses before executing either transport", async () => {
    process.env.ASK_GROK_HARNESS = "automatic";
    await expect(executeGrok({ prompt: "review" })).rejects.toThrow(/Unsupported Grok harness/);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.cli).not.toHaveBeenCalled();
  });
});
