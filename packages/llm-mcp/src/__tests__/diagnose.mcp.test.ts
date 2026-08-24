import type { ProviderEnrichment, ProviderSpec } from "@ask-llm/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerDiagnoseTool } from "../index.js";

const enrichment: ProviderEnrichment = {
  heading: "codex doctor",
  overall: "warning",
  checks: [
    { name: "auth.credentials", status: "pass", summary: "auth is configured" },
    {
      name: "mcp.servers",
      status: "fail",
      summary: "one server failed to start",
      remediation: "Fix the server configuration.",
    },
  ],
};

async function connectDiagnoseClient(spec: ProviderSpec) {
  const server = new McpServer({ name: "diagnose-regression-server", version: "1.0.0" });
  registerDiagnoseTool(server, [spec]);
  const client = new Client({ name: "diagnose-regression-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function enrichedNodeSpec(enrich: ProviderSpec["enrich"]): ProviderSpec {
  return {
    key: "codex",
    name: "Codex",
    command: "node",
    enrich,
  };
}

describe("unified diagnose MCP output", () => {
  it("advertises, validates, and delivers nested provider enrichment to clients", async () => {
    const { client, server } = await connectDiagnoseClient(enrichedNodeSpec(async () => enrichment));
    try {
      const listed = await client.listTools();
      const diagnose = listed.tools.find((tool) => tool.name === "diagnose");
      expect(diagnose?.outputSchema).toMatchObject({
        properties: {
          providers: {
            items: {
              properties: {
                enrichment: {
                  properties: {
                    heading: { type: "string" },
                    overall: { enum: ["ok", "warning", "error"] },
                    checks: {
                      items: {
                        properties: {
                          name: { type: "string" },
                          status: { enum: ["pass", "warn", "fail", "skip"] },
                          summary: { type: "string" },
                          remediation: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      // listTools() above deliberately primes the SDK client's output-schema
      // validator. This is the real boundary that previously masked a valid
      // server response as MCP -32602 after serialization preserved enrichment.
      const result = await client.callTool({ name: "diagnose", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        providers: [{ name: "Codex", enrichment }],
      });
      expect(result.content).toContainEqual(
        expect.objectContaining({ type: "text", text: expect.stringContaining("codex doctor: WARNING") }),
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("still fails clearly when enrichment is genuinely invalid", async () => {
    const invalidEnrichment = { ...enrichment, overall: "healthy" } as unknown as ProviderEnrichment;
    const { client, server } = await connectDiagnoseClient(enrichedNodeSpec(async () => invalidEnrichment));
    try {
      await client.listTools();
      const result = await client.callTool({ name: "diagnose", arguments: {} });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toBeUndefined();
      expect(result.content).toContainEqual(
        expect.objectContaining({
          type: "text",
          text: expect.stringMatching(/Output validation error[\s\S]*diagnose[\s\S]*overall/i),
        }),
      );
    } finally {
      await client.close();
      await server.close();
    }
  });
});
