import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { askResponseSchema, SERVER_INSTRUCTIONS } from "@ask-llm/shared";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ProgressNotificationSchema } from "@modelcontextprotocol/sdk-v1/types.js";
import { Client as LegacyClient } from "@modelcontextprotocol/sdk-v1/client/index.js";
import { StdioClientTransport as LegacyTransport } from "@modelcontextprotocol/sdk-v1/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const sandbox = mkdtempSync(join(tmpdir(), "ask-llm-stdio-"));
const emptyBin = join(sandbox, "bin");
mkdirSync(emptyBin);
const requests: string[] = [];
const provider = createServer((request, response) => {
  requests.push(request.url ?? "");
  request.resume();
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/api/tags") {
    response.end(JSON.stringify({ models: [{ name: "fixture-model" }] }));
  } else if (request.url === "/api/chat") {
    response.end(
      JSON.stringify({
        model: "fixture-model",
        message: { role: "assistant", content: "The same provider answer in both protocols." },
        done: true,
        prompt_eval_count: 12,
        eval_count: 8,
      }),
    );
  } else {
    response.writeHead(404).end();
  }
});
let providerUrl: string;

beforeAll(async () => {
  provider.listen(0, "127.0.0.1");
  await once(provider, "listening");
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("Missing fake provider address");
  providerUrl = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  provider.closeAllConnections();
  await new Promise<void>((resolve, reject) => provider.close((error) => (error ? reject(error) : resolve())));
  rmSync(sandbox, { recursive: true, force: true });
});

