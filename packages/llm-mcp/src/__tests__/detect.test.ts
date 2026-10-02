import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
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
        version: name === "agent" ? undefined : version,
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

  it.each(["npm:@ask-llm/mcp", "npm:@ask-llm/mcp@1.0.0", { source: "npm:@ask-llm/mcp" }])(
    "recognizes Pi registration from %j",
    async (entry) => {
      write(".pi/agent/settings.json", JSON.stringify({ packages: [entry] }));
      expect(host(await detectHosts(env), "pi")).toMatchObject({ registered: true });
    },
  );

  it.each([
    ["npm:@ask-llm/plugin", "npm:@ask-llm/plugin"],
    ["npm:@ask-llm/plugin@1.0.0", "npm:@ask-llm/plugin@1.0.0"],
    [{ source: "npm:@ask-llm/plugin" }, "npm:@ask-llm/plugin"],
  ])("reports the earlier Pi bridge package %j for migration, not as this install", async (entry, listed) => {
    write(".pi/agent/settings.json", JSON.stringify({ packages: [entry] }));
    expect(host(await detectHosts(env), "pi")).toMatchObject({ registered: false, legacy: [listed] });
  });

  describe("Pi local install of this package", () => {
    const PACKAGE_ROOT = join(__dirname, "..", "..");
    const agentDir = () => join(home, ".pi", "agent");
    it.each([
      ["an absolute path", () => PACKAGE_ROOT],
      ["a path relative to Pi's agent folder", () => relative(agentDir(), PACKAGE_ROOT)],
      ["a source object", () => ({ source: relative(agentDir(), PACKAGE_ROOT) })],
    ])("recognizes registration from %s", async (_label, entry) => {
      write(".pi/agent/settings.json", JSON.stringify({ packages: [entry()] }));
      expect(host(await detectHosts(env), "pi")).toMatchObject({ registered: true });
    });

    it("does not treat another local package as this package's registration", async () => {
      write(".pi/agent/settings.json", JSON.stringify({ packages: [join(PACKAGE_ROOT, "skills"), "../other"] }));
      expect(host(await detectHosts(env), "pi")).toMatchObject({ registered: false });
    });
  });

  it.each(["npm:@ask-llm/mcp-extra", "npm:@ask-llm/plugin-extra", "npm:pi-lens", null, {}])(
    "does not treat %j as an Ask LLM Pi registration",
    async (entry) => {
      write(".pi/agent/settings.json", JSON.stringify({ packages: [entry] }));
      expect(host(await detectHosts(env), "pi")).toMatchObject({ registered: false });
    },
  );

  it("reports an unreadable registration as unknown instead of unregistered", async () => {
    write(".cursor/mcp.json", "{ not json");
    const cursor = host(await detectHosts(env), "cursor");
    expect(cursor.registered).toBeNull();
    expect(cursor.error).toMatch(/^cannot read registration/);
  });

  it("does not count entries without a usable command as registered", async () => {
    write(".claude.json", JSON.stringify({ mcpServers: { "ask-llm": {} } }));
    write(".gemini/settings.json", JSON.stringify({ mcpServers: { "ask-llm": { command: "ask", args: [4] } } }));
    write(".grok/config.toml", "[mcp_servers.ask-llm]\nargs = []\n");
    write(
      ".config/opencode/opencode.json",
      JSON.stringify({ mcp: { "ask-llm": { command: ["ask"], enabled: false } } }),
    );
    fake(
      "codex",
      'case "$1" in --version) echo "codex-cli 0.158.0";; *) echo \'[{"name":"ask-llm","transport":{}}]\';; esac',
    );
    const hosts = await detectHosts(env);
    for (const id of ["claude", "gemini", "grok", "opencode", "codex"]) {
      expect(host(hosts, id).registered, id).toBe(false);
    }
  });

  it("retains separate arguments after an array command", async () => {
    write(
      ".config/opencode/opencode.json",
      JSON.stringify({ mcp: { "ask-llm": { command: ["/opt/ask-llm-mcp"], args: ["--extra"] } } }),
    );
    expect(host(await detectHosts(env), "opencode")).toMatchObject({
      registered: true,
      command: ["/opt/ask-llm-mcp", "--extra"],
    });
  });

  it.each([
    [
      "a bare header",
      '[mcp_servers.ask-llm]\ncommand = "/opt/x"\nargs = ["--custom"]\n',
      { registered: true, command: ["/opt/x", "--custom"] },
    ],
    [
      "a basic-quoted header",
      '[mcp_servers."ask-llm"]\ncommand = "/opt/x"\n',
      { registered: true, command: ["/opt/x"] },
    ],
    ["a disabled entry", '[mcp_servers.ask-llm]\ncommand = "/opt/x"\nenabled = false\n', { present: true }],
  ])("reads a Grok TOML entry written with %s", async (_, content, expected) => {
    write(".grok/config.toml", content);
    expect(host(await detectHosts(env), "grok")).toMatchObject(expected);
  });

  const GROK_TUI_CONFIG =
    '[cli]\ninstaller = "npm"\n\n[marketplace]\nofficial_marketplace_auto_installed = true\n\n' +
    '[[marketplace.sources]]\nname = "official"\ngit = "https://example.com/marketplace.git"\n\n' +
    "[ui]\ncompact_mode = false\n\n[compat.claude]\nhooks = true\n\n[privacy]\nprivacy_banner_acked = true\n";

  it.each([
    ["no ask-llm table", GROK_TUI_CONFIG, { registered: false }],
    [
      "an ask-llm table after it",
      `${GROK_TUI_CONFIG}\n[mcp_servers.ask-llm]\ncommand = "/opt/x"\nargs = []\n`,
      { registered: true, command: ["/opt/x"] },
    ],
    [
      "an ask-llm table before its array of tables",
      `[mcp_servers.ask-llm]\ncommand = "/opt/x"\n\n${GROK_TUI_CONFIG}`,
      { registered: true, command: ["/opt/x"] },
    ],
  ])("reads a Grok TUI-written config with %s", async (_, content, expected) => {
    write(".grok/config.toml", content);
    expect(host(await detectHosts(env), "grok")).toMatchObject(expected);
  });

  it.each(['[mcp_servers."ask - llm"]\ncommand = "/opt/x"\n', "[mcp_servers.'ask - llm']\ncommand = \"/opt/x\"\n"])(
    "reports a noncanonical quoted Grok key as unknown",
    async (content) => {
      write(".grok/config.toml", content);
      expect(host(await detectHosts(env), "grok")).toMatchObject({ registered: null });
    },
  );

  it("fails closed when a later Grok header contains a quoted bracket", async () => {
    write(
      ".grok/config.toml",
      '[mcp_servers.ask-llm]\ncommand = "/opt/foreign"\n[mcp_servers."team]tools"]\ncommand = "/opt/ours"\n',
    );
    expect(host(await detectHosts(env), "grok")).toMatchObject({
      registered: null,
      error: expect.stringContaining("unsupported Grok TOML table header"),
    });
  });

  it.each([
    '[mcp_servers."ask\\u002dllm"]\ncommand = "/opt/foreign"\n',
    '[[mcp_servers.ask-llm]]\ncommand = "/opt/foreign"\n',
    '[[mcp_servers]]\nask-llm = { command = "/opt/foreign" }\n',
    '[[marketplace."quoted]key"]]\nname = "x"\n',
  ])("reports an unrecognized Grok header as unknown", async (content) => {
    write(".grok/config.toml", content);
    expect(host(await detectHosts(env), "grok")).toMatchObject({
      registered: null,
      error: expect.stringContaining("unsupported Grok TOML table header"),
    });
  });

  it.each([
    ["inline table", 'mcp_servers.ask-llm = { command = "/opt/ask-llm-mcp", args = [] }\n'],
    ["root inline table", 'mcp_servers = { ask-llm = { command = "/opt/ask-llm-mcp" } }\n'],
    ["nested escaped key", '[mcp_servers]\n"ask\\u002dllm" = { command = "/opt/ask-llm-mcp" }\n'],
    ["dotted key", 'mcp_servers.ask-llm.command = "/opt/ask-llm-mcp"\n'],
    ["single-quoted header", "[mcp_servers.'ask-llm']\ncommand = \"/opt/ask-llm-mcp\"\n"],
    ["spaced header", '[ mcp_servers . ask-llm ]\ncommand = "/opt/ask-llm-mcp"\n'],
    ["nested ask-llm table", '[mcp_servers.ask-llm.command]\nvalue = "/opt/ask-llm-mcp"\n'],
    [
      "nested ask-llm array of tables",
      '[mcp_servers.ask-llm]\ncommand = "/opt/x"\n[[mcp_servers.ask-llm.env]]\nname = "x"\n',
    ],
    ["quoted field", '[mcp_servers.ask-llm]\n"command" = "/opt/ask-llm-mcp"\n'],
    ["single-quoted value", "[mcp_servers.ask-llm]\ncommand = '/opt/ask-llm-mcp'\n"],
    ["trailing comment", '[mcp_servers.ask-llm]\ncommand = "/opt/ask-llm-mcp" # active\n'],
    ["multiline array", '[mcp_servers.ask-llm]\ncommand = "/opt/ask-llm-mcp"\nargs = [\n  "--extra",\n]\n'],
    ["key syntax", '[mcp_servers.ask-llm]\ncommand = "/opt/ask-llm-mcp"\n"unparsed key" = true\n'],
  ])("reports unsupported Grok TOML %s as unknown", async (_form, content) => {
    write(".grok/config.toml", content);
    expect(host(await detectHosts(env), "grok")).toMatchObject({
      registered: null,
      error: expect.stringContaining("unsupported Grok TOML"),
    });
  });

  it("reports non-file registration surfaces as unreadable", async () => {
    for (const path of [".cursor/mcp.json", ".grok/config.toml", ".pi/agent/settings.json"]) {
      mkdirSync(join(home, path), { recursive: true });
    }
    const hosts = await detectHosts(env);
    for (const id of ["cursor", "grok", "pi"]) {
      expect(host(hosts, id)).toMatchObject({
        registered: null,
        error: expect.stringContaining("cannot read registration"),
      });
    }
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
