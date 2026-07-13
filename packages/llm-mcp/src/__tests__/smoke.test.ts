import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/availability.js", () => ({
  isCommandAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock("ask-gemini-mcp/executor", () => ({
  executeGeminiCLI: vi.fn().mockResolvedValue({ response: "gemini response", sessionId: undefined }),
}));

vi.mock("ask-codex-mcp/executor", () => ({
  executeCodexCLI: vi.fn().mockResolvedValue({ response: "codex response", threadId: undefined }),
}));

vi.mock("@anton-lykhoyda/ask-claude-mcp/executor", () => ({
  executeClaudeCLI: vi.fn().mockResolvedValue({ response: "claude response", sessionId: undefined }),
}));

vi.mock("ask-ollama-mcp/executor", () => ({
  executeOllamaCLI: vi.fn().mockResolvedValue({ response: "ollama response", model: "qwen3.6:27b" }),
  isProviderAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock("ask-antigravity-mcp/executor", () => ({
  executeAntigravityCLI: vi.fn().mockResolvedValue({ response: "antigravity response" }),
}));

import { executeClaudeCLI } from "@anton-lykhoyda/ask-claude-mcp/executor";
import { executeCodexCLI } from "ask-codex-mcp/executor";
import { executeGeminiCLI } from "ask-gemini-mcp/executor";
import { executeOllamaCLI, isProviderAvailable as mockIsOllamaAvailable } from "ask-ollama-mcp/executor";
import { detectProviders } from "../index.js";
import { isCommandAvailable } from "../utils/availability.js";

const mockIsCommandAvailable = vi.mocked(isCommandAvailable);
const originalClaudeCode = process.env.CLAUDECODE;

beforeEach(() => {
  vi.resetAllMocks();
  mockIsCommandAvailable.mockResolvedValue(false);
  vi.mocked(mockIsOllamaAvailable).mockResolvedValue(false);
  vi.mocked(executeGeminiCLI).mockResolvedValue({ response: "gemini response", sessionId: undefined });
  vi.mocked(executeCodexCLI).mockResolvedValue({ response: "codex response", threadId: undefined });
  vi.mocked(executeClaudeCLI).mockResolvedValue({
    response: "claude response",
    model: "claude-opus-4-6",
    sessionId: undefined,
    usage: {
      provider: "claude",
      model: "claude-opus-4-6",
      inputTokens: undefined,
      outputTokens: undefined,
      cachedTokens: undefined,
      thinkingTokens: undefined,
      durationMs: 1,
      fellBack: false,
    },
  });
  vi.mocked(executeOllamaCLI).mockResolvedValue({ response: "ollama response", model: "qwen3.6:27b" });
  delete process.env.CLAUDECODE;
});

afterEach(() => {
  if (originalClaudeCode === undefined) delete process.env.CLAUDECODE;
  else process.env.CLAUDECODE = originalClaudeCode;
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

  it("detects Claude when Claude Code CLI is available", async () => {
    mockIsCommandAvailable.mockImplementation(async (cmd) => cmd === "claude");

    const status = await detectProviders();

    expect(status.available).toContain("claude");
    expect(status.missing).toContain("codex");
  });

  it("suppresses Claude without probing it when Claude Code is the MCP host", async () => {
    process.env.CLAUDECODE = "1";
    mockIsCommandAvailable.mockResolvedValue(true);

    const status = await detectProviders();

    expect(status.missing).toContain("claude");
    expect(mockIsCommandAvailable).not.toHaveBeenCalledWith("claude");
  });

  it("detects all when all providers are available", async () => {
    mockIsCommandAvailable.mockResolvedValue(true);
    vi.mocked(mockIsOllamaAvailable).mockResolvedValue(true);

    const status = await detectProviders();

    expect(status.available).toEqual(["gemini", "codex", "claude", "ollama", "antigravity"]);
    expect(status.missing).toHaveLength(0);
  });

  it("reports all missing when no providers available", async () => {
    mockIsCommandAvailable.mockResolvedValue(false);
    vi.mocked(mockIsOllamaAvailable).mockResolvedValue(false);

    const status = await detectProviders();

    expect(status.available).toHaveLength(0);
    expect(status.missing).toEqual(["gemini", "codex", "claude", "ollama", "antigravity"]);
  });
});
