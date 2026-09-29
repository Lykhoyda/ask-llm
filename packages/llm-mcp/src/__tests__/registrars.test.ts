import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { applyRegistrar } from "../hosts/apply.js";
import { type DetectedHost, detectHosts } from "../hosts/detect.js";
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
const env = { HOME: home };
const SERVER = join(root, "global", "ask-llm-mcp");

const ARGV = {
  claude: {
    add: ["mcp", "add", "--scope", "user", "ask-llm", "--", SERVER],
    remove: ["mcp", "remove", "--scope", "user", "ask-llm"],
  },
  codex: { add: ["mcp", "add", "ask-llm", "--", SERVER], remove: ["mcp", "remove", "ask-llm"] },
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
});

async function detected(id: string): Promise<DetectedHost> {
  const found = (await detectHosts(env)).find((host) => host.id === id);
  if (!found?.installed) throw new Error(`${id} not detected`);
  return found;
}

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
    if (id === "codex") expect(applied.backup).toBeUndefined();
    else expect(readFileSync(applied.backup as string, "utf8")).toBe(before);
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
