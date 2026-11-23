import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Pi loads the package's built entry; point it at the same source the MCP side uses.
vi.mock("@ask-llm/mcp", async () => await import("../index.js"));

vi.mock("../utils/availability.js", () => ({ isCommandAvailable: vi.fn() }));
vi.mock("@ask-llm/codex-mcp/executor", () => ({ executeCodexCLI: vi.fn() }));
vi.mock("@ask-llm/gemini-mcp/executor", () => ({ executeGeminiCLI: vi.fn() }));
vi.mock("@ask-llm/claude-mcp/executor", () => ({ executeClaudeCLI: vi.fn() }));
vi.mock("@ask-llm/grok-mcp/executor", () => ({ executeGrok: vi.fn(), isGrokProviderAvailable: vi.fn() }));
vi.mock("@ask-llm/ollama-mcp/executor", () => ({ executeOllamaCLI: vi.fn(), isProviderAvailable: vi.fn() }));
vi.mock("@ask-llm/antigravity-mcp/executor", () => ({
  executeAntigravityCLI: vi.fn(),
  probeAgySupport: vi.fn(),
  assessAgyVersion: vi.fn(),
}));

import { probeAgySupport } from "@ask-llm/antigravity-mcp/executor";
import { executeCodexCLI } from "@ask-llm/codex-mcp/executor";
import { executeGeminiCLI } from "@ask-llm/gemini-mcp/executor";
import { isGrokProviderAvailable } from "@ask-llm/grok-mcp/executor";
import { isProviderAvailable as isOllamaAvailable } from "@ask-llm/ollama-mcp/executor";
import { registerProviderTools } from "../../pi/extensions/provider-tools.js";
import {
  HOST_PARITY,
  MCP_ONLY_TOOLS,
  PARITY_HOSTS,
  PI_DEPRECATED_ALIASES,
  PI_ONLY_TOOLS,
  renderParityTable,
  SHARED_TOOLS,
} from "../hosts/parity.js";
import { hostSpecs } from "../hosts/registry.js";
import { createAskLlmServer, detectProviders, type ProviderStatus } from "../index.js";
import { isCommandAvailable } from "../utils/availability.js";

interface ToolContract {
  name: string;
  inputSchema: Record<string, unknown>;
}

interface PiTool {
  name: string;
  parameters: Record<string, unknown>;
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;
}

const originalClaudeCode = process.env.CLAUDECODE;

