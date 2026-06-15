import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/availability.js", () => ({
  isCommandAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock("ask-gemini-mcp/executor", () => ({
  executeGeminiCLI: vi.fn().mockResolvedValue({ response: "gemini response", sessionId: undefined }),
}));

vi.mock("ask-codex-mcp/executor", () => ({
  executeCodexCLI: vi.fn().mockResolvedValue({ response: "codex response", threadId: undefined }),
}));

vi.mock("ask-ollama-mcp/executor", () => ({
  executeOllamaCLI: vi.fn().mockResolvedValue({ response: "ollama response", model: "qwen3.6:27b" }),
  isProviderAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock("ask-antigravity-mcp/executor", () => ({
  executeAntigravityCLI: vi.fn().mockResolvedValue({ response: "antigravity response" }),
}));

import { executeCodexCLI } from "ask-codex-mcp/executor";
import { executeGeminiCLI } from "ask-gemini-mcp/executor";
import { executeOllamaCLI, isProviderAvailable as mockIsOllamaAvailable } from "ask-ollama-mcp/executor";
import { detectProviders } from "../index.js";
import { isCommandAvailable } from "../utils/availability.js";

const mockIsCommandAvailable = vi.mocked(isCommandAvailable);

beforeEach(() => {
  vi.resetAllMocks();
  mockIsCommandAvailable.mockResolvedValue(false);
  vi.mocked(mockIsOllamaAvailable).mockResolvedValue(false);
  vi.mocked(executeGeminiCLI).mockResolvedValue({ response: "gemini response", sessionId: undefined });
  vi.mocked(executeCodexCLI).mockResolvedValue({ response: "codex response", threadId: undefined });
  vi.mocked(executeOllamaCLI).mockResolvedValue({ response: "ollama response", model: "qwen3.6:27b" });
});

describe("detectProviders", () => {
  it("detects gemini when gemini CLI is available", async () => {
    mockIsCommandAvailable.mockImplementation(async (cmd) => cmd === "gemini");

    const status = await detectProviders();

    expect(status.available).toContain("gemini");
    expect(status.missing).toContain("codex");
    expect(status.missing).toContain("ollama");
  });

  it("detects codex when codex CLI is available", async () => {
    mockIsCommandAvailable.mockImplementation(async (cmd) => cmd === "codex");

    const status = await detectProviders();

    expect(status.available).toContain("codex");
    expect(status.missing).toContain("gemini");
    expect(status.missing).toContain("ollama");
  });

  it("detects ollama when server is running", async () => {
    vi.mocked(mockIsOllamaAvailable).mockResolvedValue(true);

    const status = await detectProviders();

    expect(status.available).toContain("ollama");
    expect(status.missing).toContain("gemini");
    expect(status.missing).toContain("codex");
  });

  it("detects all when all providers are available", async () => {
    mockIsCommandAvailable.mockResolvedValue(true);
    vi.mocked(mockIsOllamaAvailable).mockResolvedValue(true);

    const status = await detectProviders();

    expect(status.available).toEqual(["gemini", "codex", "ollama", "antigravity"]);
    expect(status.missing).toHaveLength(0);
  });

  it("reports all missing when no providers available", async () => {
    mockIsCommandAvailable.mockResolvedValue(false);
    vi.mocked(mockIsOllamaAvailable).mockResolvedValue(false);

    const status = await detectProviders();

    expect(status.available).toHaveLength(0);
    expect(status.missing).toEqual(["gemini", "codex", "ollama", "antigravity"]);
  });
});
