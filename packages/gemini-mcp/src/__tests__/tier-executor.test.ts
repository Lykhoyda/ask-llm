import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock only executeCommand from the shared package; keep everything else real.
vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return { ...actual, executeCommand: vi.fn() };
});

import { executeCommand } from "@ask-llm/shared";
import { TIER_NOTE_MARKER } from "../constants.js";
import { executeGeminiCLI } from "../utils/geminiExecutor.js";

const mockExec = vi.mocked(executeCommand);
const KEY = "ASK_GEMINI_TIER_CUTOFF";

function quotaError() {
  return new Error("ApiError: status RESOURCE_EXHAUSTED — quota exhausted");
}
function authError() {
  return new Error("GaxiosError: 403 PERMISSION_DENIED — caller does not have permission");
}
function timeoutError() {
  return new Error("Command timed out after 800000ms");
}

describe("executeGeminiCLI tier enrichment (#140)", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });
  afterEach(() => {
    delete process.env[KEY];
  });

  it("pre-cutoff quota still triggers the Flash fallback (unchanged)", async () => {
    process.env[KEY] = "2099-01-01T00:00:00Z"; // pre-cutoff
    mockExec.mockRejectedValueOnce(quotaError()); // Pro
    mockExec.mockRejectedValueOnce(quotaError()); // Flash
    await expect(executeGeminiCLI({ prompt: "hi" })).rejects.toThrow(/fallback also failed/);
    expect(mockExec).toHaveBeenCalledTimes(2); // Pro + Flash
  });

  it("post-cutoff: Pro quota + Flash quota → note appears once, after Flash retry", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z"; // post-cutoff
    mockExec.mockRejectedValueOnce(quotaError()); // Pro
    mockExec.mockRejectedValueOnce(quotaError()); // Flash
    await expect(executeGeminiCLI({ prompt: "hi" })).rejects.toThrow(TIER_NOTE_MARKER);
    expect(mockExec).toHaveBeenCalledTimes(2);
    mockExec.mockRejectedValueOnce(quotaError());
    mockExec.mockRejectedValueOnce(quotaError());
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message.split(TIER_NOTE_MARKER).length - 1).toBe(1); // marker once
  });

  it("post-cutoff: Pro quota + Flash TIMEOUT → no note (operational Flash failure)", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    mockExec.mockRejectedValueOnce(quotaError()); // Pro
    mockExec.mockRejectedValueOnce(timeoutError()); // Flash
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message).not.toContain(TIER_NOTE_MARKER);
  });

  it("post-cutoff: raw auth (403) → note AND no Flash fallback invoked", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    mockExec.mockRejectedValueOnce(authError()); // Pro (auth, not quota)
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message).toContain(TIER_NOTE_MARKER);
    expect(mockExec).toHaveBeenCalledTimes(1); // NO Flash retry for auth
  });

  it("post-cutoff: raw timeout → no note", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    mockExec.mockRejectedValueOnce(timeoutError()); // Pro
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message).not.toContain(TIER_NOTE_MARKER);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("workspace-trust error is unchanged even post-cutoff (no note, no Flash retry)", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    mockExec.mockRejectedValueOnce(
      new Error("FatalUntrustedWorkspaceError: not running in a trusted directory"),
    );
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message).toMatch(/workspace-trust/i); // ERROR_MESSAGES.WORKSPACE_TRUST_REQUIRED
    expect(err.message).not.toContain(TIER_NOTE_MARKER);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});
