import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRegistrar } from "../hosts/apply.js";
import { type DetectedHost, detectHosts } from "../hosts/detect.js";
import { hostSpecs } from "../hosts/registry.js";
import {
  FAKE_HOSTS,
  FOREIGN,
  fakeArgv,
  installFakeHost,
  setFakeMode,
  writeRegistration,
  writeUnusableRegistration,
} from "./_hostFakes.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ask-llm-registrars-")));
const bin = join(root, "bin");
const home = join(root, "home");
const previousPath = process.env.ASK_LLM_PATH;
process.env.ASK_LLM_PATH = `${bin}:/usr/bin:/bin`;
const env = {
  HOME: home,
  CODEX_HOME: join(home, ".codex"),
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  XDG_DATA_HOME: join(home, ".local/share"),
  XDG_STATE_HOME: join(home, ".local/state"),
};
const SERVER = join(root, "global", "ask-llm-mcp");

const ARGV = {
  claude: {
    add: ["mcp", "add", "--scope", "user", "ask-llm", "--", SERVER],
    remove: ["mcp", "remove", "--scope", "user", "ask-llm"],
  },
  agy: { add: ["mcp", "add", "ask-llm", SERVER], remove: ["mcp", "remove", "ask-llm"] },
  grok: {
    add: ["mcp", "add", "--scope", "user", "ask-llm", SERVER],
    remove: ["mcp", "remove", "--scope", "user", "ask-llm"],
  },
  gemini: {
    add: ["mcp", "add", "--scope", "user", "ask-llm", SERVER],
    remove: ["mcp", "remove", "--scope", "user", "ask-llm"],
  },
} as const;

