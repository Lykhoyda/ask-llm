import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/availability.js", () => ({
  isCommandAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock("@ask-llm/gemini-mcp/executor", () => ({
  executeGeminiCLI: vi.fn().mockResolvedValue({ response: "gemini response", sessionId: undefined }),
}));

vi.mock("@ask-llm/codex-mcp/executor", () => ({
  executeCodexCLI: vi.fn().mockResolvedValue({ response: "codex response", threadId: undefined }),
}));

vi.mock("@ask-llm/claude-mcp/executor", () => ({
  executeClaudeCLI: vi.fn().mockResolvedValue({ response: "claude response", sessionId: undefined }),
}));

vi.mock("@ask-llm/grok-mcp/executor", () => ({
  executeGrok: vi.fn().mockResolvedValue({ response: "grok response", model: "grok-4.6" }),
  isGrokProviderAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock("@ask-llm/ollama-mcp/executor", () => ({
  executeOllamaCLI: vi.fn().mockResolvedValue({ response: "ollama response", model: "qwen3.8:27b" }),
  isProviderAvailable: vi.fn().mockResolvedValue(false),
}));

vi.mock("@ask-llm/antigravity-mcp/executor", () => ({
  executeAntigravityCLI: vi.fn().mockResolvedValue({ response: "antigravity response" }),
  probeAgySupport: vi.fn(),
  assessAgyVersion: vi.fn(),
}));

import { probeAgySupport } from "@ask-llm/antigravity-mcp/executor";
import { executeClaudeCLI } from "@ask-llm/claude-mcp/executor";
import { executeCodexCLI } from "@ask-llm/codex-mcp/executor";
import { executeGeminiCLI } from "@ask-llm/gemini-mcp/executor";
import { executeGrok, isGrokProviderAvailable as mockIsGrokAvailable } from "@ask-llm/grok-mcp/executor";
import { executeOllamaCLI, isProviderAvailable as mockIsOllamaAvailable } from "@ask-llm/ollama-mcp/executor";
import { buildAskLlmSchema, detectProviders, formatProviderPing, getLoadedExecutor } from "../index.js";
import { isCommandAvailable } from "../utils/availability.js";

const mockIsCommandAvailable = vi.mocked(isCommandAvailable);
const mockProbeAgySupport = vi.mocked(probeAgySupport);
const originalClaudeCode = process.env.CLAUDECODE;

const missingAgy = {
  status: "missing" as const,
  available: false,
  detected: false,
  requiredVersion: "1.1.5",
  message: "Antigravity CLI (agy) was not found on PATH.",
  remediation: "Install agy >=1.1.5.",
};

const supportedAgy = {
  status: "supported" as const,
  available: true,
  detected: true,
  version: "1.1.5",
  requiredVersion: "1.1.5",
  message: "Antigravity CLI (agy) 1.1.5 is supported.",
};

beforeEach(() => {
  vi.resetAllMocks();
  mockIsCommandAvailable.mockResolvedValue(false);
  mockProbeAgySupport.mockResolvedValue(missingAgy);
  vi.mocked(mockIsGrokAvailable).mockResolvedValue(false);
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
  vi.mocked(executeGrok).mockResolvedValue({
    response: "grok response",
    model: "grok-4.6",
    sessionId: undefined,
    usage: {
      provider: "grok",
      model: "grok-4.6",
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      thinkingTokens: 0,
      durationMs: 1,
      fellBack: false,
    },
  });
  vi.mocked(executeOllamaCLI).mockResolvedValue({ response: "ollama response", model: "qwen3.8:27b" });
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

  it("loads Grok when either harness is ready, then preserves a request-level CLI selection", async () => {
    vi.mocked(mockIsGrokAvailable).mockResolvedValue(true);

    const status = await detectProviders();
    const executor = getLoadedExecutor("grok");

    expect(mockIsGrokAvailable).toHaveBeenCalledWith();
    expect(status.available).toContain("grok");
    expect(executor).toBeDefined();
    await executor?.({ prompt: "review", harness: "grok-cli", model: "grok-build", reasoningEffort: "high" });
    expect(executeGrok).toHaveBeenCalledWith(
      expect.objectContaining({ harness: "grok-cli", model: "grok-build", reasoningEffort: "high" }),
    );
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

    expect(status.missing).not.toContain("claude");
    expect(status.unavailable).toContainEqual(
      expect.objectContaining({ key: "claude", state: "disabled", detected: true }),
    );
    expect(mockIsCommandAvailable).not.toHaveBeenCalledWith("claude");
  });

  it("detects all when all providers are available", async () => {
    mockIsCommandAvailable.mockResolvedValue(true);
    vi.mocked(mockIsGrokAvailable).mockResolvedValue(true);
    vi.mocked(mockIsOllamaAvailable).mockResolvedValue(true);
    mockProbeAgySupport.mockResolvedValue(supportedAgy);

    const status = await detectProviders();

    expect(status.available).toEqual(["gemini", "codex", "claude", "grok", "ollama", "antigravity"]);
    expect(status.missing).toHaveLength(0);
  });

  it("surfaces a failed Grok readiness probe (e.g. unsupported ASK_GROK_HARNESS) instead of a bare missing message", async () => {
    vi.mocked(mockIsGrokAvailable).mockRejectedValue(new Error('Unsupported Grok harness "automatic"'));
    mockIsCommandAvailable.mockResolvedValue(false);

    const status = await detectProviders();

    expect(status.available).not.toContain("grok");
    expect(status.missing).toContain("grok");
    const grok = status.unavailable.find((entry) => entry.key === "grok");
    expect(grok?.state).toBe("missing");
    expect(grok?.message).toContain("ASK_GROK_HARNESS");
    expect(grok?.message).toContain('Unsupported Grok harness "automatic"');
  });

  it("reports all missing when no providers available", async () => {
    mockIsCommandAvailable.mockResolvedValue(false);
    vi.mocked(mockIsOllamaAvailable).mockResolvedValue(false);

    const status = await detectProviders();

    expect(status.available).toHaveLength(0);
    expect(status.missing).toEqual(["gemini", "codex", "claude", "grok", "ollama", "antigravity"]);
  });

  it("reports unsupported agy as detected but unavailable with upgrade details", async () => {
    mockProbeAgySupport.mockResolvedValue({
      status: "unsupported",
      available: false,
      detected: true,
      version: "1.1.4",
      requiredVersion: "1.1.5",
      message: "Antigravity CLI (agy) 1.1.4 was detected but is unsupported; agy >=1.1.5 is required.",
      remediation: "Update Antigravity CLI.",
    });

    const status = await detectProviders();

    expect(status.available).not.toContain("antigravity");
    expect(status.missing).not.toContain("antigravity");
    expect(status.unavailable).toContainEqual(
      expect.objectContaining({
        key: "antigravity",
        state: "unsupported",
        detected: true,
        version: "1.1.4",
        requiredVersion: "1.1.5",
      }),
    );
    expect(mockIsCommandAvailable).not.toHaveBeenCalledWith("agy");
  });

  it("reports unparseable and failed agy version probes as unusable", async () => {
    for (const message of [
      'Antigravity CLI (agy) version output "development build" is unparseable and unusable; agy >=1.1.5 is required.',
      "Antigravity CLI (agy) version is unknown and unusable after a failed probe; agy >=1.1.5 is required.",
    ]) {
      mockProbeAgySupport.mockResolvedValue({
        status: "unusable",
        available: false,
        detected: true,
        requiredVersion: "1.1.5",
        message,
        remediation: "Update Antigravity CLI.",
      });

      const status = await detectProviders();

      expect(status.available).not.toContain("antigravity");
      expect(status.unavailable).toContainEqual(
        expect.objectContaining({ key: "antigravity", state: "unusable", message }),
      );
    }
  });

  it("evicts an executor when a previously supported agy becomes unsupported", async () => {
    mockProbeAgySupport.mockResolvedValueOnce(supportedAgy);
    await detectProviders();
    expect(getLoadedExecutor("antigravity")).toBeDefined();

    mockProbeAgySupport.mockResolvedValueOnce({
      status: "unsupported",
      available: false,
      detected: true,
      version: "1.1.4",
      requiredVersion: "1.1.5",
      message: "Antigravity CLI (agy) 1.1.4 was detected but is unsupported; agy >=1.1.5 is required.",
      remediation: "Update Antigravity CLI.",
    });
    await detectProviders();

    expect(getLoadedExecutor("antigravity")).toBeUndefined();
  });
});

describe("provider selection and ping", () => {
  it("excludes unsupported agy when no provider was otherwise discovered", () => {
    const schema = buildAskLlmSchema([], ["antigravity"]);

    expect(schema.safeParse({ provider: "codex", prompt: "q" }).success).toBe(true);
    expect(schema.safeParse({ provider: "antigravity", prompt: "q" }).success).toBe(false);
  });

  it("keeps Grok harness selection separate and rejects it for other providers", () => {
    const schema = buildAskLlmSchema(["grok", "codex"]);

    expect(schema.safeParse({ provider: "grok", harness: "xai-api", prompt: "q" }).success).toBe(true);
    expect(schema.safeParse({ provider: "grok", harness: "grok-cli", prompt: "q" }).success).toBe(true);
    expect(schema.safeParse({ provider: "codex", harness: "grok-cli", prompt: "q" }).success).toBe(false);
  });

  it("preserves provider-native effort/include options and rejects unsupported combinations", () => {
    const schema = buildAskLlmSchema(["grok", "codex", "gemini", "ollama"]);

    expect(
      schema.safeParse({
        provider: "codex",
        prompt: "q",
        includeDirs: ["packages/core"],
        reasoningEffort: "max",
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({ provider: "grok", prompt: "q", harness: "xai-api", reasoningEffort: "xhigh" }).success,
    ).toBe(true);
    expect(schema.safeParse({ provider: "grok", prompt: "q", reasoningEffort: "max" }).success).toBe(false);
    expect(schema.safeParse({ provider: "grok", prompt: "q", includeDirs: ["packages/core"] }).success).toBe(false);
    expect(schema.safeParse({ provider: "gemini", prompt: "q", includeDirs: ["packages/core"] }).success).toBe(false);
    expect(schema.safeParse({ provider: "ollama", prompt: "q", reasoningEffort: "high" }).success).toBe(false);
    expect(schema.safeParse({ provider: "codex", prompt: "q", includeDirs: ["../outside"] }).success).toBe(false);
  });

  it("rejects includeDirs on resumed Codex sessions instead of dropping them at spawn", () => {
    const schema = buildAskLlmSchema(["codex"]);

    expect(
      schema.safeParse({ provider: "codex", prompt: "q", sessionId: "", includeDirs: ["packages/core"] }).success,
    ).toBe(true);
    const resumed = schema.safeParse({
      provider: "codex",
      prompt: "q",
      sessionId: "thread-123",
      includeDirs: ["packages/core"],
    });
    expect(resumed.success).toBe(false);
    if (!resumed.success) {
      expect(resumed.error.issues.map((issue) => issue.path.join("."))).toContain("includeDirs");
    }
    expect(schema.safeParse({ provider: "codex", prompt: "q", sessionId: "thread-123" }).success).toBe(true);
  });

  it("documents the Codex persisted-first-turn session contract", () => {
    const schema = buildAskLlmSchema(["codex"]);

    expect(schema.shape.sessionId.description).toContain('pass "" on the first call');
    expect(schema.shape.sessionId.description).toContain("omitting it makes the call ephemeral");
  });

  it("includes detected unsupported details in unified ping", () => {
    const text = formatProviderPing({
      available: ["codex"],
      missing: ["antigravity"],
      unavailable: [
        {
          key: "antigravity",
          provider: "Antigravity",
          state: "unsupported",
          detected: true,
          version: "1.1.4",
          requiredVersion: "1.1.5",
          message: "Antigravity CLI (agy) 1.1.4 was detected but is unsupported; agy >=1.1.5 is required.",
          remediation: "Update Antigravity CLI.",
        },
      ],
    });

    expect(text).toContain("Available providers: codex");
    expect(text).toContain("1.1.4 was detected but is unsupported");
    expect(text).toContain("agy >=1.1.5 is required");
    expect(text).toContain("Update Antigravity CLI");
  });
});
