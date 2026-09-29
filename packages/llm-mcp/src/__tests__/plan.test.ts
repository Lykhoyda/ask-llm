import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DetectedHost } from "../hosts/detect.js";
import { type HostId, hostSpecs } from "../hosts/registry.js";
import { buildPlan, genericSnippet, type PlanEntry, resolveServerPath } from "../plan.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ask-llm-plan-")));
const bin = join(root, "bin");
const previousPath = process.env.ASK_LLM_PATH;
process.env.ASK_LLM_PATH = bin;
const SERVER = "/usr/local/bin/ask-llm-mcp";
const specs = hostSpecs({ HOME: "/home/u" }, "linux");

afterAll(() => {
  if (previousPath === undefined) delete process.env.ASK_LLM_PATH;
  else process.env.ASK_LLM_PATH = previousPath;
  rmSync(root, { recursive: true, force: true });
});

function detected(id: HostId, overrides: Partial<DetectedHost> = {}): DetectedHost {
  const spec = specs.find((entry) => entry.id === id);
  if (!spec) throw new Error(id);
  return {
    id,
    name: spec.name,
    installed: true,
    binary: `/bin/${spec.binaries[0] ?? id}`,
    version: "1.0.0",
    supported: true,
    leftoverConfig: false,
    registered: false,
    spec,
    ...overrides,
  };
}

function entry(host: DetectedHost): PlanEntry {
  const [planned] = buildPlan([host], SERVER);
  return planned;
}

describe("buildPlan", () => {
  it.each([
    ["claude", ["claude", "mcp", "add", "--scope", "user", "ask-llm", "--", SERVER]],
    ["codex", ["codex", "mcp", "add", "ask-llm", "--", SERVER]],
    ["agy", ["agy", "mcp", "add", "ask-llm", SERVER]],
    ["grok", ["grok", "mcp", "add", "--scope", "user", "ask-llm", SERVER]],
    ["gemini", ["gemini", "mcp", "add", "--scope", "user", "ask-llm", SERVER]],
    ["pi", ["pi", "install", "npm:@ask-llm/mcp"]],
  ] as const)("registers %s through its own command with the exact argv", (id, argv) => {
    expect(entry(detected(id))).toMatchObject({
      id,
      action: "register",
      registration: { kind: "command", argv, command: argv.join(" ") },
    });
  });

  it.each([
    ["cursor", "/home/u/.cursor/mcp.json", ["mcpServers", "ask-llm"], { command: SERVER, args: [] }],
    [
      "claude-desktop",
      "/home/u/.config/Claude/claude_desktop_config.json",
      ["mcpServers", "ask-llm"],
      { command: SERVER, args: [] },
    ],
    [
      "opencode",
      "/home/u/.config/opencode/opencode.json",
      ["mcp", "ask-llm"],
      { type: "local", command: [SERVER], enabled: true },
    ],
  ] as const)("previews a narrow JSON merge for %s", (id, file, keyPath, value) => {
    expect(entry(detected(id)).registration).toEqual({ kind: "json", file, keyPath, entry: value });
  });

  it("keeps the macOS Claude Desktop config path", () => {
    const desktop = hostSpecs({ HOME: "/Users/u" }, "darwin").find(({ id }) => id === "claude-desktop");
    expect(desktop?.registrationState).toMatchObject({
      file: "/Users/u/Library/Application Support/Claude/claude_desktop_config.json",
    });
  });

  it("never selects a reviewer provider or passes environment through host registration", () => {
    for (const planned of buildPlan(
      specs.map((spec) => detected(spec.id)),
      SERVER,
    )) {
      const text = JSON.stringify(planned.registration);
      expect(text, planned.id).not.toMatch(/provider|ASK_|"-e"|--env/);
    }
  });

  it("skips hosts without a binary and names leftover config", () => {
    expect(entry(detected("codex", { installed: false, binary: undefined, leftoverConfig: true }))).toMatchObject({
      action: "skip",
      reason: "not installed; leftover config at /home/u/.codex",
    });
    expect(entry(detected("grok", { installed: false, binary: undefined }))).toMatchObject({
      action: "skip",
      reason: "not installed",
    });
  });

  it("stops with the exact manual command when the CLI version output is unrecognized", () => {
    expect(entry(detected("agy", { version: undefined, supported: false }))).toMatchObject({
      action: "manual",
      manual: `agy mcp add ask-llm ${SERVER}`,
    });
  });

  it("reports an existing registration of this server as up to date", () => {
    expect(entry(detected("claude", { registered: true, command: [SERVER] })).action).toBe("up-to-date");
    expect(entry(detected("pi", { registered: true })).action).toBe("up-to-date");
  });

  it("never overwrites a foreign ask-llm entry", () => {
    expect(
      entry(detected("claude-desktop", { registered: true, command: ["npx", "-y", "ask-llm-mcp"] })),
    ).toMatchObject({
      action: "conflict",
      reason: "an ask-llm entry already runs `npx -y ask-llm-mcp`; setup will not overwrite it",
    });
  });

  it("never overwrites a disabled or command-less ask-llm entry", () => {
    expect(entry(detected("codex", { registered: false, present: true }))).toMatchObject({
      action: "conflict",
      reason: "an ask-llm entry exists but is disabled or has no usable command; setup will not overwrite it",
    });
  });

  it("keeps unreadable registrations manual", () => {
    expect(entry(detected("cursor", { registered: null, error: "cannot read registration: bad" }))).toMatchObject({
      action: "manual",
      reason: "cannot read registration: bad",
    });
    expect(
      entry(
        detected("cursor", {
          installed: false,
          binary: undefined,
          registered: null,
          error: "cannot read registration: bad",
        }),
      ),
    ).toMatchObject({
      action: "manual",
      reason: "cannot read registration: bad",
      manual: `add {"command":"${SERVER}","args":[]} at mcpServers.ask-llm in /home/u/.cursor/mcp.json`,
    });
  });

  it("registers OpenCode by merging its documented local entry", () => {
    expect(entry(detected("opencode"))).toMatchObject({
      action: "register",
      registration: {
        kind: "json",
        file: "/home/u/.config/opencode/opencode.json",
        keyPath: ["mcp", "ask-llm"],
        entry: { type: "local", command: [SERVER], enabled: true },
      },
    });
  });

  it("prints a stdio snippet for any other MCP client", () => {
    expect(genericSnippet(SERVER)).toEqual({ mcpServers: { "ask-llm": { command: SERVER, args: [] } } });
  });
});

