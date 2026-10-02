import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type DetectedHost, detectHosts } from "../hosts/detect.js";
import { legacyPackage } from "../hosts/legacy.js";
import type { HostId } from "../hosts/registry.js";
import { applyMigration, planMigration } from "../migrate.js";
import { buildPlan } from "../plan.js";
import { applyRemove } from "../remove.js";
import { applySetup } from "../setup.js";
import {
  installMigrationHost,
  MIGRATION_HOSTS,
  type MigrationHost,
  migrationArgv,
  readHostFile,
  seedServers,
  serverNames,
  setMigrationMode,
} from "./_migrationFakes.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ask-llm-migrate-")));
const bin = join(root, "bin");
const home = join(root, "home");
const SERVER = join(root, "global", "ask-llm-mcp");
const previousPath = process.env.ASK_LLM_PATH;
process.env.ASK_LLM_PATH = `${bin}:/usr/bin:/bin`;
const env = { HOME: home, PATH: process.env.ASK_LLM_PATH };
const yes = async () => true;

const NPX_UNIFIED = ["npx", "-y", "@ask-llm/mcp"];
const OTHER = { command: ["uvx", "some-other-server"] };

afterAll(() => {
  if (previousPath === undefined) delete process.env.ASK_LLM_PATH;
  else process.env.ASK_LLM_PATH = previousPath;
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  for (const dir of [bin, home, join(root, "global")]) rmSync(dir, { recursive: true, force: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, "global"), { recursive: true });
  writeFileSync(SERVER, "#!/bin/sh\n", { mode: 0o755 });
});

function install(...hosts: MigrationHost[]): void {
  for (const host of hosts) installMigrationHost(bin, host);
}

function installPi(): void {
  writeFileSync(
    join(bin, "pi"),
    `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("0.87.1"); process.exit(0); }
appendFileSync(join(process.env.HOME, ".fake-pi-argv"), args.join("\\t") + "\\t\\n");
const file = join(process.env.PI_CODING_AGENT_DIR, "settings.json");
const settings = JSON.parse(readFileSync(file, "utf8"));
if (args[0] === "install") settings.packages.push(args[1]);
else if (args[0] === "remove") settings.packages = settings.packages.filter((entry) => entry !== args[1]);
else process.exit(9);
writeFileSync(file, JSON.stringify(settings));
`,
  );
  chmodSync(join(bin, "pi"), 0o755);
}

function piPackages(...packages: string[]): void {
  mkdirSync(join(home, ".pi/agent"), { recursive: true });
  writeFileSync(join(home, ".pi/agent/settings.json"), JSON.stringify({ theme: "dark", packages }));
}

function claudePlugin(): void {
  mkdirSync(join(home, ".claude/plugins"), { recursive: true });
  writeFileSync(join(home, ".claude/plugins/known_marketplaces.json"), '{"ask-llm-plugins":{}}');
  writeFileSync(
    join(home, ".claude/plugins/installed_plugins.json"),
    '{"version":2,"plugins":{"ask-llm@ask-llm-plugins":[{"scope":"user"}]}}',
  );
}

function host(hosts: DetectedHost[], id: HostId): DetectedHost {
  const found = hosts.find((entry) => entry.id === id);
  if (!found) throw new Error(`host ${id} missing`);
  return found;
}

async function migrate(selected?: HostId[]) {
  const hosts = await detectHosts(env);
  const plan = buildPlan(hosts, SERVER);
  const findings = await planMigration(hosts, selected, env);
  const registrations = await applySetup(hosts, SERVER, selected, yes, env);
  const migrated = await applyMigration(findings, hosts, registrations, yes, env);
  return { hosts, plan, findings, registrations, migrated };
}