afterAll(() => {
  if (previousPath === undefined) delete process.env.ASK_LLM_PATH;
  else process.env.ASK_LLM_PATH = previousPath;
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  for (const dir of [bin, home]) rmSync(dir, { recursive: true, force: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(join(root, "global"), { recursive: true });
  writeFileSync(SERVER, "#!/bin/sh\n", { mode: 0o755 });
  for (const name of Object.keys(ARGV)) installFakeHost(bin, name);
  for (const name of ["agent", "claude-desktop", "opencode"]) {
    writeFileSync(join(bin, name), '#!/bin/sh\necho "1.0.0"\n', { mode: 0o755 });
  }
});

async function detected(id: string): Promise<DetectedHost> {
  const found = (await detectHosts(env)).find((host) => host.id === id);
  if (!found?.installed) throw new Error(`${id} not detected`);
  return found;
}

it.each(["add", "remove"] as const)("refuses %s from an incomplete list projection", async (op) => {
  installFakeHost(bin, "codex");
  writeRegistration(home, "codex", SERVER);
  const file = join(home, FAKE_HOSTS.codex.file);
  const before = readFileSync(file, "utf8");
  expect(await applyRegistrar(await detected("codex"), op, SERVER, env)).toMatchObject({
    outcome: "failed",
    detail: expect.stringContaining("user-scope ownership is unverified"),
  });
  expect(readFileSync(file, "utf8")).toBe(before);
  expect(fakeArgv(home, "codex")).toEqual([]);
});

describe.each(Object.keys(ARGV) as Array<keyof typeof ARGV>)("%s registrar", (id) => {
  it("adds with the fixed user-scope argv and verifies the entry by re-reading it", async () => {
    expect(await applyRegistrar(await detected(id), "add", SERVER, env)).toEqual({ outcome: "changed" });
    expect(fakeArgv(home, id)).toEqual([ARGV[id].add]);
    expect(await detected(id)).toMatchObject({ registered: true, command: [SERVER] });
  });

  it("stops on a rejected argv with the host's own error", async () => {
    setFakeMode(home, id, "fail");
    expect(await applyRegistrar(await detected(id), "add", SERVER, env)).toEqual({
      outcome: "failed",
      detail: "error: unexpected argument --scope found (exit 2)",
    });
    expect(await detected(id)).toMatchObject({ registered: false });
  });

  it("fails when the host exits 0 but the entry is not there", async () => {
    setFakeMode(home, id, "silent");
    expect(await applyRegistrar(await detected(id), "add", SERVER, env)).toEqual({
      outcome: "failed",
      detail: expect.stringContaining("not found after"),
    });
  });

  it.each([
    ["this server", SERVER, { outcome: "unchanged" }],
    ["a foreign server", FOREIGN, { outcome: "conflict", detail: expect.stringContaining(FOREIGN) }],
  ])("never runs add over an entry that already runs %s", async (_, command, expected) => {
    writeRegistration(home, id, command);
    const before = readFileSync(join(home, FAKE_HOSTS[id].file), "utf8");
    expect(await applyRegistrar(await detected(id), "add", SERVER, env)).toEqual(expected);
    expect(fakeArgv(home, id)).toEqual([]);
    expect(readFileSync(join(home, FAKE_HOSTS[id].file), "utf8")).toBe(before);
  });

  it("removes with the fixed argv and verifies the entry is gone", async () => {
    writeRegistration(home, id, SERVER);
    const before = readFileSync(join(home, FAKE_HOSTS[id].file), "utf8");
    const applied = await applyRegistrar(await detected(id), "remove", SERVER, env);
    expect(applied).toMatchObject({ outcome: "changed" });
    expect(readFileSync(applied.backup as string, "utf8")).toBe(before);
    expect(fakeArgv(home, id)).toEqual([ARGV[id].remove]);
    expect(await detected(id)).toMatchObject({ registered: false });
  });

  it("treats the host's not-found reply as nothing to remove", async () => {
    writeRegistration(home, id, SERVER);
    setFakeMode(home, id, "gone");
    expect(await applyRegistrar(await detected(id), "remove", SERVER, env)).toMatchObject({ outcome: "unchanged" });
    expect(fakeArgv(home, id)).toEqual([ARGV[id].remove]);
  });

  it.each([
    ["this server", "exists", { outcome: "unchanged" }],
    ["a foreign server", "exists-foreign", { outcome: "conflict", detail: expect.stringContaining(FOREIGN) }],
  ] as const)(
    "treats already exists as success only when the entry that appeared runs %s",
    async (_, mode, expected) => {
      setFakeMode(home, id, mode);
      expect(await applyRegistrar(await detected(id), "add", SERVER, env)).toEqual(expected);
      expect(fakeArgv(home, id)).toEqual([ARGV[id].add]);
    },
  );

  it("never runs add over an ask-llm entry without a usable command", async () => {
    writeUnusableRegistration(home, id);
    expect(await applyRegistrar(await detected(id), "add", SERVER, env)).toEqual({
      outcome: "conflict",
      detail: expect.stringContaining("no usable command"),
    });
    expect(fakeArgv(home, id)).toEqual([]);
  });

  it.each(["add", "remove"] as const)(
    "re-reads the registration before %s instead of trusting detection",
    async (op) => {
      const host = await detected(id);
      writeRegistration(home, id, FOREIGN);
      expect(await applyRegistrar(host, op, SERVER, env)).toEqual({
        outcome: "conflict",
        detail: expect.stringContaining(FOREIGN),
      });
      expect(fakeArgv(home, id)).toEqual([]);
    },
  );

  it("refuses to remove a foreign entry without running the host", async () => {
    writeRegistration(home, id, FOREIGN);
    expect(await applyRegistrar(await detected(id), "remove", SERVER, env)).toEqual({
      outcome: "conflict",
      detail: expect.stringContaining(FOREIGN),
    });
    expect(fakeArgv(home, id)).toEqual([]);
    expect(await detected(id)).toMatchObject({ registered: true, command: [FOREIGN] });
  });

  it("fails when remove exits 0 but the entry is still there", async () => {
    writeRegistration(home, id, SERVER);
    setFakeMode(home, id, "silent");
    expect(await applyRegistrar(await detected(id), "remove", SERVER, env)).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("still registered"),
    });
  });

  it("fails when remove leaves an unusable entry", async () => {
    writeRegistration(home, id, SERVER);
    setFakeMode(home, id, "unusable-after-remove");
    expect(await applyRegistrar(await detected(id), "remove", SERVER, env)).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("still registered"),
    });
    expect(await detected(id)).toMatchObject({ registered: false, present: true });
  });

  it("refuses removal if a formerly owned entry becomes unusable", async () => {
    const host = await detected(id);
    writeUnusableRegistration(home, id);
    expect(await applyRegistrar(host, "remove", SERVER, env)).toEqual({
      outcome: "conflict",
      detail: expect.stringContaining("left in place"),
    });
    expect(fakeArgv(home, id)).toEqual([]);
  });
});

