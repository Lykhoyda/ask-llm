import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type DetectedHost, detectHosts } from "../hosts/detect.js";

const root = mkdtempSync(join(tmpdir(), "ask-llm-detect-"));
const bin = join(root, "bin");
const home = join(root, "home");
const previousPath = process.env.ASK_LLM_PATH;
// Pin the shared PATH resolver to the fixture bin like the harness-smoke gate.
process.env.ASK_LLM_PATH = bin;
const env = { HOME: home };

afterAll(() => {
  if (previousPath === undefined) delete process.env.ASK_LLM_PATH;
  else process.env.ASK_LLM_PATH = previousPath;
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(bin, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  symlinkSync("/usr/bin/which", join(bin, "which"));
});

function fake(name: string, script: string): string {
  const path = join(bin, name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

function write(relative: string, content: string): void {
  const path = join(home, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function host(hosts: DetectedHost[], id: string): DetectedHost {
  const found = hosts.find((entry) => entry.id === id);
  if (!found) throw new Error(`host ${id} missing`);
  return found;
}

describe("detectHosts", () => {
  it("reports every matrix host as not installed when no binary exists", async () => {
    const hosts = await detectHosts(env);
    expect(hosts.map((entry) => entry.id)).toEqual([
      "claude",
      "codex",
      "agy",
      "grok",
      "gemini",
      "cursor",
      "claude-desktop",
      "pi",
      "opencode",
    ]);
    // App-bundle hosts (Cursor, Claude Desktop on macOS) are detected from /Applications, outside the fixture.
    for (const entry of hosts.filter(({ spec }) => !spec.apps?.length)) {
      expect(entry, entry.id).toMatchObject({ installed: false, leftoverConfig: false, registered: false });
    }
  });

  it("treats a config directory without a binary as leftover config, not an install", async () => {
    mkdirSync(join(home, ".codex"));
    mkdirSync(join(home, ".grok"));
    const hosts = await detectHosts(env);
    expect(host(hosts, "codex")).toMatchObject({ installed: false, leftoverConfig: true });
    expect(host(hosts, "grok")).toMatchObject({ installed: false, leftoverConfig: true });
    expect(host(hosts, "claude")).toMatchObject({ installed: false, leftoverConfig: false });
  });

  it("keeps Antigravity and Gemini CLI config clues separate", async () => {
    write(".gemini/settings.json", "{}");
    const hosts = await detectHosts(env);
    expect(host(hosts, "gemini")).toMatchObject({ installed: false, leftoverConfig: true });
    expect(host(hosts, "agy")).toMatchObject({ installed: false, leftoverConfig: false });
  });

  it("resolves binaries on the shared PATH and parses each pinned version format", async () => {
    const versions: Record<string, [string, string]> = {
      claude: ["2.1.284 (Claude Code)", "2.1.284"],
      codex: ["codex-cli 0.158.0", "0.158.0"],
      agy: ["1.2.13", "1.2.13"],
      grok: ["grok 1.0.40 (eb1a2256660d) [stable]", "1.0.40"],
      gemini: ["0.46.0", "0.46.0"],
      agent: ["2026.09.26-dd393fe", "2026.09.26-dd393fe"],
      pi: ["0.87.1", "0.87.1"],
    };
    for (const [name, [output]] of Object.entries(versions)) fake(name, `echo "${output}"`);
    const hosts = await detectHosts(env);
    for (const [name, [, version]] of Object.entries(versions)) {
      const id = name === "agent" ? "cursor" : name;
      expect(host(hosts, id), id).toMatchObject({
        installed: true,
        binary: join(bin, name),
        version,
        supported: true,
      });
    }
  });

  it("finds Cursor through cursor-agent when agent is absent", async () => {
    fake("cursor-agent", 'echo "2026.09.26-dd393fe"');
    expect(host(await detectHosts(env), "cursor")).toMatchObject({
      installed: true,
      binary: join(bin, "cursor-agent"),
    });
  });

  it("reads registration state from each host's own file without spawning list commands", async () => {
    fake(
      "claude",
      'case "$1" in --version) echo "2.1.284 (Claude Code)";; *) touch "$HOME/claude-spawned"; exit 9;; esac',
    );
    fake("grok", 'case "$1" in --version) echo "grok 1.0.40";; *) touch "$HOME/grok-spawned"; exit 9;; esac');
    write(
      ".claude.json",
      JSON.stringify({ mcpServers: { "ask-llm": { type: "stdio", command: "/opt/x/ask-llm-mcp" } } }),
    );
    write(
      ".grok/config.toml",
      '[ui]\ntheme = "dark"\n\n[mcp_servers.ask-llm]\ncommand = "/opt/x/ask-llm-mcp"\nargs = []\n',
    );
    write(".gemini/config/mcp_config.json", JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    write(
      "Library/Application Support/Claude/claude_desktop_config.json",
      JSON.stringify({ mcpServers: { "ask-llm": { command: "npx", args: ["-y", "ask-llm-mcp"] } } }),
    );
    write(".config/Claude/claude_desktop_config.json", "{}");
    write(".pi/agent/settings.json", JSON.stringify({ packages: ["npm:pi-lens", { source: "npm:@ask-llm/mcp" }] }));
    write(
      ".config/opencode/opencode.json",
      JSON.stringify({ mcp: { "ask-llm": { type: "local", command: ["/o/ask"] } } }),
    );
    const hosts = await detectHosts(env);
    expect(host(hosts, "claude")).toMatchObject({ registered: true, command: ["/opt/x/ask-llm-mcp"] });
    expect(host(hosts, "grok")).toMatchObject({ registered: true, command: ["/opt/x/ask-llm-mcp"] });
    expect(host(hosts, "agy")).toMatchObject({ registered: false });
    expect(host(hosts, "pi")).toMatchObject({ installed: false, registered: true });
    expect(host(hosts, "opencode")).toMatchObject({ registered: true, command: ["/o/ask"] });
    if (process.platform === "darwin") {
      expect(host(hosts, "claude-desktop")).toMatchObject({ registered: true, command: ["npx", "-y", "ask-llm-mcp"] });
    }
    expect(existsSync(join(home, "claude-spawned"))).toBe(false);
    expect(existsSync(join(home, "grok-spawned"))).toBe(false);
  });

  it("reads Codex registration through its side-effect-free JSON list command", async () => {
    fake(
      "codex",
      [
        'if [ "$1" = "--version" ]; then echo "codex-cli 0.158.0"; exit 0; fi',
        'if [ "$*" = "mcp list --json" ]; then',
        '  echo \'[{"name":"other","transport":{"command":"x"}},{"name":"ask-llm","transport":{"type":"stdio","command":"/opt/x/ask-llm-mcp","args":[]}}]\'',
        "  exit 0",
        "fi",
        "exit 9",
      ].join("\n"),
    );
    expect(host(await detectHosts(env), "codex")).toMatchObject({
      installed: true,
      registered: true,
      command: ["/opt/x/ask-llm-mcp"],
    });
  });

  it("recognizes a version-pinned Pi package source", async () => {
    write(".pi/agent/settings.json", JSON.stringify({ packages: ["npm:@ask-llm/mcp@1.0.0"] }));
    expect(host(await detectHosts(env), "pi")).toMatchObject({ registered: true });
  });

  it("reports an unreadable registration as unknown instead of unregistered", async () => {
    write(".cursor/mcp.json", "{ not json");
    const cursor = host(await detectHosts(env), "cursor");
    expect(cursor.registered).toBeNull();
    expect(cursor.error).toMatch(/^cannot read registration/);
  });

  it("marks an unrecognized or failing version probe as unsupported", async () => {
    fake("agy", 'echo "agy says hello"');
    fake("codex", "exit 3");
    const hosts = await detectHosts(env);
    expect(host(hosts, "agy")).toMatchObject({ installed: true, supported: false });
    expect(host(hosts, "agy").version).toBeUndefined();
    expect(host(hosts, "codex")).toMatchObject({ installed: true, supported: false, registered: null });
  });
});
