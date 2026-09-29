import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { detectHosts } from "../hosts/detect.js";
import { commandText } from "../plan.js";
import { applySetup } from "../setup.js";
import {
  FAKE_HOSTS,
  fakeArgv,
  installFakeHost,
  setFakeMode,
  writeRegistration,
  writeUnusableRegistration,
} from "./_hostFakes.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ask-llm-setup-")));
const packageRoot = join(root, "lib/node_modules/@ask-llm/mcp");
mkdirSync(packageRoot, { recursive: true });
cpSync(fileURLToPath(new URL("../../dist", import.meta.url)), join(packageRoot, "dist"), { recursive: true });
copyFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), join(packageRoot, "package.json"));
symlinkSync(fileURLToPath(new URL("../../../../node_modules", import.meta.url)), join(packageRoot, "node_modules"));
const command = join(packageRoot, "dist/ask-llm.js");
const server = join(packageRoot, "dist/cli.js");
const bin = join(root, "bin");
const home = join(root, "home");
const installedServer = join(bin, "ask-llm-mcp");
const path = `${bin}:/usr/bin:/bin`;
const env = { HOME: home, PATH: path, ASK_LLM_PATH: path };
const FOREIGN = "/opt/other/ask-llm-mcp";
const HOSTS = Object.keys(FAKE_HOSTS);
const previousPath = process.env.ASK_LLM_PATH;
process.env.ASK_LLM_PATH = path;

const ADD: Record<string, string[]> = {
  claude: ["mcp", "add", "--scope", "user", "ask-llm", "--", installedServer],
  codex: ["mcp", "add", "ask-llm", "--", installedServer],
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
});

function ask(...args: string[]) {
  return spawnSync(process.execPath, [command, ...args], { cwd: root, env, encoding: "utf8", timeout: 60_000 });
}

function calls(): Record<string, string[][]> {
  return Object.fromEntries(HOSTS.map((name) => [name, fakeArgv(home, name)]));
}

describe("ask-llm setup", () => {
  it("registers every detected command host with -y, and a second run changes nothing", () => {
    const first = ask("setup", "-y");
    expect(first.stderr).toBe("");
    expect(first.status).toBe(0);
    expect(calls()).toEqual(Object.fromEntries(HOSTS.map((name) => [name, [ADD[name]]])));
    expect(first.stdout).toContain("Claude Code 2.1.284: registered");
    expect(first.stdout).toContain("start a new session");
    expect(first.stdout).toContain("trusted folders");

    const second = ask("setup", "-y");
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("Codex CLI 0.158.0: already registered");
    expect(second.stdout).toContain("No changes.");
    expect(calls()).toEqual(Object.fromEntries(HOSTS.map((name) => [name, [ADD[name]]])));
  });

  it("changes only the hosts named with --host", () => {
    expect(ask("setup", "-y", "--host", "claude,codex").status).toBe(0);
    expect(calls()).toEqual({ claude: [ADD.claude], codex: [ADD.codex], agy: [], grok: [], gemini: [] });
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

  it("does not remove a Grok entry after an unreadable table header", () => {
    const file = join(home, FAKE_HOSTS.grok.file);
    mkdirSync(join(file, ".."), { recursive: true });
    const content = `[mcp_servers.ask-llm]\ncommand = "${FOREIGN}"\n[mcp_servers."team]tools"]\ncommand = "${server}"\n`;
    writeFileSync(file, content);

    const setup = ask("setup", "-y", "--host", "grok");
    const remove = ask("remove", "-y", "--host", "grok");
    expect(setup.status).toBe(1);
    expect(remove.status).toBe(1);
    expect(setup.stdout).toContain("cannot read registration");
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
    expect(result.stdout).toContain("Codex CLI 0.158.0: registered");
  });

  it("reports a requested host that is not installed instead of dropping it", () => {
    unlinkSync(join(bin, "gemini"));
    const result = ask("setup", "-y", "--host", "gemini");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Gemini CLI: skipped (not installed)");
  });

  it("lists an installed host it does not register with its manual step instead of dropping it", () => {
    writeFileSync(join(bin, "pi"), '#!/bin/sh\necho "0.87.1"\n', { mode: 0o755 });
    const result = ask("setup", "-y");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Pi 0.87.1: not handled by this release (setup does not register Pi yet)");
    expect(result.stdout).toContain("Run it manually: pi install npm:@ask-llm/mcp");
    const removed = ask("remove", "-y");
    expect(removed.stdout).toContain("Pi 0.87.1: not handled by this release (remove does not handle Pi yet)");
    expect(removed.stdout).not.toContain("trusted folders");
  });

  it("never offers a manual step that would overwrite a foreign entry on a host it does not register", () => {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(join(home, ".cursor/mcp.json"), JSON.stringify({ mcpServers: { "ask-llm": { command: FOREIGN } } }));
    const result = ask("setup", "-y", "--host", "cursor");
    expect(result.stdout).toContain(
      `Cursor: manual (setup does not register Cursor yet; an ask-llm entry already runs \`${FOREIGN}\``,
    );
    expect(result.stdout).not.toContain("Run it manually");
  });

  it("prints the manual step for a requested host this release does not register", () => {
    const result = ask("setup", "-y", "--host", "cursor");
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/Cursor: manual/);
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
      cwd: root, env, encoding: "utf8", timeout: 60_000,
    });
    expect(JSON.parse(preview.stdout).server).toEqual({ path: checkoutServer, source: "package-dist" });

    const result = spawnSync(process.execPath, [checkoutCommand, "setup", "-y", "--host", "claude"], {
      cwd: root, env, encoding: "utf8", timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("npm i -g @ask-llm/mcp");
    expect(calls().claude).toEqual([]);
  });

  it("asks once per host and leaves declined hosts untouched", async () => {
    const asked: string[] = [];
    const isolated = { HOME: home };
    const confirm = async (question: string) => {
      asked.push(question);
      return question.includes("Claude Code");
    };
    const results = await applySetup(await detectHosts(isolated), server, undefined, confirm, isolated);
    expect(asked).toHaveLength(5);
    expect(asked[0]).toContain(commandText(["claude", "mcp", "add", "--scope", "user", "ask-llm", "--", server]));
    expect(calls()).toEqual({
      claude: [["mcp", "add", "--scope", "user", "ask-llm", "--", server]],
      codex: [],
      agy: [],
      grok: [],
      gemini: [],
    });
    expect(results.find(({ id }) => id === "codex")).toMatchObject({ status: "declined" });
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
    expect(result.status).toBe(0);
    expect(calls()).toEqual({ ...Object.fromEntries(Object.entries(REMOVE).map(([k, v]) => [k, [v]])), codex: [] });
    expect(result.stdout).toContain("Claude Code 2.1.284: removed");
    expect(result.stdout).toContain(`Codex CLI 0.158.0: not removed (an ask-llm entry runs \`${FOREIGN}\``);
    expect(readFileSync(join(home, FAKE_HOSTS.codex.file), "utf8")).toBe(codexFile);

    const before = calls();
    const again = ask("remove", "-y");
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("No changes.");
    expect(calls()).toEqual(before);
  });

  it("round-trips setup and remove", () => {
    expect(ask("setup", "-y").status).toBe(0);
    expect(ask("remove", "-y", "--host", "codex").status).toBe(0);
    expect(fakeArgv(home, "codex")).toEqual([ADD.codex, ["mcp", "remove", "ask-llm"]]);
    expect(ask("setup", "-y").stdout).toContain("Codex CLI 0.158.0: registered");
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