it("fails closed without running the host when the config backup cannot be written", async () => {
  writeRegistration(home, "grok", SERVER);
  const dir = join(home, ".grok");
  chmodSync(dir, 0o555);
  try {
    expect(await applyRegistrar(await detected("grok"), "remove", SERVER, env)).toEqual({
      outcome: "failed",
      detail: expect.stringContaining("cannot back up"),
    });
  } finally {
    chmodSync(dir, 0o755);
  }
  expect(fakeArgv(home, "grok")).toEqual([]);
});

it("keeps the config mode on the backup", async () => {
  writeRegistration(home, "grok", SERVER);
  const file = join(home, FAKE_HOSTS.grok.file);
  chmodSync(file, 0o640);
  const applied = await applyRegistrar(await detected("grok"), "remove", SERVER, env);
  expect(applied.outcome).toBe("changed");
  expect(statSync(applied.backup as string).mode & 0o7777).toBe(0o640);
});

it("does not overwrite an existing backup or run the host", async () => {
  writeRegistration(home, "grok", SERVER);
  const backup = `${join(home, FAKE_HOSTS.grok.file)}.ask-llm-backup-2026-09-29T12-00-00-000Z`;
  writeFileSync(backup, "keep this backup", { mode: 0o600 });
  const clock = vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-09-29T12:00:00.000Z");
  try {
    expect(await applyRegistrar(await detected("grok"), "remove", SERVER, env)).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("cannot back up"),
    });
  } finally {
    clock.mockRestore();
  }
  expect(readFileSync(backup, "utf8")).toBe("keep this backup");
  expect(fakeArgv(home, "grok")).toEqual([]);
});

it("backs up beside a symlinked config's real file before registration", async () => {
  mkdirSync(join(home, ".grok"));
  const file = join(home, FAKE_HOSTS.grok.file);
  const other = join(home, "other-config.toml");
  const before = '[ui]\ntheme = "dark"\n';
  writeFileSync(other, before);
  chmodSync(other, 0o640);
  symlinkSync(other, file);
  const applied = await applyRegistrar(await detected("grok"), "add", SERVER, env);
  expect(applied.outcome).toBe("changed");
  expect(applied.backup?.startsWith(`${other}.ask-llm-backup-`)).toBe(true);
  expect(readFileSync(applied.backup as string, "utf8")).toBe(before);
  expect(statSync(applied.backup as string).mode & 0o7777).toBe(0o640);
  expect(fakeArgv(home, "grok")).toEqual([["mcp", "add", "--scope", "user", "ask-llm", SERVER]]);
});

it("backs up beside a symlinked config directory's real file before registration", async () => {
  const linked = join(home, ".grok");
  const real = join(home, "grok-config");
  mkdirSync(real);
  writeFileSync(join(real, "config.toml"), '[ui]\ntheme = "dark"\n', { mode: 0o640 });
  symlinkSync(real, linked);
  const applied = await applyRegistrar(await detected("grok"), "add", SERVER, env);
  expect(applied.outcome).toBe("changed");
  expect(applied.backup?.startsWith(`${join(real, "config.toml")}.ask-llm-backup-`)).toBe(true);
  expect(readFileSync(applied.backup as string, "utf8")).toBe('[ui]\ntheme = "dark"\n');
  expect(statSync(applied.backup as string).mode & 0o7777).toBe(0o640);
  expect(fakeArgv(home, "grok")).toEqual([["mcp", "add", "--scope", "user", "ask-llm", SERVER]]);
});

const FILE_HOSTS = {
  cursor: { parent: "mcpServers", own: { command: SERVER, args: [] }, other: { command: "npx", args: ["-y", "x"] } },
  "claude-desktop": {
    parent: "mcpServers",
    own: { command: SERVER, args: [] },
    other: { command: "uvx", args: ["y"], env: { TOKEN: "t" } },
  },
  opencode: {
    parent: "mcp",
    own: { type: "local", command: [SERVER], enabled: true },
    other: { type: "remote", url: "https://example.com/mcp" },
  },
} as const;