async function connectMcp(status: ProviderStatus) {
  const server = await createAskLlmServer(status);
  const client = new Client({ name: "host-parity", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

async function mcpContracts(): Promise<ToolContract[]> {
  const { client, close } = await connectMcp(await detectProviders());
  try {
    return (await client.listTools()).tools.map(({ name, inputSchema }) => ({ name, inputSchema }));
  } finally {
    await close();
  }
}

async function piTools(): Promise<PiTool[]> {
  const tools: PiTool[] = [];
  await registerProviderTools({ registerTool: (tool: PiTool) => tools.push(tool) } as never);
  return tools;
}

function divergences(mcp: ToolContract[], pi: ToolContract[]): string[] {
  const found: string[] = [];
  const mcpNames = mcp.map((tool) => tool.name).sort();
  const piNames = pi.map((tool) => tool.name).sort();
  const expectedMcp = [...SHARED_TOOLS, ...MCP_ONLY_TOOLS].sort();
  const expectedPi = [...SHARED_TOOLS, ...PI_ONLY_TOOLS, ...PI_DEPRECATED_ALIASES].sort();
  if (JSON.stringify(mcpNames) !== JSON.stringify(expectedMcp)) found.push(`MCP tools: ${mcpNames.join(", ")}`);
  if (JSON.stringify(piNames) !== JSON.stringify(expectedPi)) found.push(`Pi tools: ${piNames.join(", ")}`);
  for (const name of SHARED_TOOLS) {
    const left = mcp.find((tool) => tool.name === name)?.inputSchema;
    const right = pi.find((tool) => tool.name === name)?.inputSchema;
    if (!left || !isDeepStrictEqual(left, right)) found.push(`${name} input schema`);
  }
  return found;
}

async function piContracts(): Promise<ToolContract[]> {
  return (await piTools()).map(({ name, parameters }) => ({ name, inputSchema: parameters }));
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.CLAUDECODE;
  vi.mocked(isCommandAvailable).mockImplementation(async (command) => command === "codex" || command === "gemini");
  vi.mocked(isGrokProviderAvailable).mockResolvedValue(false);
  vi.mocked(isOllamaAvailable).mockResolvedValue(false);
  vi.mocked(probeAgySupport).mockResolvedValue({
    status: "missing",
    available: false,
    detected: false,
    requiredVersion: "1.1.5",
    message: "Antigravity CLI (agy) was not found on PATH.",
  });
});

afterEach(() => {
  if (originalClaudeCode === undefined) delete process.env.CLAUDECODE;
  else process.env.CLAUDECODE = originalClaudeCode;
});

describe("MCP and Pi tool contract", () => {
  it("exposes the declared tool names with identical input schemas", async () => {
    expect(divergences(await mcpContracts(), await piContracts())).toEqual([]);
  });

  it("matches both enums and descriptions when only Codex is detected", async () => {
    vi.mocked(isCommandAvailable).mockImplementation(async (command) => command === "codex");
    const mcp = await mcpContracts();
    const pi = await piContracts();
    expect(divergences(mcp, pi)).toEqual([]);
    expect(mcp.find((tool) => tool.name === "ask-llm")?.inputSchema).toMatchObject({
      properties: { noFallback: { type: "boolean" } },
    });
    expect(pi.find((tool) => tool.name === "ask-llm")?.inputSchema).toMatchObject({
      properties: { provider: { enum: ["codex"] } },
    });
    expect(pi.find((tool) => tool.name === "multi-llm")?.inputSchema).toMatchObject({
      properties: { providers: { items: { enum: ["codex"] } } },
    });
  });

  it("matches when all eligible providers are detected", async () => {
    vi.mocked(isCommandAvailable).mockResolvedValue(true);
    vi.mocked(isGrokProviderAvailable).mockResolvedValue(true);
    vi.mocked(isOllamaAvailable).mockResolvedValue(true);
    vi.mocked(probeAgySupport).mockResolvedValue({
      status: "supported",
      available: true,
      detected: true,
      requiredVersion: "1.1.5",
      message: "supported",
    });
    expect(divergences(await mcpContracts(), await piContracts())).toEqual([]);
  });

  it.each(["missing", "unsupported", "unusable"] as const)(
    "matches with no available providers and agy %s",
    async (status) => {
      vi.mocked(isCommandAvailable).mockResolvedValue(false);
      vi.mocked(probeAgySupport).mockResolvedValue({
        status,
        available: false,
        detected: status !== "missing",
        requiredVersion: "1.1.5",
        message: status,
      });
      expect(divergences(await mcpContracts(), await piContracts())).toEqual([]);
    },
  );

  it("holds when the host hides the Claude provider", async () => {
    process.env.CLAUDECODE = "1";
    expect(divergences(await mcpContracts(), await piContracts())).toEqual([]);
  });

  it("reports a renamed tool, a missing tool and a changed field", async () => {
    const mcp = await mcpContracts();
    const pi = await piContracts();
    const renamed = pi.map((tool) => (tool.name === "multi-llm" ? { ...tool, name: "multi_llm" } : tool));
    expect(divergences(mcp, renamed)).toEqual([expect.stringContaining("Pi tools"), "multi-llm input schema"]);
    expect(divergences(mcp.slice(1), pi)).toContain(`${mcp[0].name} input schema`);
    const askLlm = pi.find((tool) => tool.name === "ask-llm") as ToolContract;
    const properties = askLlm.inputSchema.properties as Record<string, Record<string, unknown>>;
    const changed = { ...askLlm, inputSchema: { ...askLlm.inputSchema, properties: { ...properties, sandbox: {} } } };
    expect(divergences(mcp, [...pi.filter((tool) => tool.name !== "ask-llm"), changed])).toEqual([
      "ask-llm input schema",
    ]);
  });

  it.each(["FAKE_CODEX", "x".repeat(70_000)])("returns the same Codex AskResponse (case %#)", async (response) => {
    const usage = {
      provider: "codex" as const,
      model: "gpt-6.2-astra",
      inputTokens: 3,
      durationMs: 7,
      fellBack: false,
    };
    vi.mocked(executeCodexCLI).mockResolvedValue({
      response,
      threadId: "thread-1",
      usage,
      attempt: { model: "gpt-6.2-astra", reasoningEffort: "high", cached: false },
    });
    const { client, close } = await connectMcp(await detectProviders());
    const args = {
      provider: "codex",
      prompt: "review this",
      model: "gpt-6.2-astra",
      reasoningEffort: "high",
      sandbox: "read-only",
      noFallback: true,
    };
    let viaMcp: Awaited<ReturnType<typeof client.callTool>>;
    try {
      viaMcp = await client.callTool({ name: "ask-llm", arguments: args });
    } finally {
      await close();
    }
    const viaPi = await ((await piTools()).find((tool) => tool.name === "ask-llm") as PiTool).execute("call", args);

    expect(viaMcp.isError).toBe(false);
    expect(viaMcp.structuredContent).toEqual({
      provider: "codex",
      response,
      model: "gpt-6.2-astra",
      sessionId: "thread-1",
      reasoningEffort: "high",
      usage,
    });
    expect(viaPi.details.structuredContent).toEqual(viaMcp.structuredContent);
    expect(viaPi.content[0].text.split("\n")[0]).toBe(
      "Codex CLI · selected gpt-6.2-astra · reasoning effort configured high",
    );
    if (response.length > 50_000) {
      expect(viaPi.details.outputTruncated).toBe(true);
      expect(viaPi.content[0].text.length).toBeLessThan(response.length);
      expect(viaPi.content[0].text).toContain("[Output truncated");
    } else {
      expect(viaPi.content).toEqual(viaMcp.content);
      expect(viaPi.details.outputTruncated).toBe(false);
    }
    const [mcpOptions, piOptions] = vi
      .mocked(executeCodexCLI)
      .mock.calls.map(([{ onProgress: _progress, signal: _signal, ...options }]) => options);
    expect(piOptions).toEqual(mcpOptions);
    expect(mcpOptions).toMatchObject({
      prompt: "review this",
      reasoningEffort: "high",
      sandbox: "read-only",
      singleAttempt: true,
      strictOutcome: true,
    });
  });

  it.each(["FAKE_CODEX", "x".repeat(70_000)])(
    "returns the same default multi-llm report (case %#)",
    async (response) => {
      vi.mocked(executeCodexCLI).mockResolvedValue({
        response,
        threadId: undefined,
        usage: undefined,
        attempt: { model: "gpt-6.1-terra", reasoningEffort: "xhigh", cached: false },
      });
      vi.mocked(executeGeminiCLI).mockRejectedValue(new Error("gemini quota"));
      const { client, close } = await connectMcp(await detectProviders());
      let viaMcp: Awaited<ReturnType<typeof client.callTool>>;
      try {
        viaMcp = await client.callTool({
          name: "multi-llm",
          arguments: { prompt: "same", providers: ["codex", "gemini"] },
        });
      } finally {
        await close();
      }
      const viaPi = await ((await piTools()).find((tool) => tool.name === "multi-llm") as PiTool).execute("call", {
        prompt: "same",
        providers: ["codex", "gemini"],
      });

      const strip = (report: unknown) => {
        const { dispatchedAt: _at, totalDurationMs: _total, results, ...rest } = report as Record<string, unknown>;
        return {
          ...rest,
          results: (results as Array<Record<string, unknown>>).map(({ durationMs: _ms, ...result }) => result),
        };
      };
      expect(strip(viaMcp.structuredContent)).toEqual({
        successCount: 1,
        failureCount: 1,
        results: [
          { provider: "codex", ok: true, response, model: "gpt-6.1-terra", reasoningEffort: "xhigh" },
          { provider: "gemini", ok: false, error: "gemini quota" },
        ],
      });
      expect(viaMcp.isError).toBe(false);
      expect(strip(viaPi.details.structuredContent)).toEqual(strip(viaMcp.structuredContent));
      expect(viaPi.content[0].text).toMatch(
        /### codex ✓ \([^\n]*selected gpt-6\.1-terra · reasoning effort configured xhigh/,
      );
      expect(viaMcp.content[0]).toMatchObject({ text: expect.stringContaining("reasoning effort configured xhigh") });
      for (const [options] of vi.mocked(executeCodexCLI).mock.calls) {
        expect(Object.keys(options).sort()).toEqual(["onProgress", "prompt", "signal"]);
      }
      expect(viaPi.details.outputTruncated).toBe(response.length > 50_000);
      if (response.length > 50_000) expect(viaPi.content[0].text.length).toBeLessThan(response.length);
    },
  );

  it.each([
    { provider: "gemini", noFallback: false },
    { provider: "codex", sandbox: "workspace-write", noFallback: true },
  ])("rejects noFallback outside read-only Codex (%j)", async (args) => {
    const { client, close } = await connectMcp(await detectProviders());
    try {
      expect(await client.callTool({ name: "ask-llm", arguments: { ...args, prompt: "review" } })).toMatchObject({
        isError: true,
        content: [expect.objectContaining({ text: expect.stringContaining("noFallback") })],
      });
    } finally {
      await close();
    }
    const pi = (await piTools()).find((tool) => tool.name === "ask-llm") as PiTool;
    await expect(pi.execute("call", { ...args, prompt: "review" })).rejects.toThrow("noFallback");
    expect(executeCodexCLI).not.toHaveBeenCalled();
    expect(executeGeminiCLI).not.toHaveBeenCalled();
  });

  it("rejects an undetected provider in both hosts", async () => {
    const { client, close } = await connectMcp(await detectProviders());
    try {
      const result = await client.callTool({ name: "ask-llm", arguments: { provider: "ollama", prompt: "x" } });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
    await expect(
      ((await piTools()).find((tool) => tool.name === "ask-llm") as PiTool).execute("call", {
        provider: "ollama",
        prompt: "x",
      }),
    ).rejects.toThrow();
  });
});

describe("host parity matrix", () => {
  it("has a column for every host setup knows and a cell for every row", () => {
    expect(PARITY_HOSTS.map((host) => host.id).sort()).toEqual(
      hostSpecs({ HOME: "/home/user" })
        .map((spec) => spec.id)
        .sort(),
    );
    for (const cells of Object.values(HOST_PARITY)) {
      for (const { id } of PARITY_HOSTS) expect(cells[id]).toMatch(/\S/);
    }
  });

  it("is the table published in docs/HOST-PARITY.md", () => {
    const doc = readFileSync(new URL("../../../../docs/HOST-PARITY.md", import.meta.url), "utf8");
    const published = doc.split(/<!-- HOST-PARITY:(?:START[^>]*|END) -->/)[1]?.trim();
    expect(published).toBe(renderParityTable());
  });
});