async function connect(packageName: string, modern: boolean) {
  const params = {
    command: process.execPath,
    args: [join(root, "packages", packageName, "dist/cli.js")],
    cwd: sandbox,
    env: { HOME: sandbox, PATH: emptyBin, ASK_LLM_PATH: emptyBin, OLLAMA_HOST: providerUrl },
    stderr: "ignore" as const,
  };
  if (!modern) {
    // A genuine SDK 1 client: no SDK 2 codec or negotiation on this side of the pipe.
    const transport = new LegacyTransport(params);
    const client = new LegacyClient({ name: "legacy-stdio-test", version: "1.0.0" });
    const sent: unknown[] = [];
    const send = transport.send.bind(transport);
    transport.send = async (message) => {
      sent.push(message);
      return send(message);
    };
    try {
      await client.connect(transport);
      expect(sent[0]).toMatchObject({ method: "initialize", params: { protocolVersion: "2025-11-25" } });
    } catch (error) {
      await transport.close();
      throw error;
    }
    return { client, wire: [] as unknown[] };
  }
  const client = new Client(
    { name: "modern-stdio-test", version: "1.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StdioClientTransport(params);
  try {
    await client.connect(transport);
    const discover = await client.request({ method: "server/discover" });
    expect(discover.supportedVersions).toContain("2026-07-28");
    expect(client.getProtocolEra()).toBe("modern");
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
  } catch (error) {
    await transport.close();
    throw error;
  }
  // Observe wire fields that SDK 2 deliberately strips from its public result types.
  const wire: unknown[] = [];
  const receive = transport.onmessage;
  transport.onmessage = (message) => {
    wire.push(message);
    receive?.(message);
  };
  return { client, wire };
}

const toolOrder = [
  ["antigravity-mcp", ["ask-antigravity", "ping", "get-usage-stats"]],
  ["claude-mcp", ["ask-claude", "ping", "get-usage-stats"]],
  ["codex-mcp", ["ask-codex", "ask-codex-write", "ask-codex-edit", "ping", "get-usage-stats"]],
  ["gemini-mcp", ["ask-gemini", "ask-gemini-edit", "fetch-chunk", "ping", "get-usage-stats"]],
  ["grok-mcp", ["ask-grok", "ping", "get-usage-stats"]],
  ["ollama-mcp", ["ask-ollama", "ping", "get-usage-stats"]],
  ["llm-mcp", ["ask-llm", "ask-cursor-agent", "ping", "get-usage-stats", "multi-llm", "diagnose"]],
] as const;

describe("dual-form stdio", () => {
  it.each(toolOrder)(
    "keeps %s tools and their order stable across protocol forms and connections",
    async (pkg, names) => {
      for (const modern of [false, true]) {
        const { client, wire } = await connect(pkg, modern);
        try {
          expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
          const first = await client.listTools();
          const second = await client.listTools();
          expect(first.tools.map((tool) => tool.name)).toEqual(names);
          expect(second.tools).toEqual(first.tools);
          if (pkg === "codex-mcp") {
            expect(first.tools[0]).toMatchObject({ annotations: { readOnlyHint: true } });
            expect(first.tools[1]).toMatchObject({ annotations: { readOnlyHint: false } });
          }
          if (modern) {
            expect(wire).toContainEqual(
              expect.objectContaining({
                result: expect.objectContaining({ resultType: "complete", ttlMs: 0, cacheScope: "private" }),
              }),
            );
          }
        } finally {
          await client.close();
        }
      }
    },
    30_000,
  );

  it.each(["llm-mcp", "ollama-mcp"])(
    "returns identical structured ask results from %s with a fake provider",
    async (pkg) => {
      const results = [];
      const before = requests.filter((path) => path === "/api/chat").length;
      for (const modern of [false, true]) {
        const { client, wire } = await connect(pkg, modern);
        try {
          await client.listTools();
          const progress: number[] = [];
          const onProgress = (notification: { params: { progressToken: string | number; progress: number } }) => {
            expect(notification.params.progressToken).toBe(0);
            progress.push(notification.params.progress);
          };
          if (client instanceof LegacyClient) client.setNotificationHandler(ProgressNotificationSchema, onProgress);
          else client.setNotificationHandler("notifications/progress", onProgress);
          const params = {
            name: pkg === "llm-mcp" ? "ask-llm" : "ask-ollama",
            _meta: { progressToken: 0 },
            arguments: {
              prompt: "Compare protocol results",
              model: "fixture-model",
              ...(pkg === "llm-mcp" ? { provider: "ollama" } : {}),
            },
          };
          const result = await client.callTool(params);
          expect(result.isError).toBe(false);
          const structured = askResponseSchema.parse(result.structuredContent);
          expect(structured).toMatchObject({
            provider: "ollama",
            model: "fixture-model",
            response: expect.stringContaining("The same provider answer in both protocols."),
            usage: { provider: "ollama", model: "fixture-model", inputTokens: 12, outputTokens: 8, fellBack: false },
          });
          expect(structured.usage?.durationMs).toBeGreaterThanOrEqual(0);
          // Only elapsed wall time varies between the two independent real processes.
          results.push({ ...structured, usage: { ...structured.usage, durationMs: 0 } });
          expect(progress).toEqual([0, 100]);
          const usage = await client.callTool({ name: "get-usage-stats", arguments: {} });
          expect(usage.structuredContent).toMatchObject({ totalCalls: 1, totalInputTokens: 12, totalOutputTokens: 8 });
          if (pkg === "llm-mcp") {
            progress.length = 0;
            const multi = await client.callTool({
              name: "multi-llm",
              arguments: { prompt: "Review through multiple-provider dispatch", providers: ["ollama"] },
              _meta: { progressToken: 0 },
            });
            expect(multi.isError).toBe(false);
            expect(multi.structuredContent).toMatchObject({ successCount: 1, failureCount: 0 });
            expect(progress).toEqual([0, 100]);
          }
          if (modern) {
            expect(wire).toContainEqual(
              expect.objectContaining({
                result: expect.objectContaining({
                  resultType: "complete",
                  structuredContent: result.structuredContent,
                }),
              }),
            );
          }
        } finally {
          await client.close();
        }
      }
      expect(results[1]).toEqual(results[0]);
      expect(requests.filter((path) => path === "/api/chat")).toHaveLength(before + (pkg === "llm-mcp" ? 4 : 2));
    },
    30_000,
  );
});
