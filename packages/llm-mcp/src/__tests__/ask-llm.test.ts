import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const command = fileURLToPath(new URL("../../dist/ask-llm.js", import.meta.url));
const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

it("prints the canonical package version without starting a server", () => {
  const result = spawnSync(process.execPath, [command, "--version"], { encoding: "utf8", timeout: 10_000 });
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
    status: 0,
    stdout: `${version}\n`,
    stderr: "",
  });
});

it.each([[], ["--help"], ["-h"]].map((args) => ({ args })))(
  "prints command help for %j without starting a server",
  ({ args }) => {
    const result = spawnSync(process.execPath, [command, ...args], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ask-llm doctor");
    expect(result.stdout).toContain("ask-llm setup --dry-run");
    expect(result.stderr).toBe("");
  },
);

it.each([["remove"], ["--version", "extra"], ["unknown"]].map((args) => ({ args })))(
  "rejects unsupported argv %j",
  ({ args }) => {
    const result = spawnSync(process.execPath, [command, ...args], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: ask-llm");
  },
);

it("delegates doctor argument errors to the existing diagnostics dispatcher", () => {
  const result = spawnSync(process.execPath, [command, "doctor", "--unknown"], { encoding: "utf8", timeout: 10_000 });
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stderr).error.code).toBe("unknown_argument");
  expect(result.stdout).toBe("");
});

