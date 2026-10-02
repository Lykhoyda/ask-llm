import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  codex: vi.fn(),
  gemini: vi.fn(),
  grok: vi.fn(),
  ollama: vi.fn(),
  antigravity: vi.fn(),
  cursor: vi.fn(),
}));

// Pi loads the package's built entry; point it at the source under test.
vi.mock("@ask-llm/mcp", async () => ({
  ...(await import("../index.js")),
  detectProviders: vi.fn(async () => ({ available: ["codex", "gemini"], missing: [], unavailable: [] })),
}));
vi.mock("@ask-llm/mcp/providers/codex/register", () => ({ executeTool: calls.codex }));
vi.mock("@ask-llm/mcp/providers/gemini/register", () => ({ executeTool: calls.gemini }));
vi.mock("@ask-llm/mcp/providers/grok/register", () => ({ executeTool: calls.grok }));
vi.mock("@ask-llm/mcp/providers/ollama/register", () => ({ executeTool: calls.ollama }));
vi.mock("@ask-llm/mcp/providers/antigravity/register", () => ({ executeTool: calls.antigravity }));
vi.mock("@ask-llm/mcp/cursor", () => ({
  executeCursorAgent: calls.cursor,
  CURSOR_PROVIDERS: ["claude", "codex", "gemini", "grok"],
}));

import { registerProviderTools } from "../../pi/extensions/provider-tools.js";

interface RegisteredTool {
  name: string;
  parameters: { properties?: Record<string, unknown> };
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (value: unknown) => void,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;
}

async function harness() {
  const tools: RegisteredTool[] = [];
  await registerProviderTools({ registerTool: (tool: RegisteredTool) => tools.push(tool) } as never);
  return { tools, byName: (name: string) => tools.find((tool) => tool.name === name) as RegisteredTool };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const [provider, fn] of Object.entries(calls)) {
    fn.mockResolvedValue({
      text: `${provider} response`,
      structuredContent: { provider, response: `${provider} response`, model: "fixture" },
    });
  }
});

