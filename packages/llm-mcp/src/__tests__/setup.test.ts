import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { detectHosts } from "../hosts/detect.js";
import { type HostId, hostSpecs } from "../hosts/registry.js";
import { commandText } from "../plan.js";
import { applySetup } from "../setup.js";
import {
  FAKE_HOSTS,
  fakeArgv,
  installFakeHost,
  installFakeNpx,
  setFakeMode,
  writeRegistration,
  writeUnusableRegistration,
} from "./_hostFakes.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ask-llm-setup-")));
const packageRoot = join(root, "lib/node_modules/@ask-llm/mcp");
mkdirSync(packageRoot, { recursive: true });
cpSync(fileURLToPath(new URL("../../dist", import.meta.url)), join(packageRoot, "dist"), { recursive: true });
cpSync(fileURLToPath(new URL("../../skills", import.meta.url)), join(packageRoot, "skills"), { recursive: true });
// A version no repository checkout carries proves setup reads the installed package it runs from.
const INSTALLED_VERSION = "9.9.9-installed";
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"));
writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ ...manifest, version: INSTALLED_VERSION }));
symlinkSync(fileURLToPath(new URL("../../../../node_modules", import.meta.url)), join(packageRoot, "node_modules"));
const command = join(packageRoot, "dist/ask-llm.js");
const server = join(packageRoot, "dist/cli.js");
const bin = join(root, "bin");
const home = join(root, "home");
const installedServer = join(bin, "ask-llm-mcp");
const path = `${bin}:/usr/bin:/bin`;
const env = {
  HOME: home,
  CODEX_HOME: join(home, ".codex"),
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_STATE_HOME: join(home, ".local/state"),
  PATH: path,
  ASK_LLM_PATH: path,
};
const FOREIGN = "/opt/other/ask-llm-mcp";
const HOSTS = Object.keys(FAKE_HOSTS);
const previousPath = process.env.ASK_LLM_PATH;
process.env.ASK_LLM_PATH = path;

const ADD: Record<string, string[]> = {
  claude: ["mcp", "add", "--scope", "user", "ask-llm", "--", installedServer],
  agy: ["mcp", "add", "ask-llm", installedServer],
  grok: ["mcp", "add", "--scope", "user", "ask-llm", installedServer],
  gemini: ["mcp", "add", "--scope", "user", "ask-llm", installedServer],
};

