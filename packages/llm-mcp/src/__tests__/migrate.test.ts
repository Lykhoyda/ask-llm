import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRegistrar } from "../hosts/apply.js";
import { type DetectedHost, detectHosts } from "../hosts/detect.js";
import { legacyPackage } from "../hosts/legacy.js";
import type { HostId } from "../hosts/registry.js";
import { applyMigration, planMigration, replaceRegistration } from "../migrate.js";
import { buildPlan } from "../plan.js";
import { applyRemove } from "../remove.js";
import { applySetup } from "../setup.js";
import {
  HOST_FILES,
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
const env = {
  HOME: home,
  CODEX_HOME: join(home, ".codex"),
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_STATE_HOME: join(home, ".local/state"),
  PATH: process.env.ASK_LLM_PATH,
};
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
else if (args[0] === "remove") settings.packages = settings.packages.filter((entry) => (typeof entry === "string" ? entry : entry.source) !== args[1]);
else process.exit(9);
writeFileSync(file, JSON.stringify(settings));
`,
  );
  chmodSync(join(bin, "pi"), 0o755);
}

function piPackages(...packages: Array<string | Record<string, unknown>>): void {
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
  const migrated = await applyMigration(findings, hosts, SERVER, registrations, yes, env);
  return { hosts, plan, findings, registrations, migrated };
}

describe("legacyPackage", () => {
  it.each([
    [["npx", "-y", "@ask-llm/mcp"], "@ask-llm/mcp"],
    [["npx", "--yes", "@ask-llm/mcp@latest"], "@ask-llm/mcp"],
    [["ask-llm-mcp"], "@ask-llm/mcp"],
    [["npx", "-y", "@ask-llm/codex-mcp"], "@ask-llm/codex-mcp"],
    [["npx", "-y", "ask-gemini-mcp@1.6.7"], "@ask-llm/gemini-mcp"],
    [["npx", "-y", "@anton-lykhoyda/ask-claude-mcp"], "@ask-llm/claude-mcp"],
    [["ask-grok-mcp"], "@ask-llm/grok-mcp"],
  ])("recognizes %j as %s", (command, expected) => {
    expect(legacyPackage(command)).toBe(expected);
  });

  it.each([
    [["npx", "-y", "@ask-llm/mcp", "--debug"]],
    [["npx", "-y", "@ask-llm/mcp-extra"]],
    [["npx", "-y", "some-other-server"]],
    [["/opt/other/ask-llm-mcp"]],
    [["/usr/local/bin/npx", "-y", "ask-llm-mcp"]],
    [["./npx", "-y", "@ask-llm/mcp"]],
    [["/home/me/.npm-global/bin/ask-ollama-mcp"]],
    [["node", "/usr/lib/node_modules/@ask-llm/antigravity-mcp/dist/cli.js"]],
    [["/usr/lib/node_modules/@ask-llm/codex-mcp/dist/cli.js"]],
    [["node", "/home/me/ask-llm/packages/llm-mcp/dist/cli.js"]],
    [["ask-codex-mcp", "--flag"]],
    [[]],
  ])("does not claim %j", (command) => {
    expect(legacyPackage(command)).toBeUndefined();
  });
});

describe("migration of existing installations", () => {
  describe.each(MIGRATION_HOSTS.filter((id) => id !== "codex"))("%s compatibility", (id) => {
    const add = () =>
      id === "agy"
        ? `add ${JSON.stringify({ command: SERVER, args: [] })} at mcpServers.ask-llm in ${join(home, HOST_FILES.agy)}`
        : `${id} mcp add --scope user ask-llm ${id === "claude" ? "-- " : ""}${SERVER}`;
    const remove = (entry: string) =>
      id === "agy"
        ? `remove mcpServers.${entry} in ${join(home, HOST_FILES.agy)}`
        : `${id} mcp remove --scope user ${entry}`;

    it.each(["mismatch", "failed"] as const)("preserves owned and sibling entries after a %s probe", async (probe) => {
      installMigrationHost(bin, id, probe);
      seedServers(home, id, {
        "ask-llm": { command: [SERVER] },
        codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
        custom: { command: ["ask-grok-mcp"], env: { USER_OPTION: "preserve" } },
        other: OTHER,
      });
      const file = join(home, HOST_FILES[id]);
      if (id === "grok") {
        writeFileSync(
          file,
          readHostFile(home, id).replace("[mcp_servers.custom]", "[mcp_servers.custom]\nenabled_tools = []"),
        );
      } else {
        const config = JSON.parse(readHostFile(home, id));
        config.mcpServers.custom.enabled_tools = [];
        writeFileSync(file, JSON.stringify(config));
      }
      const before = readHostFile(home, id);
      const files = readdirSync(join(file, ".."));
      const confirm = vi.fn(yes);
      const hosts = await detectHosts(env);
      const detected = host(hosts, id);
      expect(detected).toMatchObject({ supported: false, registered: true, command: [SERVER] });
      expect(buildPlan([detected], SERVER)[0]).toMatchObject({ action: "manual", manual: add() });
      const findings = await planMigration(hosts, [id], env);
      expect(findings).toEqual([
        expect.objectContaining({
          action: "guidance",
          entry: "codex",
          change: `carry over any settings you still need, then: ${remove("codex")}`,
        }),
        expect.objectContaining({ action: "guidance", entry: "custom" }),
      ]);
      expect(findings[0].reason).toContain("unverified CLI compatibility");
      const registrations = await applySetup(hosts, SERVER, [id], confirm, env);
      expect(registrations).toEqual([expect.objectContaining({ status: "manual", manual: add() })]);
      const migrated = await applyMigration(findings, hosts, SERVER, registrations, confirm, env);
      expect(migrated.every(({ status }) => status === "manual")).toBe(true);
      const again = await migrate([id]);
      expect(again.findings).toEqual(findings);
      expect(again.registrations).toEqual(registrations);
      expect(again.migrated).toEqual(migrated);
      expect(confirm).not.toHaveBeenCalled();
      for (const op of ["add", "remove"] as const) {
        expect(await applyRegistrar(detected, op, SERVER, env)).toMatchObject({ outcome: "manual" });
      }
      expect(await replaceRegistration(detected, SERVER, env)).toMatchObject({ outcome: "manual" });
      expect(readHostFile(home, id)).toBe(before);
      expect(readdirSync(join(file, ".."))).toEqual(files);
      expect(migrationArgv(home, id)).toEqual([]);
    });

    it.each(["mismatch", "failed"] as const)("rejects stale retirement after a %s probe", async (probe) => {
      install(id);
      seedServers(home, id, {
        "ask-llm": { command: [SERVER] },
        codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
        other: OTHER,
      });
      const hosts = await detectHosts(env);
      const findings = await planMigration(hosts, [id], env);
      const registrations = await applySetup(hosts, SERVER, [id], yes, env);
      expect(findings).toEqual([expect.objectContaining({ action: "retire", change: remove("codex") })]);
      expect(registrations).toEqual([expect.objectContaining({ status: "up-to-date" })]);
      installMigrationHost(bin, id, probe);
      const unsupported = await detectHosts(env);
      expect(host(unsupported, id).supported).toBe(false);
      const before = readHostFile(home, id);
      const directory = join(home, HOST_FILES[id], "..");
      const files = readdirSync(directory);
      const confirm = vi.fn(yes);
      const stale = await applyMigration(findings, unsupported, SERVER, registrations, confirm, env);
      expect.soft(stale).toEqual([expect.objectContaining({ status: "manual", manual: remove("codex") })]);
      expect.soft(confirm).not.toHaveBeenCalled();
      expect.soft(readHostFile(home, id)).toBe(before);
      expect.soft(readdirSync(directory)).toEqual(files);
      expect.soft(migrationArgv(home, id)).toEqual([]);
      expect(await applyMigration(findings, unsupported, SERVER, registrations, confirm, env)).toEqual(stale);
    });

    it.each(["register", "replace", "retire", "remove"] as const)(
      "rechecks compatibility after %s confirmation",
      async (action) => {
        install(id);
        seedServers(home, id, {
          ...(action === "register" ? {} : { "ask-llm": { command: action === "replace" ? NPX_UNIFIED : [SERVER] } }),
          codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
          other: OTHER,
        });
        const file = join(home, HOST_FILES[id]);
        const before = readHostFile(home, id);
        const files = readdirSync(join(file, ".."));
        const hosts = await detectHosts(env);
        const detected = host(hosts, id);
        expect(detected.supported).toBe(true);
        const findings = await planMigration(hosts, [id], env);
        expect(findings[0]).toMatchObject({ action: "retire", change: remove("codex") });
        const confirm = vi.fn(async () => {
          detected.supported = false;
          return true;
        });
        const results =
          action === "retire"
            ? await applyMigration(
                findings,
                hosts,
                SERVER,
                await applySetup(hosts, SERVER, [id], yes, env),
                confirm,
                env,
              )
            : action === "remove"
              ? await applyRemove(hosts, SERVER, [id], confirm, env)
              : await applySetup(hosts, SERVER, [id], confirm, env);
        const manual =
          action === "retire"
            ? remove("codex")
            : action === "remove"
              ? remove("ask-llm")
              : action === "replace" && id === "claude"
                ? `${remove("ask-llm")} && ${add()}`
                : action === "replace" && id === "agy"
                  ? `replace mcpServers.ask-llm in ${join(home, HOST_FILES.agy)} with ${JSON.stringify({ command: SERVER, args: [] })}`
                  : add();
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(results).toEqual([expect.objectContaining({ status: "manual", manual })]);
        expect(readHostFile(home, id)).toBe(before);
        expect(readdirSync(join(file, ".."))).toEqual(files);
        expect(migrationArgv(home, id)).toEqual([]);
      },
    );
  });

  it.each([
    [["/home/me/bin/ask-codex-mcp"]],
    [["./ask-codex-mcp"]],
    [["/home/me/bin/npx", "-y", "@ask-llm/codex-mcp"]],
    [["./npx", "-y", "@ask-llm/codex-mcp"]],
    [["node", "/home/me/node_modules/@ask-llm/codex-mcp/dist/cli.js"]],
    [["/home/me/node_modules/@ask-llm/codex-mcp/dist/cli.js"]],
  ])("preserves unverified executable paths %j and repeats guidance", async (command) => {
    install("claude");
    for (const canonical of [command, [SERVER]]) {
      seedServers(home, "claude", { "ask-llm": { command: canonical }, codex: { command } });
      const before = readHostFile(home, "claude");
      const first = await migrate(["claude"]);
      const second = await migrate(["claude"]);
      expect(first.registrations[0].status).toBe(canonical === command ? "conflict" : "up-to-date");
      if (canonical === command) {
        expect(first.registrations[0].manual).toContain("preserve custom settings");
        expect(await replaceRegistration(host(first.hosts, "claude"), SERVER, env)).toMatchObject({
          outcome: "conflict",
        });
      }
      expect(first.findings).toEqual([expect.objectContaining({ action: "guidance", command })]);
      expect(first.migrated).toEqual([expect.objectContaining({ status: "manual" })]);
      expect(second.registrations).toEqual(first.registrations);
      expect(second.findings).toEqual(first.findings);
      expect(second.migrated).toEqual(first.migrated);
      const stale = await applyMigration(
        first.findings.map((found) => ({ ...found, action: "retire" as const })),
        first.hosts,
        SERVER,
        [{ id: "claude", name: "Claude Code", status: "up-to-date" }],
        yes,
        env,
      );
      expect(stale).toEqual([expect.objectContaining({ status: "conflict" })]);
      expect(readHostFile(home, "claude")).toBe(before);
      expect(migrationArgv(home, "claude")).toEqual([]);
    }
  });

  it.each([
    [["npm:@ask-llm/mcp"]],
    [[{ source: "npm:@ask-llm/mcp" }]],
    [["npm:@ask-llm/mcp", join(__dirname, "..", "..")]],
    [["npm:@ask-llm/mcp@0.12.1"]],
    [[{ source: "npm:@ask-llm/mcp@0.12.1" }]],
    [["npm:@ask-llm/mcp@1.0.0"]],
    [["npm:@ask-llm/mcp@latest"]],
    [["npm:@ask-llm/mcp@0.12.1", join(__dirname, "..", "..")]],
  ])("keeps the Pi bridge with an unverified replacement %j", async (sources) => {
    installPi();
    piPackages(...sources, "npm:@ask-llm/plugin");
    const file = join(home, ".pi/agent/settings.json");
    const before = readFileSync(file, "utf8");
    const first = await migrate(["pi"]);
    const second = await migrate(["pi"]);
    expect(first.registrations).toEqual([
      expect.objectContaining({
        status: "conflict",
        detail: expect.stringContaining("unverified package compatibility"),
      }),
    ]);
    expect(first.registrations[0].manual).toContain("preserve package filters");
    expect(first.findings).toEqual([expect.objectContaining({ action: "guidance", entry: "npm:@ask-llm/plugin" })]);
    expect(first.migrated).toEqual([expect.objectContaining({ status: "manual" })]);
    expect(second.registrations).toEqual(first.registrations);
    expect(second.findings).toEqual(first.findings);
    expect(second.migrated).toEqual(first.migrated);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(home, ".fake-pi-argv"))).toBe(false);
  });

  it.each(["enabled_tools = []", 'disabled_tools = ["ask-codex"]', "project shadowing"])(
    "preserves persisted Codex records hidden by its list projection: %s",
    async (hidden) => {
      install("codex");
      seedServers(home, "codex", {
        "ask-llm": { command: NPX_UNIFIED },
        codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
      });
      const file = join(env.CODEX_HOME, "config.toml");
      const projectFile = join(home, "project/.codex/config.toml");
      const userConfig =
        hidden === "project shadowing"
          ? '[mcp_servers.codex]\ncommand = "/custom/wrapper"\nunknown = {}\n'
          : `[mcp_servers.ask-llm]\ncommand = "npx"\nargs = ["-y", "@ask-llm/mcp"]\n${hidden}\n`;
      const projectConfig = '[mcp_servers.codex]\ncommand = "npx"\nargs = ["-y", "@ask-llm/codex-mcp"]\n';
      mkdirSync(join(projectFile, ".."), { recursive: true });
      writeFileSync(file, userConfig);
      writeFileSync(projectFile, projectConfig);
      const projection = readHostFile(home, "codex");
      const first = await migrate(["codex"]);
      const second = await migrate(["codex"]);
      expect(first.registrations).toEqual([expect.objectContaining({ status: "manual" })]);
      expect(first.registrations[0].manual).toContain("preserve custom settings and tool filters");
      expect(first.findings).toEqual([expect.objectContaining({ action: "guidance", entry: "codex" })]);
      expect(first.migrated).toEqual([expect.objectContaining({ status: "manual" })]);
      expect(second.registrations).toEqual(first.registrations);
      expect(second.findings).toEqual(first.findings);
      expect(second.migrated).toEqual(first.migrated);
      expect(await replaceRegistration(host(first.hosts, "codex"), SERVER, env)).toMatchObject({ outcome: "failed" });
      const stale = await applyMigration(
        first.findings.map((found) => ({ ...found, action: "retire" as const })),
        first.hosts,
        SERVER,
        [{ id: "codex", name: "Codex CLI", status: "up-to-date" }],
        yes,
        env,
      );
      expect(stale).toEqual([expect.objectContaining({ status: "failed" })]);
      expect(readFileSync(file, "utf8")).toBe(userConfig);
      expect(readFileSync(projectFile, "utf8")).toBe(projectConfig);
      expect(readHostFile(home, "codex")).toBe(projection);
      expect(migrationArgv(home, "codex")).toEqual([]);
    },
  );

  it.each(
    ["npm:@ask-llm/plugin", "npm:@ask-llm/mcp", join(__dirname, "..", "..")].flatMap((source) =>
      [
        { extensions: [] },
        { skills: [] },
        { prompts: [] },
        { themes: [] },
        { unknown: [] },
        { unknown: {} },
        { unknown: "" },
        { unknown: null },
        { env: {} },
      ].map((extra) => ({ source, extra })),
    ),
  )("preserves Pi package $source with $extra and repeats guidance", async ({ source, extra }) => {
    installPi();
    const file = join(home, ".pi/agent/settings.json");
    piPackages({ source, ...extra }, "npm:@ask-llm/plugin@0.19.4");
    const before = readFileSync(file, "utf8");
    const first = await migrate(["pi"]);
    const second = await migrate(["pi"]);
    expect(first.registrations).toEqual([expect.objectContaining({ status: "conflict" })]);
    expect(first.findings).not.toHaveLength(0);
    expect(first.findings.every(({ action }) => action === "guidance")).toBe(true);
    expect(first.migrated.every(({ status }) => status === "manual")).toBe(true);
    expect(second.findings).toEqual(first.findings);
    expect(second.registrations).toEqual(first.registrations);
    expect(second.migrated).toEqual(first.migrated);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(existsSync(join(home, ".fake-pi-argv"))).toBe(false);
  });

  it("registers the local Pi package and becomes up to date", async () => {
    installPi();
    piPackages();
    const first = await migrate(["pi"]);
    expect(first.registrations[0].status).toBe("registered");
    expect(first.migrated).toEqual([]);
    const second = await migrate(["pi"]);
    expect(second.registrations[0].status).toBe("up-to-date");
    expect(second.findings).toEqual([]);
    expect(JSON.parse(readFileSync(join(home, ".pi/agent/settings.json"), "utf8")).packages).toEqual([
      join(__dirname, "..", ".."),
    ]);
  });

  it.each(["claude", "gemini", "codex"] as const)(
    "preserves empty custom fields in %s registrations and repeats guidance",
    async (id) => {
      install(id);
      for (const extra of [
        { includeTools: [] },
        { unknown: [] },
        { unknown: {} },
        { unknown: "" },
        { unknown: null },
      ]) {
        seedServers(home, id, {
          "ask-llm": { command: NPX_UNIFIED },
          codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
        });
        const config = JSON.parse(readHostFile(home, id));
        if (id === "codex") {
          for (const entry of config) Object.assign(entry.transport, extra);
        } else {
          for (const entry of Object.values(config.mcpServers)) Object.assign(entry as object, extra);
        }
        const before = JSON.stringify(config, null, "\t");
        writeFileSync(join(home, HOST_FILES[id]), before);
        const first = await migrate([id]);
        const second = await migrate([id]);
        expect(first.registrations).toEqual([
          expect.objectContaining({ status: id === "codex" ? "manual" : "conflict" }),
        ]);
        expect(first.registrations[0].manual).toContain("preserve custom settings");
        expect(first.findings).toEqual([expect.objectContaining({ action: "guidance", entry: "codex" })]);
        expect(first.migrated).toEqual([expect.objectContaining({ status: "manual" })]);
        expect(second.registrations).toEqual(first.registrations);
        expect(second.findings).toEqual(first.findings);
        expect(second.migrated).toEqual(first.migrated);
        expect(readHostFile(home, id)).toBe(before);
        expect(migrationArgv(home, id)).toEqual([]);
      }
    },
  );

  it.each(MIGRATION_HOSTS)("keeps identifiable custom commands in %s and repeats guidance", async (id) => {
    install(id);
    const command = ["npx", "--prefer-offline", "-y", "@ask-llm/codex-mcp"];
    seedServers(home, id, { "ask-llm": { command }, codex: { command } });
    const before = readHostFile(home, id);
    const first = await migrate([id]);
    const second = await migrate([id]);
    expect(first.registrations).toEqual([expect.objectContaining({ status: id === "codex" ? "manual" : "conflict" })]);
    expect(first.findings).toEqual([
      expect.objectContaining({ action: "guidance", package: "@ask-llm/codex-mcp", command }),
    ]);
    expect(first.migrated).toEqual([expect.objectContaining({ status: "manual" })]);
    expect(second.registrations).toEqual(first.registrations);
    expect(second.findings).toEqual(first.findings);
    expect(second.migrated).toEqual(first.migrated);
    expect(readHostFile(home, id)).toBe(before);
    expect(migrationArgv(home, id)).toEqual([]);
  });

  it("keeps empty custom fields on a Codex list envelope", async () => {
    install("codex");
    seedServers(home, "codex", {
      "ask-llm": { command: [SERVER] },
      codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
    });
    const entries = JSON.parse(readHostFile(home, "codex"));
    entries[1].unknown = null;
    const before = JSON.stringify(entries);
    writeFileSync(join(home, HOST_FILES.codex), before);
    const first = await migrate(["codex"]);
    const second = await migrate(["codex"]);
    expect(first.registrations[0].status).toBe("manual");
    expect(first.findings).toEqual([expect.objectContaining({ action: "guidance" })]);
    expect(first.migrated).toEqual([expect.objectContaining({ status: "manual" })]);
    expect(second.findings).toEqual(first.findings);
    expect(readHostFile(home, "codex")).toBe(before);
    expect(migrationArgv(home, "codex")).toEqual([]);
  });

  it.each(["replace", "retire"])("preserves tool filters added during %s confirmation", async (action) => {
    install("gemini");
    seedServers(home, "gemini", {
      "ask-llm": { command: action === "replace" ? NPX_UNIFIED : [SERVER] },
      codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
    });
    const hosts = await detectHosts(env);
    const findings = await planMigration(hosts, ["gemini"], env);
    let edited = "";
    const confirm = async () => {
      const config = JSON.parse(readHostFile(home, "gemini"));
      config.mcpServers[action === "replace" ? "ask-llm" : "codex"].includeTools = [];
      edited = JSON.stringify(config);
      writeFileSync(join(home, HOST_FILES.gemini), edited);
      return true;
    };
    const registrations = await applySetup(hosts, SERVER, ["gemini"], action === "replace" ? confirm : yes, env);
    const migrated = await applyMigration(findings, hosts, SERVER, registrations, confirm, env);
    expect(action === "replace" ? registrations[0].status : migrated[0].status).toBe("conflict");
    expect(readHostFile(home, "gemini")).toBe(edited);
    expect(migrationArgv(home, "gemini")).toEqual([]);
  });

  it.each(["ask-llm", "codex"])("honors disabled Codex list entry %s without deleting its sibling", async (name) => {
    install("codex");
    seedServers(home, "codex", {
      "ask-llm": { command: [SERVER] },
      codex: { command: ["npx", "-y", "@ask-llm/codex-mcp"] },
    });
    const entries = JSON.parse(readHostFile(home, "codex"));
    entries.find((entry: { name: string }) => entry.name === name).enabled = false;
    const before = JSON.stringify(entries);
    writeFileSync(join(home, HOST_FILES.codex), before);
    const result = await migrate(["codex"]);
    expect(result.registrations[0].status).toBe("manual");
    expect(result.migrated[0].status).toBe("manual");
    expect(readHostFile(home, "codex")).toBe(before);
    expect(migrationArgv(home, "codex")).toEqual([]);
  });

  it.each(MIGRATION_HOSTS.filter((id) => id !== "codex"))(
    "rechecks %s ownership and usability after retirement confirmation",
    async (id) => {
      install(id);
      for (const change of ["removed", "disabled", "foreign"]) {
        const split = { command: ["npx", "-y", "@ask-llm/codex-mcp"] };
        seedServers(home, id, { "ask-llm": { command: [SERVER] }, codex: split });
        const hosts = await detectHosts(env);
        const findings = await planMigration(hosts, [id], env);
        const registrations = await applySetup(hosts, SERVER, [id], yes, env);
        expect(registrations[0].status).toBe("up-to-date");
        let edited = "";
        const confirm = async () => {
          seedServers(
            home,
            id,
            change === "removed"
              ? { codex: split }
              : {
                  "ask-llm": { command: [change === "foreign" ? "/opt/other/ask-llm-mcp" : SERVER] },
                  codex: split,
                },
          );
          if (change === "disabled") {
            const text = readHostFile(home, id);
            if (id === "grok") {
              writeFileSync(
                join(home, HOST_FILES[id]),
                text.replace("[mcp_servers.ask-llm]", "[mcp_servers.ask-llm]\nenabled = false"),
              );
            } else {
              const config = JSON.parse(text);
              const entry = config.mcpServers["ask-llm"];
              entry.enabled = false;
              writeFileSync(join(home, HOST_FILES[id]), JSON.stringify(config));
            }
          }
          edited = readHostFile(home, id);
          return true;
        };
        const results = await applyMigration(findings, hosts, SERVER, registrations, confirm, env);
        expect(results).toEqual([expect.objectContaining({ status: "conflict" })]);
        expect(readHostFile(home, id)).toBe(edited);
        expect(migrationArgv(home, id)).toEqual([]);
      }
    },
  );

  it.each(["removed", "disabled"])(
    "keeps a JSON split entry when the canonical entry is %s during confirmation",
    async (change) => {
      writeFileSync(join(bin, "cursor-agent"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      mkdirSync(join(home, ".cursor"), { recursive: true });
      const file = join(home, ".cursor/mcp.json");
      const split = { command: "npx", args: ["-y", "@ask-llm/codex-mcp"] };
      writeFileSync(file, JSON.stringify({ mcpServers: { "ask-llm": { command: SERVER }, codex: split } }));
      const hosts = await detectHosts(env);
      const findings = await planMigration(hosts, ["cursor"], env);
      const registrations = await applySetup(hosts, SERVER, ["cursor"], yes, env);
      let edited = "";
      const confirm = async () => {
        edited = JSON.stringify({
          mcpServers:
            change === "removed" ? { codex: split } : { "ask-llm": { command: SERVER, enabled: false }, codex: split },
        });
        writeFileSync(file, edited);
        return true;
      };
      const results = await applyMigration(findings, hosts, SERVER, registrations, confirm, env);
      expect(results).toEqual([expect.objectContaining({ status: "conflict" })]);
      expect(readFileSync(file, "utf8")).toBe(edited);
    },
  );

  it.each([
    "npm:@ask-llm/mcp",
    { source: "npm:@ask-llm/mcp" },
    "npm:@ask-llm/plugin@0.19.4",
    { source: "npm:@ask-llm/plugin" },
  ])("preserves a Pi npm entry added during registration confirmation: %j", async (entry) => {
    installPi();
    piPackages();
    const hosts = await detectHosts(env);
    const file = join(home, ".pi/agent/settings.json");
    let edited = "";
    const results = await applySetup(
      hosts,
      SERVER,
      ["pi"],
      async () => {
        piPackages(entry);
        edited = readFileSync(file, "utf8");
        return true;
      },
      env,
    );
    expect(results).toEqual([expect.objectContaining({ status: "conflict" })]);
    expect(readFileSync(file, "utf8")).toBe(edited);
    expect(existsSync(join(home, ".fake-pi-argv"))).toBe(false);
  });

  it.each(["canonical removed", "canonical filtered", "canonical unpinned", "canonical pinned", "legacy customised"])(
    "rejects stale Pi retirement after %s during confirmation",
    async (change) => {
      installPi();
      const local = join(__dirname, "..", "..");
      piPackages(local, "npm:@ask-llm/plugin");
      const file = join(home, ".pi/agent/settings.json");
      const hosts = await detectHosts(env);
      const findings = await planMigration(hosts, ["pi"], env);
      expect(findings[0].action).toBe("guidance");
      let edited = "";
      const confirm = async () => {
        if (change === "canonical removed") piPackages("npm:@ask-llm/plugin");
        else if (change === "canonical filtered") piPackages({ source: local, extensions: [] }, "npm:@ask-llm/plugin");
        else if (change === "canonical unpinned") piPackages("npm:@ask-llm/mcp", "npm:@ask-llm/plugin");
        else if (change === "canonical pinned") piPackages("npm:@ask-llm/mcp@0.12.1", "npm:@ask-llm/plugin");
        else piPackages(local, { source: "npm:@ask-llm/plugin", unknown: null });
        edited = readFileSync(file, "utf8");
        return true;
      };
      const results = await applyMigration(
        findings.map((found) => ({ ...found, action: "retire" as const })),
        hosts,
        SERVER,
        [{ id: "pi", name: "Pi", status: "up-to-date" }],
        confirm,
        env,
      );
      expect(results).toEqual([expect.objectContaining({ status: "conflict" })]);
      expect(readFileSync(file, "utf8")).toBe(edited);
      expect(existsSync(join(home, ".fake-pi-argv"))).toBe(false);
    },
  );

  it("MCP-only: migrates persisted entries and guides list-only hosts", async () => {
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
    for (const id of ["claude", "agy", "cursor"])
      expect(plan.find((entry) => entry.id === id)?.action, id).toBe("replace");
    expect(findings).toEqual([]);
    expect(registrations.map(({ id, status }) => [id, status])).toEqual([
      ["claude", "replaced"],
      ["codex", "manual"],
      ["agy", "replaced"],
      ["cursor", "replaced"],
    ]);

    expect(serverNames(home, "claude")).toEqual({ other: OTHER.command, "ask-llm": [SERVER] });
    expect(JSON.parse(readHostFile(home, "claude")).projects).toEqual({});
    expect(serverNames(home, "codex")).toEqual({
      other: OTHER.command,
      "ask-llm": ["npx", "-y", "@ask-llm/mcp@latest"],
    });
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
    expect(migrationArgv(home, "codex")).toEqual([]);

    const again = await migrate(["claude", "codex", "agy", "cursor"]);
    expect(again.registrations.every(({ id, status }) => status === (id === "codex" ? "manual" : "up-to-date"))).toBe(
      true,
    );
    expect(again.findings).toEqual([]);
  });

  it("plugin-only: registers the Claude server and preserves the Pi bridge", async () => {
    install("claude");
    installPi();
    claudePlugin();
    piPackages("npm:@ask-llm/plugin");
    const before = readFileSync(join(home, ".pi/agent/settings.json"), "utf8");

    const { hosts, plan, findings, registrations, migrated } = await migrate(["claude", "pi"]);
    expect(host(hosts, "pi")).toMatchObject({ registered: false, legacy: ["npm:@ask-llm/plugin"] });
    expect(plan.find(({ id }) => id === "claude")?.action).toBe("register");
    expect(plan.find(({ id }) => id === "pi")).toMatchObject({
      action: "conflict",
      reason: expect.stringContaining("unverified package compatibility"),
    });
    expect(findings).toEqual([
      expect.objectContaining({
        id: "pi",
        entry: "npm:@ask-llm/plugin",
        action: "guidance",
        change: expect.stringContaining("preserve package filters"),
      }),
    ]);
    expect(registrations.map(({ id, status }) => [id, status])).toEqual([
      ["claude", "registered"],
      ["pi", "conflict"],
    ]);
    expect(migrated).toEqual([expect.objectContaining({ id: "pi", status: "manual" })]);
    expect(readFileSync(join(home, ".pi/agent/settings.json"), "utf8")).toBe(before);
    expect(existsSync(join(home, ".fake-pi-argv"))).toBe(false);
    expect(readFileSync(join(home, ".claude/plugins/installed_plugins.json"), "utf8")).toContain(
      "ask-llm@ask-llm-plugins",
    );
  });

  it("combined: replaces the npx entry and gives guidance while preserving Pi packages", async () => {
    install("claude");
    installPi();
    claudePlugin();
    seedServers(home, "claude", { "ask-llm": { command: NPX_UNIFIED } });
    piPackages("npm:@ask-llm/mcp", "npm:@ask-llm/plugin@0.19.4");
    const before = readFileSync(join(home, ".pi/agent/settings.json"), "utf8");

    const { plan, findings, registrations, migrated } = await migrate(["claude", "pi"]);
    expect(plan.map(({ id, action }) => [id, action])).toContainEqual(["pi", "conflict"]);
    expect(findings.map(({ entry, action }) => [entry, action])).toEqual([["npm:@ask-llm/plugin@0.19.4", "guidance"]]);
    expect(registrations.map(({ id, status }) => [id, status])).toEqual([
      ["claude", "replaced"],
      ["pi", "conflict"],
    ]);
    expect(migrated.map(({ status }) => status)).toEqual(["manual"]);
    expect(readFileSync(join(home, ".pi/agent/settings.json"), "utf8")).toBe(before);
    const again = await migrate(["pi"]);
    expect(again.findings).toEqual(findings);
    expect(again.migrated).toEqual(migrated);
    expect(readFileSync(join(home, ".pi/agent/settings.json"), "utf8")).toBe(before);
  });

  it("split-provider: retires persisted entries and guides list-only hosts", async () => {
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
      ["codex", "claude", "@ask-llm/claude-mcp", "guidance"],
      ["agy", "antigravity", "@ask-llm/antigravity-mcp", "retire"],
      ["grok", "ollama", "@ask-llm/ollama-mcp", "retire"],
      ["gemini", "codex", "@ask-llm/codex-mcp", "retire"],
    ]);
    expect(findings[0].change).toBe("claude mcp remove --scope user codex");
    expect(registrations.every(({ id, status }) => status === (id === "codex" ? "manual" : "registered"))).toBe(true);
    expect(migrated.every(({ id, status }) => status === (id === "codex" ? "manual" : "retired"))).toBe(true);

    expect(serverNames(home, "claude")).toEqual({ other: OTHER.command, "ask-llm": [SERVER] });
    expect(migrationArgv(home, "codex")).toEqual([]);
    expect(serverNames(home, "agy")).toEqual({ "ask-llm": [SERVER] });
    expect(serverNames(home, "grok")).toEqual({ other: OTHER.command, "ask-llm": [SERVER] });
    expect(readHostFile(home, "grok")).toContain('[ui]\ntheme = "dark"');
    expect(serverNames(home, "gemini")).toEqual({ "ask-llm": [SERVER] });
    expect(migrationArgv(home, "grok").at(-1)).toEqual(["mcp", "remove", "--scope", "user", "ollama"]);
  });

  it.each([
    ["registers beside", {}, "registered", []],
    ["replaces", { "ask-llm": { command: "ask-llm-mcp" } }, "replaced", []],
    ["retires", { antigravity: { command: "ask-antigravity-mcp" } }, "registered", ["retired"]],
  ])("Antigravity %s other servers without changing them", async (_, seeded, status, retired) => {
    install("agy");
    const unrelated = { command: "/bin/false", args: [], unknown: [] };
    const legacy = { command: "ask-codex-mcp", disabled: false };
    const syntheticUnknown = { text: "", list: [], object: {}, nothing: null };
    const file = join(home, HOST_FILES.agy);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        { mcpServers: { "ask-codex": legacy, ...seeded, "synthetic-unrelated": unrelated }, syntheticUnknown },
        null,
        2,
      ),
    );

    const { registrations, migrated } = await migrate(["agy"]);
    expect(registrations.map((result) => result.status)).toEqual([status]);
    expect(migrated.map((result) => result.status)).toEqual(["manual", ...retired]);
    const after = JSON.parse(readHostFile(home, "agy"));
    expect(after.mcpServers["synthetic-unrelated"]).toStrictEqual(unrelated);
    expect(Object.hasOwn(after.mcpServers["synthetic-unrelated"], "args")).toBe(true);
    expect(after.mcpServers["ask-codex"]).toStrictEqual(legacy);
    expect(after.syntheticUnknown).toStrictEqual(syntheticUnknown);
    expect(Object.keys(after.mcpServers).sort()).toEqual(["ask-codex", "ask-llm", "synthetic-unrelated"]);
    expect(serverNames(home, "agy")["ask-llm"]).toEqual([SERVER]);

    const settled = readHostFile(home, "agy");
    const again = await migrate(["agy"]);
    expect(again.registrations.map((result) => result.status)).toEqual(["up-to-date"]);
    expect(again.migrated.map((result) => result.status)).toEqual(["manual"]);
    expect(readHostFile(home, "agy")).toBe(settled);
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
    const migrated = await applyMigration(findings, hosts, SERVER, registrations, no, env);
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
    expect(removed.map(({ status }) => status)).toEqual(["removed", "manual"]);
    expect(serverNames(home, "claude")).toEqual({ other: OTHER.command });
    expect(JSON.parse(readHostFile(home, "claude")).theme).toBe("dark");
    expect(serverNames(home, "codex")).toEqual({ other: OTHER.command });
  });
});
