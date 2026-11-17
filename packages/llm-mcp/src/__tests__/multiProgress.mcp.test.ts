import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../utils/availability.js", () => ({
  isCommandAvailable: vi.fn(async (command) => command === "codex"),
}));
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../utils/providerModules.js", () => ({
  loadProviderModule: vi.fn(async () => ({
    executeCodexCLI: execute,
    isProviderAvailable: async () => false,
    isGrokProviderAvailable: async () => false,
    probeAgySupport: async () => ({ status: "missing", detected: false }),
  })),
}));
vi.mock("../utils/providerSpecs.js", () => ({ buildProviderSpecs: async () => [] }));

import { createAskLlmServer, detectProviders } from "../index.js";

afterEach(() => vi.useRealTimers());

it.each([true, false])("sends start, keepalive and terminal progress for multi-llm (success=%s)", async (success) => {
  let finish!: () => void;
  execute.mockImplementation(async ({ onProgress }) => {
    onProgress?.("provider is thinking");
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    if (!success) throw new Error("provider failed");
    return { response: "review complete" };
  });
  const server = await createAskLlmServer(await detectProviders());
  const client = new Client({ name: "multi-progress", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const progress: Array<{ progress: number; message?: string }> = [];
  try {
    await client.listTools();
    vi.useFakeTimers();
    const result = client.callTool(
      { name: "multi-llm", arguments: { prompt: "review", providers: ["codex"] } },
      undefined,
      { onprogress: (value) => progress.push(value) },
    );
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await vi.advanceTimersByTimeAsync(25000);
    finish();
    const report = await result;
    expect(report.isError).not.toBe(true);
    expect(report.structuredContent).toMatchObject({ failureCount: success ? 0 : 1 });
    expect(progress).toEqual([
      expect.objectContaining({ progress: 0, message: "Starting multi-llm" }),
      expect.objectContaining({ progress: 1, message: expect.stringContaining("[codex] provider is thinking") }),
      expect.objectContaining({ progress: 100, message: success ? "multi-llm completed" : "multi-llm failed" }),
    ]);
    await vi.advanceTimersByTimeAsync(25000);
    expect(progress).toHaveLength(3);
  } finally {
    vi.useRealTimers();
    await client.close();
    await server.close();
  }
});