afterAll(() => {
  if (previousPath === undefined) delete process.env.ASK_LLM_PATH;
  else process.env.ASK_LLM_PATH = previousPath;
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  for (const dir of [bin, home]) rmSync(dir, { recursive: true, force: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  symlinkSync(server, installedServer);
  writeFileSync(
    join(bin, "npm"),
    `#!/bin/sh\nif [ "$1" = prefix ]; then echo '${root}'; else echo '${join(root, "lib/node_modules")}'; fi\n`,
    { mode: 0o755 },
  );
  for (const name of HOSTS) installFakeHost(bin, name);
  installFakeNpx(bin);
});

function ask(...args: string[]) {
  return spawnSync(process.execPath, [command, ...args], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
}

const CONFIG_FILES: Record<string, [string, string]> = {
  claude: [".claude.json", '{"projects":{}}'],
  codex: [".codex/config.toml", 'model = "gpt"\n'],
  agy: [".gemini/config/mcp_config.json", '{"mcpServers":{"other":{"command":"x"}}}'],
  grok: [".grok/config.toml", '[ui]\ntheme = "dark"\n'],
  gemini: [".gemini/settings.json", '{"theme":"dark"}'],
};

function writeConfigFiles(): void {
  for (const [file, content] of Object.values(CONFIG_FILES)) {
    mkdirSync(join(home, file, ".."), { recursive: true });
    writeFileSync(join(home, file), content);
  }
}

function backups(): string[] {
  return (readdirSync(home, { recursive: true }) as string[])
    .filter((file) => file.includes(".ask-llm-backup-"))
    .sort();
}

function calls(): Record<string, string[][]> {
  return Object.fromEntries(HOSTS.map((name) => [name, fakeArgv(home, name)]));
}

function installPi(mode = "ok"): void {
  writeFileSync(
    join(bin, "pi"),
    `#!${process.execPath}
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("0.87.1"); process.exit(0); }
appendFileSync(join(process.env.HOME, ".fake-pi-argv"), args.join("\\t") + "\\t\\n");
if (${JSON.stringify(mode)} === "fail") { console.error("install failed"); process.exit(2); }
if (${JSON.stringify(mode)} === "silent") process.exit(0);
if (args.length !== 2 || (args[0] !== "install" && args[0] !== "remove")) process.exit(9);
if (args[0] === "remove") {
  const file = join(process.env.PI_CODING_AGENT_DIR || join(process.env.HOME, ".pi/agent"), "settings.json");
  const settings = JSON.parse(readFileSync(file, "utf8"));
  settings.packages = settings.packages.filter((entry) => entry !== args[1]);
  writeFileSync(file, JSON.stringify(settings));
  process.exit(0);
}
const pkg = JSON.parse(readFileSync(join(args[1], "package.json"), "utf8"));
writeFileSync(join(process.env.HOME, ".fake-pi-version"), pkg.version);
const dir = process.env.PI_CODING_AGENT_DIR || join(process.env.HOME, ".pi/agent");
writeFileSync(join(process.env.HOME, ".fake-pi-profile"), dir);
mkdirSync(dir, { recursive: true });
const file = join(dir, "settings.json");
let settings = {};
try { settings = JSON.parse(readFileSync(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
settings.packages = [...(settings.packages ?? []), relative(dir, args[1])];
writeFileSync(file, JSON.stringify(settings));
`,
    { mode: 0o755 },
  );
}

describe("ask-llm setup", () => {
  it("registers hosts with persisted records and leaves list-only hosts manual", () => {
    const first = ask("setup", "-y");
    expect(first.stderr).toBe("");
    expect(first.status).toBe(1);
    expect(first.stdout).toContain("Antigravity skills: manual");
    expect(calls()).toEqual(Object.fromEntries(HOSTS.map((name) => [name, name === "codex" ? [] : [ADD[name]]])));
    expect(first.stdout).toContain("Claude Code 2.1.284: registered");
    expect(first.stdout).toContain("start a new session");
    expect(first.stdout).toContain("trusted folders");
    expect(first.stdout).toContain("may reformat its config file");
    expect(backups()).toEqual([]);

    const second = ask("setup", "-y");
    expect(second.status).toBe(1);
    expect(second.stdout).toContain("Codex CLI 0.158.0: manual");
    expect(second.stdout).toContain("Claude Code plugin: already installed");
    expect(second.stdout).toContain("Codex CLI skills: already installed");
    expect(second.stdout).toContain("No changes.");
    expect(calls()).toEqual(Object.fromEntries(HOSTS.map((name) => [name, name === "codex" ? [] : [ADD[name]]])));
    expect(readFileSync(join(home, "npx-argv"), "utf8").trim().split("\n")).toHaveLength(1);
    expect(readFileSync(join(home, ".fake-claude-plugin-argv"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("installs the Claude plugin in Claude Code and the skills everywhere else, previewed on --dry-run", () => {
    const preview = ask("setup", "--dry-run", "--json", "--host", "claude,codex,grok");
    const { workflows } = JSON.parse(preview.stdout);
    expect(workflows.plugins.map(({ id }: { id: string }) => id)).toEqual(["claude"]);
    expect(workflows.skills.agents.map(({ agent }: { agent: string }) => agent)).toEqual(["codex", "grok"]);
    expect(workflows.skills.source).toEqual({ dir: packageRoot, version: INSTALLED_VERSION });
    expect(workflows.skills.command).toMatch(/^DISABLE_TELEMETRY=1 npx -y skills@1\.7\.0 add \S+ --skill /);
    expect(workflows.skills.command).toContain(` add ${packageRoot} --skill `);
    expect(ask("setup", "--dry-run", "--host", "codex").stdout).toContain(
      `Skills for Codex CLI: install from @ask-llm/mcp ${INSTALLED_VERSION}`,
    );
    expect(ask("setup", "--dry-run", "--host", "claude,codex").stdout).toContain(
      "claude plugin marketplace add Lykhoyda/ask-llm && claude plugin install ask-llm@ask-llm-plugins",
    );
    expect(existsSync(join(home, "npx-argv"))).toBe(false);

    const result = ask("setup", "-y", "--host", "claude,codex,grok");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Claude Code plugin: installed");
    expect(result.stdout).toContain("Codex CLI skills: installed");
    expect(result.stdout).toContain("Grok Build skills: installed");
    const npx = readFileSync(join(home, "npx-argv"), "utf8");
    expect(npx).toContain(`add ${packageRoot} --skill `);
    expect(npx).toContain("-g -a codex grok -y");
    expect(readFileSync(join(home, ".agents/skills/ask-llm-review/SKILL.md"), "utf8")).toBe(
      readFileSync(join(packageRoot, "skills/ask-llm-review/SKILL.md"), "utf8"),
    );
    expect(npx).not.toContain("claude-code");
    expect(readFileSync(join(home, ".fake-claude-plugin-argv"), "utf8")).toBe(
      "plugin marketplace add Lykhoyda/ask-llm\nplugin install ask-llm@ask-llm-plugins\n",
    );
  });

  it("reports a failed skills install with the manual command", () => {
    writeFileSync(join(home, "npx-mode"), "fail");
    const result = ask("setup", "-y", "--host", "codex");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Codex CLI skills: failed (network error (exit 1))");
    expect(result.stdout).toContain(
      `Run it manually: DISABLE_TELEMETRY=1 npx -y skills@1.7.0 add ${packageRoot} --skill `,
    );
  });

  it("changes only the hosts named with --host", () => {
    expect(ask("setup", "-y", "--host", "claude,codex").status).toBe(1);
    expect(calls()).toEqual({ claude: [ADD.claude], codex: [], agy: [], grok: [], gemini: [] });
  });

  it("never overwrites a foreign ask-llm entry", () => {
    writeRegistration(home, "agy", FOREIGN);
    const file = join(home, FAKE_HOSTS.agy.file);
    const before = readFileSync(file, "utf8");
    const result = ask("setup", "-y", "--host", "agy");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`Antigravity 1.2.13: conflict`);
    expect(result.stdout).toContain(FOREIGN);
    expect(calls().agy).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("registers Grok over a TUI-written config with an array of tables", () => {
    const file = join(home, FAKE_HOSTS.grok.file);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(
      file,
      '[marketplace]\nofficial_marketplace_auto_installed = true\n\n[[marketplace.sources]]\nname = "official"\n',
    );

    const result = ask("setup", "-y", "--host", "grok");
    expect(result.status).toBe(0);
    expect(calls().grok).toEqual([ADD.grok]);
    expect(result.stdout).toContain("Grok Build 1.0.40: registered");
  });

  it.each([
    [
      "quoted bracket",
      `[mcp_servers.ask-llm]\ncommand = "${FOREIGN}"\n[mcp_servers."team]tools"]\ncommand = "${server}"\n`,
    ],
    ["root inline table", `mcp_servers = { ask-llm = { command = "${FOREIGN}" } }\n`],
    ["single-quoted key", `[mcp_servers.'ask-llm']\ncommand = "${FOREIGN}"\n`],
    ["escaped header key", `[mcp_servers."ask\\u002dllm"]\ncommand = "${FOREIGN}"\n`],
    ["escaped nested key", `[mcp_servers]\n"ask\\u002dllm" = { command = "${FOREIGN}" }\n`],
  ])("does not mutate an uncertain Grok registration written with %s", (_form, content) => {
    const file = join(home, FAKE_HOSTS.grok.file);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);

    const setup = ask("setup", "-y", "--host", "grok");
    const remove = ask("remove", "-y", "--host", "grok");
    expect(setup.status).toBe(1);
    expect(remove.status).toBe(1);
    expect(setup.stdout).toContain("cannot read registration");
    expect(setup.stdout).toContain(
      `Run it manually: ${commandText(["grok", "mcp", "add", "--scope", "user", "ask-llm", installedServer])}`,
    );
    expect(remove.stdout).toContain("cannot read registration");
    expect(calls().grok).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  it("stops a host that rejects the fixed argv with its version and the exact manual command", () => {
    setFakeMode(home, "grok", "fail");
    const result = ask("setup", "-y", "--host", "grok,codex");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Grok Build 1.0.40: failed");
    expect(result.stdout).toContain("unexpected argument --scope");
    expect(result.stdout).toContain(
      `Run it manually: ${commandText(["grok", "mcp", "add", "--scope", "user", "ask-llm", installedServer])}`,
    );
    expect(result.stdout).toContain("Codex CLI 0.158.0: manual");
  });

  it("reports a requested host that is not installed instead of dropping it", () => {
    unlinkSync(join(bin, "gemini"));
    const result = ask("setup", "-y", "--host", "gemini");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Gemini CLI: skipped (not installed)");
  });

  it.each([{ selection: [] }, { selection: ["--host", "pi"] }])(
    "installs Pi from this package with setup -y $selection",
    ({ selection }) => {
      installPi();
      const settings = join(home, ".pi/agent/settings.json");
      const original = JSON.stringify({ theme: "dark", packages: ["npm:other"] });
      mkdirSync(join(settings, ".."), { recursive: true });
      writeFileSync(settings, original);

      const preview = ask("setup", "--dry-run", "--json", "--host", "pi");
      const plan = JSON.parse(preview.stdout);
      expect(plan.hosts[0].registration.argv).toEqual(["pi", "install", packageRoot]);
      expect(plan.workflows.skills.source).toEqual({ dir: packageRoot, version: INSTALLED_VERSION });
      expect(fakeArgv(home, "pi")).toEqual([]);
      expect(readFileSync(settings, "utf8")).toBe(original);

      const result = ask("setup", "-y", ...selection);
      expect(result.status, result.stderr).toBe(selection.length ? 0 : 1);
      expect(result.stdout).toContain("Pi 0.87.1: registered");
      expect(result.stdout).toContain("Pi skills: installed");
      expect(result.stdout).not.toContain("Run it manually: pi install");
      expect(fakeArgv(home, "pi")).toEqual([["install", packageRoot]]);
      expect(readFileSync(join(home, ".fake-pi-version"), "utf8")).toBe(INSTALLED_VERSION);
      const installed = readFileSync(settings, "utf8");
      expect(JSON.parse(installed)).toEqual({
        theme: "dark",
        packages: ["npm:other", relative(join(home, ".pi/agent"), packageRoot)],
      });
      const backup = backups().find((file) => file.startsWith(".pi/agent/settings.json.ask-llm-backup-"));
      expect(backup).toBeDefined();
      expect(readFileSync(join(home, backup as string), "utf8")).toBe(original);

      const second = ask("setup", "-y", "--host", "pi");
      expect(second.status).toBe(0);
      expect(second.stdout).toContain("Pi 0.87.1: already registered");
      expect(second.stdout).toContain("Pi skills: already installed");
      const removed = ask("remove", "-y", "--host", "pi");
      expect(removed.stdout).toContain("remove does not handle Pi yet");
      expect(fakeArgv(home, "pi")).toEqual([["install", packageRoot]]);
      expect(readFileSync(settings, "utf8")).toBe(installed);
    },
  );

  it.each(["fail", "silent"])("reports Pi install mode %s as failed with the local manual command", (mode) => {
    installPi(mode);
    const result = ask("setup", "-y", "--host", "pi");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Pi 0.87.1: failed");
    expect(result.stdout).toContain(mode === "fail" ? "install failed (exit 2)" : "entry was not found after");
    expect(result.stdout).toContain(`Run it manually: pi install ${packageRoot}`);
    expect(fakeArgv(home, "pi")).toEqual([["install", packageRoot]]);
    expect(existsSync(join(home, ".pi/agent/settings.json"))).toBe(false);
  });

  it.each(["absolute", "relative", "tilde", "url"] as const)("uses the %s Pi profile for setup and backup", (form) => {
    installPi();
    const profile = join(home, "alternate pi");
    const override = {
      absolute: profile,
      relative: relative(root, profile),
      tilde: "~/alternate pi",
      url: pathToFileURL(profile).href,
    }[form];
    mkdirSync(profile);
    const settings = join(profile, "settings.json");
    const original = JSON.stringify({ theme: "dark", packages: ["npm:other"] });
    writeFileSync(settings, original);
    const run = (...args: string[]) =>
      spawnSync(process.execPath, [command, "setup", ...args, "--host", "pi"], {
        cwd: root,
        env: { ...env, PI_CODING_AGENT_DIR: override },
        encoding: "utf8",
        timeout: 60_000,
      });
    expect(run("--dry-run").status).toBe(0);
    expect(fakeArgv(home, "pi")).toEqual([]);
    const first = run("-y");
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("Pi 0.87.1: registered");
    expect(readFileSync(join(home, ".fake-pi-profile"), "utf8")).toBe(profile);
    expect(JSON.parse(readFileSync(settings, "utf8"))).toEqual({
      theme: "dark",
      packages: ["npm:other", relative(profile, packageRoot)],
    });
    const saved = backups();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/^alternate pi\/settings.json.ask-llm-backup-/);
    expect(readFileSync(join(home, saved[0]), "utf8")).toBe(original);
    expect(first.stdout).toContain(`Backup: ${join(home, saved[0])}`);
    expect(existsSync(join(home, ".pi"))).toBe(false);
    const second = run("-y");
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Pi 0.87.1: already registered");
    expect(fakeArgv(home, "pi")).toEqual([["install", packageRoot]]);
    expect(backups()).toEqual(saved);
  });

  it("leaves Pi untouched when its registration is declined", async () => {
    installPi();
    const questions: string[] = [];
    const hosts = await detectHosts(env);
    const pi = hosts.find(({ id }) => id === "pi");
    const registration = pi?.spec.registration;
    expect(registration?.kind).toBe("command");
    const results = await applySetup(
      hosts,
      server,
      ["pi"],
      async (question) => {
        questions.push(question);
        return false;
      },
      env,
    );
    expect(results).toEqual([expect.objectContaining({ id: "pi", status: "declined" })]);
    expect(questions).toEqual([
      `Register Ask LLM with Pi? Runs: ${registration?.kind === "command" ? commandText(registration.argv(server)) : ""}`,
    ]);
    expect(fakeArgv(home, "pi")).toEqual([]);
    expect(existsSync(join(home, ".pi/agent/settings.json"))).toBe(false);
  });

  it("recognizes Pi's record of a local install as this package's registration", () => {
    writeFileSync(join(bin, "pi"), '#!/bin/sh\n[ "$1" = "--version" ] && { echo "0.87.1"; exit 0; }\nexit 9\n', {
      mode: 0o755,
    });
    const agentDir = join(home, ".pi/agent");
    mkdirSync(agentDir, { recursive: true });
    // `pi install <dir>` stores a user-scope local package relative to Pi's agent folder.
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [relative(agentDir, packageRoot)] }));
    const preview = ask("setup", "--dry-run", "--json", "--host", "pi");
    expect(JSON.parse(preview.stdout).hosts).toEqual([expect.objectContaining({ id: "pi", action: "up-to-date" })]);
  });

  it.each([
    "npm:@ask-llm/plugin",
    { source: "npm:@ask-llm/plugin" },
    "npm:@ask-llm/plugin@0.19.4",
    { source: "npm:@ask-llm/plugin@0.19.4" },
  ])(
    "preserves the Pi npm bridge %j and repeats migration guidance",
    (entry) => {
      installPi();
      const settings = join(home, ".pi/agent/settings.json");
      mkdirSync(join(home, ".pi/agent"), { recursive: true });
      const before = JSON.stringify({ theme: "dark", packages: [entry] });
      writeFileSync(settings, before);

      const preview = ask("setup", "--dry-run", "--json", "--host", "pi");
      expect(preview.status).toBe(0);
      const plan = JSON.parse(preview.stdout);
      expect(plan.hosts).toEqual([expect.objectContaining({ id: "pi", action: "conflict" })]);
      expect(plan.migration).toEqual([expect.objectContaining({ id: "pi", action: "guidance" })]);

      for (let run = 0; run < 2; run++) {
        const result = ask("setup", "-y", "--host", "pi");
        expect(result.status, result.stdout + result.stderr).toBe(1);
        expect(result.stdout).toContain("unverified package compatibility");
        expect(result.stdout).toContain("preserve package filters");
        expect(readFileSync(settings, "utf8")).toBe(before);
        expect(fakeArgv(home, "pi")).toEqual([]);
      }
      const again = ask("setup", "--dry-run", "--json", "--host", "pi");
      expect(JSON.parse(again.stdout).migration).toEqual(plan.migration);
    },
  );

  it("reports a foreign file-host entry with the entry it would use and leaves the file alone", () => {
    writeFileSync(join(bin, "cursor-agent"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const content = JSON.stringify({ mcpServers: { "ask-llm": { command: FOREIGN } } });
    writeFileSync(join(home, ".cursor/mcp.json"), content);
    const result = ask("setup", "-y", "--host", "cursor");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`Cursor: conflict (an ask-llm entry already runs \`${FOREIGN}\``);
    expect(result.stdout).toContain(
      `Entry for this install (not written): preserve custom settings and command options you still need, then: replace mcpServers.ask-llm in ${join(home, ".cursor/mcp.json")} with {"command":"${installedServer}","args":[]}`,
    );
    expect(result.stdout).not.toContain("Run it manually");
    expect(readFileSync(join(home, ".cursor/mcp.json"), "utf8")).toBe(content);
    expect(ask("remove", "-y", "--host", "cursor").stdout).toContain("Cursor: not removed");
    expect(readFileSync(join(home, ".cursor/mcp.json"), "utf8")).toBe(content);
  });

  it("refuses without a terminal or -y before touching any host", () => {
    const result = ask("setup");
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("-y");
    expect(calls()).toEqual(Object.fromEntries(HOSTS.map((name) => [name, []])));
  });

  it.each([
    [["-y", "--host", "vim"], "unknown host: vim"],
    [["-y", "--host"], "--host needs"],
    [["--json"], "--json"],
    [["-y", "--bogus"], "unsupported setup argument"],
  ])("rejects %j", (args, message) => {
    const result = ask("setup", ...args);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(calls()).toEqual(Object.fromEntries(HOSTS.map((name) => [name, []])));
  });

  it("backs up each host's config file before its command writes it", () => {
    writeConfigFiles();
    const result = ask("setup", "-y");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Each backup may contain credentials");
    expect(result.stdout).toContain("remains until you delete it");
    const saved = backups();
    expect(saved).toHaveLength(HOSTS.length - 1);
    for (const [id, [file, content]] of Object.entries(CONFIG_FILES)) {
      if (id === "codex") {
        expect(readFileSync(join(home, file), "utf8")).toBe(content);
        continue;
      }
      const backup = saved.find((path) => path.startsWith(`${file}.ask-llm-backup-`));
      expect(backup).toBeDefined();
      expect(readFileSync(join(home, backup as string), "utf8")).toBe(content);
      expect(result.stdout).toContain(`Backup: ${join(home, backup as string)}`);
    }

    expect(ask("setup", "-y").stdout).not.toContain("Backup:");
    expect(backups()).toEqual(saved);
  });

  it("makes no backup on --dry-run", () => {
    writeConfigFiles();
    expect(ask("setup", "--dry-run").status).toBe(0);
    expect(backups()).toEqual([]);
  });

  it("keeps --dry-run a preview even with -y", () => {
    const result = ask("setup", "--dry-run", "-y", "--json");
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ schema: "ask-llm.setup-plan", dryRun: true });
    expect(calls()).toEqual(Object.fromEntries(HOSTS.map((name) => [name, []])));
  });

  it("refuses to apply from package-dist while keeping its dry-run preview", () => {
    unlinkSync(installedServer);
    const preview = ask("setup", "--dry-run", "--json");
    expect(preview.status).toBe(0);
    expect(JSON.parse(preview.stdout).server).toEqual({ path: server, source: "package-dist" });

    const result = ask("setup", "-y", "--host", "claude");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("npm i -g @ask-llm/mcp");
    expect(result.stderr).toContain("rerun `ask-llm setup`");
    expect(calls()).toEqual(Object.fromEntries(HOSTS.map((name) => [name, []])));
  });

  it("refuses a project-local bin even when it points to the running package", () => {
    const checkoutCommand = fileURLToPath(new URL("../../dist/ask-llm.js", import.meta.url));
    const checkoutServer = realpathSync(fileURLToPath(new URL("../../dist/cli.js", import.meta.url)));
    unlinkSync(installedServer);
    symlinkSync(checkoutServer, installedServer);

    const preview = spawnSync(process.execPath, [checkoutCommand, "setup", "--dry-run", "--json"], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(JSON.parse(preview.stdout).server).toEqual({ path: checkoutServer, source: "package-dist" });

    const result = spawnSync(process.execPath, [checkoutCommand, "setup", "-y", "--host", "claude"], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("npm i -g @ask-llm/mcp");
    expect(calls().claude).toEqual([]);
  });

  it("asks once per host and leaves declined hosts untouched", async () => {
    const asked: string[] = [];
    const isolated = env;
    const confirm = async (question: string) => {
      asked.push(question);
      return question.includes("Claude Code");
    };
    const results = await applySetup(await detectHosts(isolated), server, HOSTS as HostId[], confirm, isolated);
    expect(asked).toHaveLength(4);
    expect(asked[0]).toContain(commandText(["claude", "mcp", "add", "--scope", "user", "ask-llm", "--", server]));
    expect(calls()).toEqual({
      claude: [["mcp", "add", "--scope", "user", "ask-llm", "--", server]],
      codex: [],
      agy: [],
      grok: [],
      gemini: [],
    });
    expect(results.find(({ id }) => id === "codex")).toMatchObject({ status: "manual" });
  });
});

describe("ask-llm setup and remove for file hosts", () => {
  const specs = hostSpecs({ HOME: home });
  const configOf = (id: HostId) => specs.find((spec) => spec.id === id)?.configFile as string;
  const OTHER = { command: "uvx", args: ["mcp-server-time"], env: { TZ: "UTC" } };

  function install(name: string, version = "1.0.0"): void {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${version}"\n`, { mode: 0o755 });
  }

  function fixture(id: HostId, content: string): string {
    const file = configOf(id);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, content);
    return file;
  }

  it("merges Cursor's entry beside unrelated servers, tells the user to restart, and removes it again", () => {
    install("cursor-agent", "2026.09.26-dd393fe");
    const original = `${JSON.stringify({ mcpServers: { time: OTHER } }, null, 2)}\n`;
    const file = fixture("cursor", original);

    const first = ask("setup", "-y", "--host", "cursor");
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(`merge {"command":"${installedServer}","args":[]} at mcpServers.ask-llm in ${file}`);
    expect(first.stdout).toContain("Cursor: registered");
    expect(first.stdout).toContain("Next: restart the app to load the change");
    expect(JSON.parse(readFileSync(file, "utf8")).mcpServers).toEqual({
      time: OTHER,
      "ask-llm": { command: installedServer, args: [] },
    });
    const [backup] = backups();
    expect(first.stdout).toContain(`Backup: ${join(home, backup)}`);
    expect(readFileSync(join(home, backup), "utf8")).toBe(original);

    const second = ask("setup", "-y", "--host", "cursor");
    expect(second.stdout).toContain("Cursor: already registered");
    expect(second.stdout).toContain("No changes.");
    expect(backups()).toEqual([backup]);

    const removed = ask("remove", "-y", "--host", "cursor");
    expect(removed.status).toBe(0);
    expect(removed.stdout).toContain("Cursor: removed");
    expect(removed.stdout).toContain("restart the app");
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("round-trips a Claude Desktop config byte for byte", () => {
    install("claude-desktop");
    const original = `${JSON.stringify(
      { mcpServers: { time: OTHER }, preferences: { menuBarEnabled: false } },
      null,
      2,
    )}\n`;
    const file = fixture("claude-desktop", original);
    expect(ask("setup", "-y", "--host", "claude-desktop").stdout).toContain("Claude Desktop: registered");
    expect(JSON.parse(readFileSync(file, "utf8")).mcpServers["ask-llm"]).toEqual({
      command: installedServer,
      args: [],
    });
    expect(ask("remove", "-y", "--host", "claude-desktop").stdout).toContain("Claude Desktop: removed");
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("registers OpenCode in an absent config and says it is fixture-verified only", () => {
    install("opencode", "1.14.3");
    const result = ask("setup", "-y", "--host", "opencode");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("OpenCode 1.14.3: registered");
    expect(result.stdout).toContain("verified against fixture files only");
    expect(JSON.parse(readFileSync(configOf("opencode"), "utf8"))).toEqual({
      mcp: { "ask-llm": { type: "local", command: [installedServer], enabled: true } },
    });
  });

  it.each([
    ["an opencode.jsonc beside it", "opencode.jsonc", '{\n  // mine\n  "mcp": {}\n}\n'],
    ["comments in opencode.json", "opencode.json", '{\n  // mine\n  "mcp": {}\n}\n'],
  ])("prints OpenCode's exact entry instead of writing with %s", (_, name, content) => {
    install("opencode", "1.14.3");
    const file = join(configOf("opencode"), "..", name);
    fixture("opencode", "{}\n");
    writeFileSync(file, content);
    const result = ask("setup", "-y", "--host", "opencode");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("OpenCode 1.14.3: manual (cannot read registration");
    expect(result.stdout).toContain(
      `Run it manually: add {"type":"local","command":["${installedServer}"],"enabled":true} at mcp.ask-llm in ${configOf("opencode")}`,
    );
    expect(readFileSync(file, "utf8")).toBe(content);
    expect(backups()).toEqual([]);
  });
});

describe("ask-llm remove", () => {
  const REMOVE: Record<string, string[]> = {
    claude: ["mcp", "remove", "--scope", "user", "ask-llm"],
    agy: ["mcp", "remove", "ask-llm"],
    grok: ["mcp", "remove", "--scope", "user", "ask-llm"],
    gemini: ["mcp", "remove", "--scope", "user", "ask-llm"],
  };

  it("deletes every entry that runs this ask-llm-mcp and nothing else", () => {
    for (const name of HOSTS) writeRegistration(home, name, name === "codex" ? FOREIGN : server);
    const codexFile = readFileSync(join(home, FAKE_HOSTS.codex.file), "utf8");
    const result = ask("remove", "-y");
    expect(result.status).toBe(1);
    expect(calls()).toEqual({ ...Object.fromEntries(Object.entries(REMOVE).map(([k, v]) => [k, [v]])), codex: [] });
    expect(result.stdout).toContain("Claude Code 2.1.284: removed");
    expect(result.stdout).toContain("Codex CLI 0.158.0: manual");
    expect(readFileSync(join(home, FAKE_HOSTS.codex.file), "utf8")).toBe(codexFile);
    expect(result.stdout).toContain("may reformat its config file");
    const saved = backups();
    expect(saved.map((file) => file.replace(/\.ask-llm-backup-.*$/, ""))).toEqual(
      ["claude", "agy", "grok", "gemini"].map((name) => FAKE_HOSTS[name].file).sort(),
    );
    for (const file of saved) {
      expect(readFileSync(join(home, file), "utf8")).toContain(server);
    }

    const before = calls();
    const again = ask("remove", "-y");
    expect(again.status).toBe(1);
    expect(again.stdout).toContain("No changes.");
    expect(calls()).toEqual(before);
  });

  it("round-trips setup and remove", () => {
    expect(ask("setup", "-y").stdout).toContain("Antigravity skills: manual");
    expect(ask("remove", "-y", "--host", "claude").status).toBe(0);
    expect(fakeArgv(home, "claude")).toEqual([ADD.claude, ["mcp", "remove", "--scope", "user", "ask-llm"]]);
    expect(ask("setup", "-y").stdout).toContain("Claude Code 2.1.284: registered");
  });

  it("leaves a disabled or command-less entry in place and says so", () => {
    writeUnusableRegistration(home, "agy");
    const result = ask("remove", "-y", "--host", "agy");
    expect(result.stdout).toContain("Antigravity 1.2.13: not removed (an ask-llm entry exists but is disabled");
    expect(calls().agy).toEqual([]);
  });

  it("never offers an unverified removal as a manual step", () => {
    writeRegistration(home, "agy", server);
    writeFileSync(join(home, FAKE_HOSTS.agy.file), "{");
    const result = ask("remove", "-y", "--host", "agy");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("cannot read registration");
    expect(result.stdout).not.toContain("Run it manually");
    expect(calls().agy).toEqual([]);
  });

  it("refuses without a terminal or -y", () => {
    writeRegistration(home, "claude", server);
    const result = ask("remove");
    expect(result.status).toBe(2);
    expect(calls().claude).toEqual([]);
  });
});