describe("resolveServerPath", () => {
  beforeEach(() => {
    rmSync(bin, { recursive: true, force: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(
      join(bin, "npm"),
      `#!/bin/sh\nif [ "$1" = prefix ]; then echo '${root}'; else echo '${join(root, "lib/node_modules")}'; fi\n`,
      { mode: 0o755 },
    );
  });

  function packageCli(base: string): string {
    const dist = join(root, base, "dist");
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "cli.js"), "#!/usr/bin/env node\n", { mode: 0o755 });
    return join(dist, "cli.js");
  }

  it("prefers the global ask-llm-mcp bin that resolves to this package", async () => {
    const cli = packageCli("lib/node_modules/@ask-llm/mcp");
    symlinkSync(cli, join(bin, "ask-llm-mcp"));
    await expect(resolveServerPath(cli)).resolves.toEqual({ path: join(bin, "ask-llm-mcp"), source: "global-bin" });
  });

  it("runs npm with the augmented PATH used to find Node and npm", async () => {
    const cli = packageCli("lib/node_modules/@ask-llm/mcp");
    symlinkSync(cli, join(bin, "ask-llm-mcp"));
    symlinkSync(process.execPath, join(bin, "node"));
    writeFileSync(
      join(bin, "npm"),
      `#!/usr/bin/env node\nprocess.stdout.write(process.argv[2] === "prefix" ? ${JSON.stringify(root)} : ${JSON.stringify(join(root, "lib/node_modules"))});\n`,
      { mode: 0o755 },
    );
    const inheritedPath = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(resolveServerPath(cli)).resolves.toEqual({ path: join(bin, "ask-llm-mcp"), source: "global-bin" });
    } finally {
      if (inheritedPath === undefined) delete process.env.PATH;
      else process.env.PATH = inheritedPath;
    }
  });

  it("falls back to this package's absolute server path when another ask-llm-mcp is on PATH", async () => {
    const cli = packageCli("checkout/packages/llm-mcp");
    symlinkSync(packageCli("other"), join(bin, "ask-llm-mcp"));
    await expect(resolveServerPath(cli)).resolves.toEqual({ path: cli, source: "package-dist" });
  });

  it("does not treat a project-local bin as durable", async () => {
    const cli = packageCli("checkout/packages/llm-mcp");
    symlinkSync(cli, join(bin, "ask-llm-mcp"));
    await expect(resolveServerPath(cli)).resolves.toEqual({ path: cli, source: "package-dist" });
  });

  it("does not treat an npx-cache bin as durable", async () => {
    const cli = packageCli("lib/node_modules/@ask-llm/mcp");
    const npxBin = join(root, "npm/_npx/0a1b/bin");
    mkdirSync(npxBin, { recursive: true });
    symlinkSync(cli, join(npxBin, "ask-llm-mcp"));
    process.env.ASK_LLM_PATH = npxBin;
    try {
      await expect(resolveServerPath(cli)).resolves.toEqual({ path: cli, source: "package-dist" });
    } finally {
      process.env.ASK_LLM_PATH = bin;
    }
  });

  it("refuses an npx cache path", async () => {
    const cli = packageCli("npm/_npx/0a1b/node_modules/@ask-llm/mcp");
    await expect(resolveServerPath(cli)).rejects.toThrow(/npm i -g @ask-llm\/mcp/);
  });
});