describe("legacyPackage", () => {
  it.each([
    [["npx", "-y", "@ask-llm/mcp"], "@ask-llm/mcp"],
    [["npx", "--yes", "@ask-llm/mcp@latest"], "@ask-llm/mcp"],
    [["/usr/local/bin/npx", "-y", "ask-llm-mcp"], "@ask-llm/mcp"],
    [["ask-llm-mcp"], "@ask-llm/mcp"],
    [["npx", "-y", "@ask-llm/codex-mcp"], "@ask-llm/codex-mcp"],
    [["npx", "-y", "ask-gemini-mcp@1.6.7"], "@ask-llm/gemini-mcp"],
    [["npx", "-y", "@anton-lykhoyda/ask-claude-mcp"], "@ask-llm/claude-mcp"],
    [["ask-grok-mcp"], "@ask-llm/grok-mcp"],
    [["/home/me/.npm-global/bin/ask-ollama-mcp"], "@ask-llm/ollama-mcp"],
    [["node", "/usr/lib/node_modules/@ask-llm/antigravity-mcp/dist/cli.js"], "@ask-llm/antigravity-mcp"],
  ])("recognizes %j as %s", (command, expected) => {
    expect(legacyPackage(command)).toBe(expected);
  });

  it.each([
    [["npx", "-y", "@ask-llm/mcp", "--debug"]],
    [["npx", "-y", "@ask-llm/mcp-extra"]],
    [["npx", "-y", "some-other-server"]],
    [["/opt/other/ask-llm-mcp"]],
    [["node", "/home/me/ask-llm/packages/llm-mcp/dist/cli.js"]],
    [["ask-codex-mcp", "--flag"]],
    [[]],
  ])("does not claim %j", (command) => {
    expect(legacyPackage(command)).toBeUndefined();
  });
});