describe("host discovery commands", () => {
  const root = mkdtempSync(join(tmpdir(), "ask-llm-hosts-cli-"));
  const bin = join(root, "bin");
  const home = join(root, "home");
  const server = realpathSync(fileURLToPath(new URL("../../dist/cli.js", import.meta.url)));
  const path = bin;
  const env = { HOME: home, PATH: path, ASK_LLM_PATH: path, OLLAMA_HOST: "http://127.0.0.1:9" };
  mkdirSync(bin, { recursive: true });
  symlinkSync("/usr/bin/which", join(bin, "which"));
  mkdirSync(join(home, ".cursor"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    join(home, ".cursor/mcp.json"),
    JSON.stringify({ mcpServers: { "ask-llm": { command: "npx", args: ["-y", "ask-llm-mcp"] } } }),
  );
  writeFileSync(join(home, ".claude.json"), JSON.stringify({ mcpServers: { "ask-llm": { command: server } } }));
  for (const [name, script] of [
    ["claude", 'case "$1" in --version) echo "2.1.284 (Claude Code)";; *) exit 9;; esac'],
    ["agent", 'case "$1" in --version) echo "2026.09.26-dd393fe";; *) exit 9;; esac'],
    ["gemini", 'case "$1" in --version) echo "0.46.0";; *) exit 9;; esac'],
  ]) {
    writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
    chmodSync(join(bin, name), 0o755);
  }

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  function snapshot(dir: string): Record<string, string> {
    const files: Record<string, string> = {};
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = join(entry.parentPath, entry.name);
      files[file] = createHash("sha256").update(readFileSync(file)).digest("hex");
    }
    return files;
  }

  function ask(...args: string[]) {
    return spawnSync(process.execPath, [command, ...args], { cwd: root, env, encoding: "utf8", timeout: 30_000 });
  }

  it("previews every host registration as JSON and writes nothing", () => {
    const before = snapshot(home);
    const result = ask("setup", "--dry-run", "--json");
    expect(snapshot(home)).toEqual(before);
    expect(result.status).toBe(0);
    const plan = JSON.parse(result.stdout);
    expect(plan).toMatchObject({
      schema: "ask-llm.setup-plan",
      schemaVersion: 1,
      dryRun: true,
      server: { path: server, source: "package-dist" },
      otherClients: { snippet: { mcpServers: { "ask-llm": { command: server, args: [] } } } },
    });
    const byId = Object.fromEntries(plan.hosts.map((host: { id: string }) => [host.id, host]));
    expect(byId.claude).toMatchObject({ installed: true, version: "2.1.284", action: "up-to-date" });
    expect(byId.gemini).toMatchObject({
      action: "register",
      registration: { kind: "command", argv: ["gemini", "mcp", "add", "--scope", "user", "ask-llm", server] },
    });
    expect(byId.cursor).toMatchObject({
      action: "conflict",
      registration: { kind: "json", file: join(home, ".cursor/mcp.json"), keyPath: ["mcpServers", "ask-llm"] },
    });
    expect(byId.codex).toMatchObject({
      installed: false,
      action: "skip",
      reason: `not installed; leftover config at ${join(home, ".codex")}`,
    });
  });

  it("prints the exact commands in the text preview", () => {
    const result = ask("setup", "--dry-run");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`gemini mcp add --scope user ask-llm ${server}`);
    expect(result.stdout).toContain(`claude mcp add --scope user ask-llm -- ${server}`);
    expect(result.stdout).toContain(
      `merge ${JSON.stringify({ command: server, args: [] })} at mcpServers.ask-llm in ${join(home, ".cursor/mcp.json")}`,
    );
    expect(result.stdout).toContain("nothing was changed");
  });

  it("keeps unreadable host errors and exact manual registration in setup and doctor", () => {
    const file = join(home, ".cursor/mcp.json");
    const original = readFileSync(file);
    writeFileSync(file, "{");
    try {
      const manual = `add ${JSON.stringify({ command: server, args: [] })} at mcpServers.ask-llm in ${file}`;
      const setup = ask("setup", "--dry-run", "--json");
      const setupHost = JSON.parse(setup.stdout).hosts.find((host: { id: string }) => host.id === "cursor");
      expect(setup.status).toBe(0);
      expect(setupHost).toMatchObject({ action: "manual", manual, reason: expect.stringContaining("cannot read registration") });
      const setupText = ask("setup", "--dry-run").stdout;
      expect(setupText).toContain("cannot read registration");
      expect(setupText).toContain(`merge ${JSON.stringify({ command: server, args: [] })} at mcpServers.ask-llm in ${file}`);

      const doctorHost = JSON.parse(ask("doctor", "--json").stdout).hosts.find(
        (host: { id: string }) => host.id === "cursor",
      );
      expect(doctorHost).toMatchObject({ registered: null, manual, error: expect.stringContaining("cannot read registration") });
      const doctorText = ask("doctor").stdout;
      expect(doctorText).toContain("cannot read registration");
      expect(doctorText).toContain(`exact manual command: ${manual}`);
    } finally {
      writeFileSync(file, original);
    }
  });

  it("explains doctor host output and the provider-only TOON format", () => {
    const help = ask("doctor", "--help").stdout;
    expect(help).toContain("provider and host diagnostics");
    expect(help).toContain("Provider report and hosts");
    expect(help).toContain("provider-only diagnostics (no hosts)");
    expect(help).toContain("registration change requires");
  });

  it.each([[[]], [["--json"]], [["--dry-run", "--yes"]]])("refuses setup %j without writing", (args) => {
    const before = snapshot(home);
    const result = ask("setup", ...args);
    expect(snapshot(home)).toEqual(before);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("ask-llm setup --dry-run");
  });

  it("adds a hosts section to ask-llm doctor --json without changing the provider report", () => {
    const before = snapshot(home);
    const result = ask("doctor", "--json");
    expect(snapshot(home)).toEqual(before);
    const report = JSON.parse(result.stdout);
    expect(Object.keys(report)).toEqual(["status", "generatedAt", "environment", "providers", "checks", "hosts"]);
    const byId = Object.fromEntries(report.hosts.map((host: { id: string }) => [host.id, host]));
    expect(byId.claude).toMatchObject({ installed: true, registered: true, ownServer: true, restart: "new-session" });
    expect(byId.cursor).toMatchObject({
      installed: true,
      registered: true,
      ownServer: false,
      command: ["npx", "-y", "ask-llm-mcp"],
    });
    expect(byId.gemini).toMatchObject({ installed: true, registered: false });
    expect(byId.codex).toMatchObject({ installed: false, leftoverConfig: true });

    const legacy = spawnSync(process.execPath, [server, "doctor", "--json"], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(JSON.parse(legacy.stdout)).not.toHaveProperty("hosts");
  });

  it("prints a Hosts section in the text doctor", () => {
    const result = ask("doctor");
    expect(result.stdout).toContain("Hosts:");
    expect(result.stdout).toContain("Claude Code: installed (2.1.284), registered to this ask-llm-mcp");
  });
});
