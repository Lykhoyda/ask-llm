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

import { ERROR_MESSAGES } from "../../constants.js";
import { executeGrok, isGrokProviderAvailable } from "../grokRouter.js";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ASK_GROK_HARNESS;
  mocks.apiAvailable.mockResolvedValue(true);
  mocks.cliAvailable.mockResolvedValue(false);
  mocks.api.mockResolvedValue({ response: "api", model: "grok-4.6", harness: "xai-api" });
  mocks.cli.mockResolvedValue({ response: "cli", model: "grok-4.6", harness: "grok-cli" });
});

describe("Grok harness routing", () => {
  it("defaults to xAI API without silently probing or falling back to the CLI", async () => {
    await expect(executeGrok({ prompt: "review" })).resolves.toMatchObject({ harness: "xai-api" });
    expect(mocks.api).toHaveBeenCalledOnce();
    expect(mocks.cli).not.toHaveBeenCalled();
  });

  it("names the explicit CLI pin when a default-route call has no API key but the CLI is ready", async () => {
    mocks.apiAvailable.mockResolvedValue(false);
    mocks.cliAvailable.mockResolvedValue(true);

    await expect(executeGrok({ prompt: "review" })).rejects.toThrow(ERROR_MESSAGES.MISSING_CREDENTIALS_CLI_DETECTED);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.cli).not.toHaveBeenCalled();
  });

  it("keeps the plain missing-credential path when neither transport is ready on the default route", async () => {
    mocks.apiAvailable.mockResolvedValue(false);
    mocks.cliAvailable.mockResolvedValue(false);
    mocks.api.mockRejectedValue(new Error(ERROR_MESSAGES.MISSING_CREDENTIALS));

    await expect(executeGrok({ prompt: "review" })).rejects.toThrow(ERROR_MESSAGES.MISSING_CREDENTIALS);
    expect(mocks.api).toHaveBeenCalledOnce();
    expect(mocks.cli).not.toHaveBeenCalled();
  });

  it("does not probe the CLI when the API harness was pinned explicitly", async () => {
    mocks.apiAvailable.mockResolvedValue(false);
    mocks.cliAvailable.mockResolvedValue(true);
    mocks.api.mockRejectedValue(new Error(ERROR_MESSAGES.MISSING_CREDENTIALS));

    await expect(executeGrok({ prompt: "review", harness: "xai-api" })).rejects.toThrow(
      ERROR_MESSAGES.MISSING_CREDENTIALS,
    );
    process.env.ASK_GROK_HARNESS = "xai-api";
    await expect(executeGrok({ prompt: "review" })).rejects.toThrow(ERROR_MESSAGES.MISSING_CREDENTIALS);
    expect(mocks.cliAvailable).not.toHaveBeenCalled();
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

  it("loads the unified router for an API-only installation without probing the CLI", async () => {
    mocks.apiAvailable.mockResolvedValue(true);
    mocks.cliAvailable.mockResolvedValue(false);

    await expect(isGrokProviderAvailable()).resolves.toBe(true);
    expect(mocks.apiAvailable).toHaveBeenCalledOnce();
    expect(mocks.cliAvailable).not.toHaveBeenCalled();
  });

  it("loads the unified router for a CLI-only installation without a harness environment override", async () => {
    mocks.apiAvailable.mockResolvedValue(false);
    mocks.cliAvailable.mockResolvedValue(true);

    await expect(isGrokProviderAvailable()).resolves.toBe(true);
    expect(mocks.apiAvailable).toHaveBeenCalledOnce();
    expect(mocks.cliAvailable).toHaveBeenCalledOnce();
  });

  it("tracks an explicit ASK_GROK_HARNESS=grok-cli default instead of a stale API key", async () => {
    process.env.ASK_GROK_HARNESS = "grok-cli";
    mocks.apiAvailable.mockResolvedValue(true);
    mocks.cliAvailable.mockResolvedValue(false);

    await expect(isGrokProviderAvailable()).resolves.toBe(false);
    expect(mocks.cliAvailable).toHaveBeenCalledOnce();
    expect(mocks.apiAvailable).not.toHaveBeenCalled();
  });

  it("tracks an explicit ASK_GROK_HARNESS=xai-api default instead of a present CLI", async () => {
    process.env.ASK_GROK_HARNESS = "xai-api";
    mocks.apiAvailable.mockResolvedValue(false);
    mocks.cliAvailable.mockResolvedValue(true);

    await expect(isGrokProviderAvailable()).resolves.toBe(false);
    expect(mocks.apiAvailable).toHaveBeenCalledOnce();
    expect(mocks.cliAvailable).not.toHaveBeenCalled();
  });

  it("reports an unsupported ASK_GROK_HARNESS during discovery instead of probing a guessed transport", async () => {
    process.env.ASK_GROK_HARNESS = "automatic";
    await expect(isGrokProviderAvailable()).rejects.toThrow(/Unsupported Grok harness/);
    expect(mocks.apiAvailable).not.toHaveBeenCalled();
    expect(mocks.cliAvailable).not.toHaveBeenCalled();
  });

  it("can probe one selected harness without treating the other as fallback", async () => {
    mocks.apiAvailable.mockResolvedValue(false);
    mocks.cliAvailable.mockResolvedValue(true);

    await expect(isGrokProviderAvailable("xai-api")).resolves.toBe(false);
    expect(mocks.cliAvailable).not.toHaveBeenCalled();
    await expect(isGrokProviderAvailable("grok-cli")).resolves.toBe(true);
    expect(mocks.cliAvailable).toHaveBeenCalledOnce();
  });

  it("rejects unknown harnesses before executing either transport", async () => {
    process.env.ASK_GROK_HARNESS = "automatic";
    await expect(executeGrok({ prompt: "review" })).rejects.toThrow(/Unsupported Grok harness/);
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.cli).not.toHaveBeenCalled();
  });
});