describe("Pi provider tools", () => {
  it("registers the unified tools, the Cursor harness, and the deprecated provider aliases", async () => {
    const { tools } = await harness();
    expect(tools.map((tool) => tool.name)).toEqual([
      "ask-llm",
      "multi-llm",
      "ask-cursor-agent",
      "ask-codex",
      "ask-gemini",
      "ask-grok",
      "ask-ollama",
      "ask-antigravity",
      "ask-multi",
    ]);
  });

  it("exposes every skill-required provider parameter", async () => {
    const { byName } = await harness();
    expect(Object.keys(byName("ask-codex").parameters.properties ?? {})).toEqual([
      "prompt",
      "model",
      "reasoningEffort",
      "sessionId",
      "includeDirs",
      "preferred",
      "sandbox",
    ]);
    expect(Object.keys(byName("ask-gemini").parameters.properties ?? {})).toEqual(["prompt", "model", "sessionId"]);
    expect(Object.keys(byName("ask-grok").parameters.properties ?? {})).toEqual([
      "prompt",
      "model",
      "harness",
      "reasoningEffort",
    ]);
    expect(Object.keys(byName("ask-cursor-agent").parameters.properties ?? {})).toEqual([
      "provider",
      "model",
      "prompt",
      "includeDirs",
      "sessionId",
    ]);
    expect(byName("ask-cursor-agent").parameters.properties?.provider).toMatchObject({
      enum: ["claude", "codex", "gemini", "grok"],
    });
    expect(Object.keys(byName("ask-ollama").parameters.properties ?? {})).toEqual(["prompt", "model", "sessionId"]);
    expect(Object.keys(byName("ask-antigravity").parameters.properties ?? {})).toEqual(["prompt", "includeDirs"]);
  });

  it("keeps Cursor harness, provider, and model attribution separate", async () => {
    calls.cursor.mockResolvedValue({
      response: "cursor result",
      provider: "grok",
      model: "grok-4.7-high",
      reportedModel: "Grok 4.7",
      harness: "cursor-agent",
      sessionId: "cursor-session",
      usage: { provider: "grok", model: "grok-4.7-high", fellBack: false },
    });
    const controller = new AbortController();
    const result = await (await harness())
      .byName("ask-cursor-agent")
      .execute("call", { prompt: "review", provider: "grok", model: "grok-4.7-high" }, controller.signal);

    expect(calls.cursor).toHaveBeenCalledWith({
      prompt: "review",
      provider: "grok",
      model: "grok-4.7-high",
      includeDirs: undefined,
      sessionId: undefined,
      signal: controller.signal,
      onProgress: undefined,
    });
    expect(result.details).toMatchObject({
      provider: "grok",
      harness: "cursor-agent",
      model: "grok-4.7-high",
      reportedModel: "Grok 4.7",
      sessionId: "cursor-session",
      askLlmUsage: { fellBack: false },
    });
  });

  it("uses the canonical executeTool contract, forwards cancellation, and keeps raw usage in details", async () => {
    calls.codex.mockImplementation(async (_name, _args, _progress, usage) => {
      usage({ provider: "codex", inputTokens: 2 });
      return { text: "ok", structuredContent: { provider: "codex", response: "ok" } };
    });
    const controller = new AbortController();
    const result = await (await harness())
      .byName("ask-codex")
      .execute("call", { prompt: "review", sandbox: "read-only" }, controller.signal);
    expect(calls.codex).toHaveBeenCalledWith(
      "ask-codex",
      { prompt: "review", sandbox: "read-only" },
      undefined,
      expect.any(Function),
      controller.signal,
    );
    expect(result.details.askLlmUsage).toEqual({ provider: "codex", inputTokens: 2 });
    expect(result.details).not.toHaveProperty("usage");
  });

  it("throws canonical provider failures so Pi marks the tool result as an error", async () => {
    calls.gemini.mockRejectedValue(new Error("gemini CLI not found on PATH"));
    await expect((await harness()).byName("ask-gemini").execute("call", { prompt: "review" })).rejects.toThrow(
      "gemini CLI not found on PATH",
    );
  });

  it("ask-multi starts providers concurrently and returns stable input order with explicit partial failures", async () => {
    let releaseCodex!: () => void;
    let releaseOllama!: () => void;
    const codexStarted = new Promise<void>((resolve) =>
      calls.codex.mockImplementation(() => {
        resolve();
        return new Promise((done) => {
          releaseCodex = () => done({ text: "codex ok", structuredContent: { provider: "codex" } });
        });
      }),
    );
    const ollamaStarted = new Promise<void>((resolve) =>
      calls.ollama.mockImplementation(() => {
        resolve();
        return new Promise((_, reject) => {
          releaseOllama = () => reject(new Error("model missing; ollama pull fixture"));
        });
      }),
    );

    const pending = (await harness())
      .byName("ask-multi")
      .execute("multi", {
        prompt: "same bytes",
        providers: ["ollama", "codex"],
      });
    await Promise.all([codexStarted, ollamaStarted]);
    releaseCodex();
    releaseOllama();
    const result = await pending;

    expect(calls.ollama.mock.calls[0][1]).toEqual({ prompt: "same bytes" });
    expect(calls.codex.mock.calls[0][1]).toEqual({ prompt: "same bytes" });
    const records = result.details.results as Array<{ provider: string; status: string; error?: string }>;
    expect(records.map((record) => record.provider)).toEqual(["ollama", "codex"]);
    expect(records[0]).toMatchObject({ status: "rejected", error: expect.stringContaining("ollama pull") });
    expect(records[1]).toMatchObject({ status: "fulfilled" });
  });

  it.each(["codex", "gemini", "grok", "ollama", "antigravity"] as const)(
    "preserves complete %s structured responses in both deprecated routes",
    async (provider) => {
      const structuredContent = { provider, response: "x".repeat(70_000), model: "fixture" };
      calls[provider].mockResolvedValue({ text: structuredContent.response, structuredContent });
      const { byName } = await harness();
      const direct = await byName(`ask-${provider}`).execute("call", { prompt: "review" });
      expect(direct.details.structuredContent).toEqual(structuredContent);
      expect(direct.details.outputTruncated).toBe(true);
      expect(direct.content[0].text.length).toBeLessThan(structuredContent.response.length);
      const multi = await byName("ask-multi").execute("call", {
        prompt: "review",
        providers: [provider, provider === "codex" ? "gemini" : "codex"],
      });
      expect(multi.details.results).toEqual([
        expect.objectContaining({ provider, details: expect.objectContaining({ structuredContent }) }),
        expect.anything(),
      ]);
      expect(multi.content[0].text.length).toBeLessThan(structuredContent.response.length);
    },
  );

  it("rejects duplicate providers instead of dispatching twice", async () => {
    await expect(
      (await harness())
        .byName("ask-multi")
        .execute("multi", {
          prompt: "review",
          providers: ["codex", "codex"],
        }),
    ).rejects.toThrow("must be unique");
  });
});