describe.each(Object.keys(FILE_HOSTS) as Array<keyof typeof FILE_HOSTS>)("%s file registrar", (id) => {
  const { parent, own, other } = FILE_HOSTS[id];
  const fixture = (entries: Record<string, unknown>) =>
    `${JSON.stringify({ theme: "dark", [parent]: { other, ...entries } }, null, 2)}\n`;

  async function host(): Promise<DetectedHost> {
    const found = (await detectHosts(env)).find((candidate) => candidate.id === id);
    if (!found) throw new Error(id);
    return found;
  }

  function config(content?: string): string {
    const file = hostSpecsFile(id) as string;
    if (content !== undefined) {
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, content);
    }
    return file;
  }

  it("creates the file with only its entry when it is absent", async () => {
    expect(await applyRegistrar(await host(), "add", SERVER, env)).toEqual({ outcome: "changed" });
    expect(JSON.parse(readFileSync(config(), "utf8"))).toEqual({ [parent]: { "ask-llm": own } });
    expect(await host()).toMatchObject({ registered: true, command: [SERVER] });
  });

  it("adds beside unrelated servers, backs up first, and a second add changes nothing", async () => {
    const file = config(fixture({}));
    const applied = await applyRegistrar(await host(), "add", SERVER, env);
    expect(applied.outcome).toBe("changed");
    expect(readFileSync(applied.backup as string, "utf8")).toBe(fixture({}));
    expect(readFileSync(file, "utf8")).toBe(fixture({ "ask-llm": own }));

    expect(await applyRegistrar(await host(), "add", SERVER, env)).toEqual({ outcome: "unchanged" });
    expect(readFileSync(file, "utf8")).toBe(fixture({ "ask-llm": own }));
  });

  it("removes only its own entry and a second remove changes nothing", async () => {
    const file = config(fixture({ "ask-llm": own }));
    const applied = await applyRegistrar(await host(), "remove", SERVER, env);
    expect(applied.outcome).toBe("changed");
    expect(readFileSync(applied.backup as string, "utf8")).toBe(fixture({ "ask-llm": own }));
    expect(readFileSync(file, "utf8")).toBe(fixture({}));
    expect(await applyRegistrar(await host(), "remove", SERVER, env)).toEqual({ outcome: "unchanged" });
  });

  it.each(["add", "remove"] as const)("never %ss over a foreign entry", async (op) => {
    const foreign = parent === "mcp" ? { type: "local", command: ["npx", "-y", "ask-llm-mcp"] } : { command: FOREIGN };
    const file = config(fixture({ "ask-llm": foreign }));
    expect(await applyRegistrar(await host(), op, SERVER, env)).toMatchObject({ outcome: "conflict" });
    expect(readFileSync(file, "utf8")).toBe(fixture({ "ask-llm": foreign }));
  });

  it.each([
    ["malformed JSON", "{ not json"],
    ["JSON with comments", `{\n  // mine\n  "${parent}": {}\n}\n`],
  ])("refuses %s and keeps the file", async (_, content) => {
    const file = config(content);
    expect(await applyRegistrar(await host(), "add", SERVER, env)).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("cannot read registration"),
    });
    expect(readFileSync(file, "utf8")).toBe(content);
  });

  it("refuses a non-object parent without leaving a backup behind", async () => {
    const file = config(`{"${parent}":[]}`);
    expect(await applyRegistrar(await host(), "add", SERVER, env)).toEqual({
      outcome: "failed",
      detail: expect.stringContaining("is not a JSON object"),
    });
    expect(readFileSync(file, "utf8")).toBe(`{"${parent}":[]}`);
    expect(readdirSync(join(file, "..")).filter((name) => name.includes("ask-llm-backup"))).toEqual([]);
  });

  it("fails without touching the file when an interrupted write left its temp file", async () => {
    const file = config(fixture({}));
    writeFileSync(`${file}.ask-llm-tmp`, "partial");
    expect(await applyRegistrar(await host(), "add", SERVER, env)).toMatchObject({
      outcome: "failed",
      detail: expect.stringContaining("interrupted write"),
    });
    expect(readFileSync(file, "utf8")).toBe(fixture({}));
    expect(readFileSync(`${file}.ask-llm-tmp`, "utf8")).toBe("partial");
    expect(readdirSync(join(file, "..")).filter((name) => name.includes("ask-llm-backup"))).toEqual([]);
  });
});

function hostSpecsFile(id: string): string | undefined {
  return hostSpecs(env).find((spec) => spec.id === id)?.configFile;
}

it("refuses OpenCode while an opencode.jsonc sits beside opencode.json", async () => {
  const file = hostSpecsFile("opencode") as string;
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(join(file, "..", "opencode.jsonc"), "{ // mine\n}\n");
  const host = (await detectHosts(env)).find(({ id }) => id === "opencode") as DetectedHost;
  expect(await applyRegistrar(host, "add", SERVER, env)).toMatchObject({
    outcome: "failed",
    detail: expect.stringContaining("does not rewrite JSONC"),
  });
  expect(() => readFileSync(file)).toThrow();
});
