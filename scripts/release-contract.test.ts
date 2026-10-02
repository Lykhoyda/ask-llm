import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { askResponseSchema, diagnosticReportSchema } from "@ask-llm/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import askLlmPiExtension from "../packages/llm-mcp/pi/extensions/index.ts";

vi.mock("@ask-llm/mcp", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ask-llm/mcp")>()),
  detectProviders: async () => ({ available: [], missing: [], unavailable: [] }),
}));

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// Keep test fixtures outside shared/src, whose changes require a seven-package release.
const FIXTURES = join(ROOT, "scripts/fixtures/contract");
const UPDATE = process.env.ASK_LLM_UPDATE_CONTRACT === "1";
const pinnedBins: Record<string, string[]> = JSON.parse(readFileSync(join(FIXTURES, "bins.json"), "utf8"));

interface PackageManifest {
  name: string;
  private?: boolean;
  mcpName?: string;
  bin?: Record<string, string>;
}

const packages = readdirSync(join(ROOT, "packages"))
  .sort()
  .map((dir) => ({
    dir,
    manifest: JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8")) as PackageManifest,
  }))
  .filter(({ manifest }) => manifest.bin);
const servers = packages
  .filter(({ manifest }) => manifest.mcpName)
  .map(({ dir }) => [dir, join(ROOT, "packages", dir, "dist/cli.js")]);

// Empty PATH, no keys, unreachable Ollama: nothing is detected and no provider is ever called.
const sandbox = mkdtempSync(join(tmpdir(), "ask-llm-contract-"));
const emptyBin = join(sandbox, "bin");
mkdirSync(emptyBin);
const hermeticEnv = { HOME: sandbox, PATH: emptyBin, ASK_LLM_PATH: emptyBin, OLLAMA_HOST: "http://127.0.0.1:9" };

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function contract(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => contract(item));
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, contract(record[key])]),
  );
}

function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    const variants = new Map(value.map((item) => [JSON.stringify(shapeOf(item)), shapeOf(item)]));
    return [...variants.keys()].sort().map((key) => variants.get(key));
  }
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, shapeOf(record[key])]),
  );
}

function byName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, "en"));
}

function expectFixture(name: string, actual: unknown): void {
  actual = contract(actual);
  const path = join(FIXTURES, `${name}.json`);
  if (UPDATE) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(path, `${JSON.stringify(actual, null, 2)}\n`);
  }
  expect(actual, `${name}.json drifted; regenerate only for an intended contract change`).toEqual(
    JSON.parse(readFileSync(path, "utf8")),
  );
}

async function listAll<T>(list: (params: { cursor?: string }) => Promise<{ items: T[]; nextCursor?: string }>) {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function listServer(cli: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli],
    env: hermeticEnv,
    cwd: sandbox,
    stderr: "ignore",
  });
  const client = new Client({ name: "release-contract", version: "1.0.0" });
  await client.connect(transport);
  try {
    const tools = await listAll(async (params) => {
      const page = await client.listTools(params);
      return { items: page.tools, nextCursor: page.nextCursor };
    });
    return byName(tools).map(({ name, inputSchema, outputSchema }) => ({ name, inputSchema, outputSchema }));
  } finally {
    await client.close();
  }
}

describe("release contract", () => {
  it("keeps exactly one fixture per pinned surface", () => {
    const expected = ["ask-response", "bins", "doctor-json-shape", "pi-tools", ...servers.map(([dir]) => `mcp-${dir}`)];
    expect(readdirSync(FIXTURES).sort()).toEqual(expected.map((name) => `${name}.json`).sort());
  });

  it("preserves the bin names of every legacy package", () => {
    expectFixture(
      "bins",
      Object.fromEntries(
        packages.map(({ manifest }) => [
          manifest.name,
          Object.keys(manifest.bin ?? {})
            .filter((bin) => (pinnedBins[manifest.name] ?? []).includes(bin))
            .sort(),
        ]),
      ),
    );
  });

  // The unified ask-llm provider enum is the zero-providers-detected startup schema: every eligible provider.
  it.each(servers)(
    "pins the MCP surface of %s",
    async (dir, cli) => {
      expectFixture(`mcp-${dir}`, await listServer(cli));
    },
    30_000,
  );

  it("pins the AskResponse shape and its attribution fields", () => {
    expectFixture("ask-response", z.toJSONSchema(askResponseSchema));
  });

  it("pins the doctor --json shape", () => {
    const result = spawnSync(process.execPath, [join(ROOT, "packages/llm-mcp/dist/cli.js"), "doctor", "--json"], {
      cwd: sandbox,
      env: hermeticEnv,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.error).toBeUndefined();
    const report: unknown = JSON.parse(result.stdout);
    expect(diagnosticReportSchema.safeParse(report).success).toBe(true);
    expectFixture("doctor-json-shape", {
      schema: z.toJSONSchema(diagnosticReportSchema),
      unavailable: shapeOf(report),
    });
  });

  it("pins the Pi tool names and parameters", async () => {
    const tools: Array<{ name: string; parameters: unknown }> = [];
    // Like the hermetic MCP fixtures: a Claude Code session would hide the claude provider.
    const claudeCode = process.env.CLAUDECODE;
    delete process.env.CLAUDECODE;
    try {
      await askLlmPiExtension({
        registerTool: (tool: { name: string; parameters: unknown }) => tools.push(tool),
        on: () => {},
        registerCommand: () => {},
      } as unknown as Parameters<typeof askLlmPiExtension>[0]);
    } finally {
      if (claudeCode !== undefined) process.env.CLAUDECODE = claudeCode;
    }
    expectFixture(
      "pi-tools",
      byName(tools).map(({ name, parameters }) => ({ name, parameters })),
    );
  });
});