describe("migration of existing installations", () => {
  it("MCP-only: replaces each npx ask-llm entry with this install and keeps unrelated entries", async () => {
    install("claude", "codex", "agy");
    seedServers(home, "claude", { other: OTHER, "ask-llm": { command: NPX_UNIFIED } }, { projects: {} });
    seedServers(home, "codex", { "ask-llm": { command: ["npx", "-y", "@ask-llm/mcp@latest"] }, other: OTHER });
    seedServers(home, "agy", { "ask-llm": { command: ["ask-llm-mcp"] } });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(bin, "cursor-agent"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const cursorFile = join(home, ".cursor/mcp.json");
    writeFileSync(
      cursorFile,
      JSON.stringify(
        { mcpServers: { other: { command: "uvx" }, "ask-llm": { command: "npx", args: ["-y", "@ask-llm/mcp"] } } },
        null,
        2,
      ),
    );

    const { plan, findings, registrations } = await migrate(["claude", "codex", "agy", "cursor"]);
    for (const id of ["claude", "codex", "agy", "cursor"])
      expect(plan.find((entry) => entry.id === id)?.action, id).toBe("replace");
    expect(findings).toEqual([]);
    expect(registrations.map(({ id, status }) => [id, status])).toEqual([
      ["claude", "replaced"],
      ["codex", "replaced"],
      ["agy", "replaced"],
      ["cursor", "replaced"],
    ]);

    expect(serverNames(home, "claude")).toEqual({ other: OTHER.command, "ask-llm": [SERVER] });
    expect(JSON.parse(readHostFile(home, "claude")).projects).toEqual({});
    expect(serverNames(home, "codex")).toEqual({ other: OTHER.command, "ask-llm": [SERVER] });
    expect(serverNames(home, "agy")).toEqual({ "ask-llm": [SERVER] });
    expect(JSON.parse(readFileSync(cursorFile, "utf8")).mcpServers).toEqual({
      other: { command: "uvx" },
      "ask-llm": { command: SERVER, args: [] },
    });
    // Claude refuses to add over an existing name, so its entry is removed first; the others overwrite in place.
    expect(migrationArgv(home, "claude")).toEqual([
      ["mcp", "remove", "--scope", "user", "ask-llm"],
      ["mcp", "add", "--scope", "user", "ask-llm", "--", SERVER],
    ]);
    expect(migrationArgv(home, "codex")).toEqual([["mcp", "add", "ask-llm", "--", SERVER]]);

    const again = await migrate(["claude", "codex", "agy", "cursor"]);
    expect(again.registrations.every(({ status }) => status === "up-to-date")).toBe(true);
    expect(again.findings).toEqual([]);
  });

  it("plugin-only: keeps the Claude Code plugin, registers the server, and moves Pi off the plugin bridge", async () => {
    install("claude");
    installPi();
    claudePlugin();
    piPackages("npm:@ask-llm/plugin");

    const { hosts, plan, findings, registrations, migrated } = await migrate(["claude", "pi"]);
    expect(host(hosts, "pi")).toMatchObject({ registered: false, legacy: ["npm:@ask-llm/plugin"] });
    expect(plan.find(({ id }) => id === "claude")?.action).toBe("register");
    expect(plan.find(({ id }) => id === "pi")).toMatchObject({
      action: "register",
      reason: expect.stringContaining("npm:@ask-llm/plugin"),
    });
    expect(findings).toEqual([
      expect.objectContaining({
        id: "pi",
        entry: "npm:@ask-llm/plugin",
        action: "retire",
        change: "pi remove npm:@ask-llm/plugin",
      }),
    ]);
    expect(registrations.map(({ id, status }) => [id, status])).toEqual([
      ["claude", "registered"],
      ["pi", "registered"],
    ]);
    expect(migrated).toEqual([expect.objectContaining({ id: "pi", status: "retired" })]);
    const settings = JSON.parse(readFileSync(join(home, ".pi/agent/settings.json"), "utf8"));
    expect(settings.theme).toBe("dark");
    expect(settings.packages).toHaveLength(1);
    expect(settings.packages[0]).not.toContain("@ask-llm/plugin");
    expect(readFileSync(join(home, ".claude/plugins/installed_plugins.json"), "utf8")).toContain(
      "ask-llm@ask-llm-plugins",
    );
  });

  it("combined: replaces the npx entry next to the plugin and retires the duplicate Pi bridge", async () => {
    install("claude");
    installPi();
    claudePlugin();
    seedServers(home, "claude", { "ask-llm": { command: NPX_UNIFIED } });
    piPackages("npm:@ask-llm/mcp", "npm:@ask-llm/plugin@0.19.4");

    const { plan, findings, registrations, migrated } = await migrate(["claude", "pi"]);
    expect(plan.map(({ id, action }) => [id, action])).toContainEqual(["pi", "up-to-date"]);
    expect(findings.map(({ entry, action }) => [entry, action])).toEqual([["npm:@ask-llm/plugin@0.19.4", "retire"]]);
    expect(registrations.map(({ id, status }) => [id, status])).toEqual([
      ["claude", "replaced"],
      ["pi", "up-to-date"],
    ]);
    expect(migrated.map(({ status }) => status)).toEqual(["retired"]);
    expect(JSON.parse(readFileSync(join(home, ".pi/agent/settings.json"), "utf8")).packages).toEqual([
      "npm:@ask-llm/mcp",
    ]);
  });

  it("split-provider: registers the server, then retires every split entry and leaves other servers alone", async () => {
    install(...MIGRATION_HOSTS);
    seedServers(home, "claude", {
      codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
      "gemini-cli": { command: ["npx", "-y", "ask-gemini-mcp"] },
      other: OTHER,
    });
    seedServers(home, "codex", { claude: { command: ["npx", "-y", "@ask-llm/claude-mcp"] }, other: OTHER });
    seedServers(home, "agy", { antigravity: { command: ["ask-antigravity-mcp"] } });
    seedServers(home, "grok", { ollama: { command: ["npx", "-y", "@ask-llm/ollama-mcp"] }, other: OTHER });
    seedServers(home, "gemini", { codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] } });

    const { findings, registrations, migrated } = await migrate();
    expect(findings.map(({ id, entry, package: pkg, action }) => [id, entry, pkg, action])).toEqual([
      ["claude", "codex", "@ask-llm/codex-mcp", "retire"],
      ["claude", "gemini-cli", "@ask-llm/gemini-mcp", "retire"],
      ["codex", "claude", "@ask-llm/claude-mcp", "retire"],
      ["agy", "antigravity", "@ask-llm/antigravity-mcp", "retire"],
      ["grok", "ollama", "@ask-llm/ollama-mcp", "retire"],
      ["gemini", "codex", "@ask-llm/codex-mcp", "retire"],
    ]);
    expect(findings[0].change).toBe("claude mcp remove --scope user codex");
    expect(registrations.every(({ status }) => status === "registered")).toBe(true);
    expect(migrated.every(({ status }) => status === "retired")).toBe(true);

    expect(serverNames(home, "claude")).toEqual({ other: OTHER.command, "ask-llm": [SERVER] });
    expect(serverNames(home, "codex")).toEqual({ other: OTHER.command, "ask-llm": [SERVER] });
    expect(serverNames(home, "agy")).toEqual({ "ask-llm": [SERVER] });
    expect(serverNames(home, "grok")).toEqual({ other: OTHER.command, "ask-llm": [SERVER] });
    expect(readHostFile(home, "grok")).toContain('[ui]\ntheme = "dark"');
    expect(serverNames(home, "gemini")).toEqual({ "ask-llm": [SERVER] });
    expect(migrationArgv(home, "grok").at(-1)).toEqual(["mcp", "remove", "--scope", "user", "ollama"]);
  });

  it("keeps split entries when Ask LLM did not get registered in that host", async () => {
    install("claude");
    seedServers(home, "claude", { codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] } });
    setMigrationMode(home, "claude", "fail-add");
    const { registrations, migrated } = await migrate(["claude"]);
    expect(registrations[0].status).toBe("failed");
    expect(migrated).toEqual([expect.objectContaining({ status: "kept" })]);
    expect(serverNames(home, "claude")).toEqual({ codex: ["npx", "-y", "@ask-llm/codex-mcp"] });
  });

  it("customised: gives guidance for entries with their own settings and never deletes them", async () => {
    install("claude", "grok");
    seedServers(home, "claude", {
      "ask-llm": { command: NPX_UNIFIED, env: { GEMINI_API_KEY: "secret-gemini" } },
      grok: { command: ["npx", "-y", "@ask-llm/grok-mcp"], env: { XAI_API_KEY: "secret-xai" } },
      mine: { command: ["/home/me/bin/llm-wrapper.sh"] },
    });
    seedServers(home, "grok", {
      grok: { command: ["npx", "-y", "@ask-llm/grok-mcp"], env: { XAI_API_KEY: "secret-xai" } },
    });
    const before = { claude: readHostFile(home, "claude"), grok: readHostFile(home, "grok") };

    const { plan, findings, registrations, migrated } = await migrate(["claude", "grok"]);
    const claudePlan = plan.find(({ id }) => id === "claude");
    expect(claudePlan).toMatchObject({ action: "conflict", reason: expect.stringContaining("env GEMINI_API_KEY") });
    expect(claudePlan?.manual).toContain("claude mcp remove --scope user ask-llm");
    expect(findings.map(({ id, entry, action }) => [id, entry, action])).toEqual([
      ["claude", "grok", "guidance"],
      ["grok", "grok", "guidance"],
    ]);
    expect(findings[0].reason).toContain("env XAI_API_KEY");
    expect(JSON.stringify([plan, findings, registrations, migrated])).not.toMatch(/secret-/);
    expect(registrations.map(({ id, status }) => [id, status])).toEqual([
      ["claude", "conflict"],
      ["grok", "registered"],
    ]);
    expect(migrated.map(({ status }) => status)).toEqual(["manual", "manual"]);
    expect(readHostFile(home, "claude")).toBe(before.claude);
    expect(readHostFile(home, "grok")).toContain(before.grok.trimEnd().split("\n\n").slice(1).join("\n\n"));
    expect(migrationArgv(home, "claude")).toEqual([]);
  });

  it("does not report or touch an entry it cannot classify", async () => {
    install("claude");
    seedServers(home, "claude", { mine: { command: ["/home/me/bin/llm-wrapper.sh"] }, other: OTHER });
    const { findings } = await migrate(["claude"]);
    expect(findings).toEqual([]);
    expect(serverNames(home, "claude")).toEqual({
      mine: ["/home/me/bin/llm-wrapper.sh"],
      other: OTHER.command,
      "ask-llm": [SERVER],
    });
  });

  it("asks before each change and changes nothing that was declined", async () => {
    install("claude");
    seedServers(home, "claude", {
      "ask-llm": { command: NPX_UNIFIED },
      codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
    });
    const before = readHostFile(home, "claude");
    const questions: string[] = [];
    const no = async (question: string) => {
      questions.push(question);
      return false;
    };
    const hosts = await detectHosts(env);
    const findings = await planMigration(hosts, ["claude"], env);
    const registrations = await applySetup(hosts, SERVER, ["claude"], no, env);
    const migrated = await applyMigration(findings, hosts, registrations, no, env);
    expect(questions[0]).toContain("claude mcp remove --scope user ask-llm");
    expect(questions[0]).toContain(`claude mcp add --scope user ask-llm -- ${SERVER}`);
    expect(registrations[0].status).toBe("declined");
    expect(migrated[0].status).toBe("kept");
    expect(readHostFile(home, "claude")).toBe(before);
  });

  it("does not replace an entry that changed after the preview", async () => {
    install("claude");
    seedServers(home, "claude", { "ask-llm": { command: NPX_UNIFIED } });
    const hosts = await detectHosts(env);
    seedServers(home, "claude", { "ask-llm": { command: ["/opt/custom/ask-llm-mcp"] } });
    const [result] = await applySetup(hosts, SERVER, ["claude"], yes, env);
    expect(result.status).toBe("conflict");
    expect(serverNames(home, "claude")).toEqual({ "ask-llm": ["/opt/custom/ask-llm-mcp"] });
    expect(migrationArgv(home, "claude")).toEqual([]);
  });

  it("rollback restores only the replaced entry and leaves edits made meanwhile intact", async () => {
    install("claude");
    seedServers(home, "claude", { "ask-llm": { command: NPX_UNIFIED }, other: OTHER }, { theme: "dark" });
    setMigrationMode(home, "claude", "fail-add-after-user-edit");
    const [result] = (await migrate(["claude"])).registrations;
    expect(result.status).toBe("failed");
    expect(result.detail).toContain("earlier entry restored");
    expect(result.backup).toBeDefined();
    const after = JSON.parse(readHostFile(home, "claude"));
    expect(after.userEdit).toBe("made while setup ran");
    expect(after.theme).toBe("dark");
    expect(serverNames(home, "claude")).toEqual({ other: OTHER.command, "ask-llm": NPX_UNIFIED });
    expect(migrationArgv(home, "claude")).toEqual([
      ["mcp", "remove", "--scope", "user", "ask-llm"],
      ["mcp", "add", "--scope", "user", "ask-llm", "--", SERVER],
      ["mcp", "add", "--scope", "user", "ask-llm", "--", ...NPX_UNIFIED],
    ]);
  });

  it("a later remove takes out only this install's entry and keeps every user entry", async () => {
    install("claude", "codex");
    seedServers(
      home,
      "claude",
      { "ask-llm": { command: NPX_UNIFIED }, codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] }, other: OTHER },
      { theme: "dark" },
    );
    seedServers(home, "codex", { other: OTHER });
    await migrate(["claude", "codex"]);
    const hosts = await detectHosts(env);
    const removed = await applyRemove(hosts, SERVER, ["claude", "codex"], yes, env);
    expect(removed.map(({ status }) => status)).toEqual(["removed", "removed"]);
    expect(serverNames(home, "claude")).toEqual({ other: OTHER.command });
    expect(JSON.parse(readHostFile(home, "claude")).theme).toBe("dark");
    expect(serverNames(home, "codex")).toEqual({ other: OTHER.command });
  });
});
