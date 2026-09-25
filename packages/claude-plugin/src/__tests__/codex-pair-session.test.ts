import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBrokerPreference } from "../../scripts/lib/broker.ts";
import {
  bootstrapBroker,
  chooseTransport,
  createIsolatedBrokerHome,
  isRecordedBroker,
  removeIsolatedBrokerHome,
  spawnBroker,
  teardownBroker,
  writeBrokerDescriptor,
} from "../../scripts/lib/broker-lifecycle.ts";
import { bumpEditRecord, readEditRecord } from "../../scripts/lib/debounce-state.mjs";
import { clearSession, readRegisteredMarkers, registerMarker } from "../../scripts/lib/session-registry.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

const SESSION_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-session.mjs");

async function until(check: () => boolean, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

describe("codex-pair session hooks", () => {
  let repo: string;
  const session = `cp-session-clear-${process.pid}`;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-session-"));
    fs.mkdirSync(path.join(repo, ".codex-pair"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), "# ctx");
  });
  afterEach(() => {
    clearSession(session);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("clears the ending session's registry and debounce state", () => {
    registerMarker(session, repo);
    const file = path.join(repo, "edited.ts");
    bumpEditRecord(repo, file, { sessionId: session, now: Date.now() });
    const start = spawnSync("node", [SESSION_PATH], {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: session }),
      cwd: repo,
      env: { ...process.env, ASK_CODEX_BROKER: "0" },
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(start.status).toBe(0);
    expect(readEditRecord(repo, file)).not.toBeNull();
    const res = spawnSync("node", [SESSION_PATH], {
      input: JSON.stringify({ hook_event_name: "SessionEnd", session_id: session }),
      cwd: repo,
      env: { ...process.env, ASK_CODEX_BROKER: "0" },
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(0);
    expect(readRegisteredMarkers(session)).toEqual([]);
    expect(readEditRecord(repo, file)).toBeNull();
  });

  it("enables the broker by default unless the environment opts out", () => {
    expect(resolveBrokerPreference(repo, {})).toBe(true);
    expect(resolveBrokerPreference(repo, { ASK_CODEX_BROKER: "0" })).toBe(false);
    expect(resolveBrokerPreference(repo, { ASK_CODEX_BROKER: "1" })).toBe(true);
  });

  it.each(["broker: false", 'broker: "false"', " broker: false", "broker : false"])(
    "honors project opt-out %s",
    (setting) => {
      fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), `---\n${setting}\n---\n# project`);
      expect(resolveBrokerPreference(repo, { ASK_CODEX_BROKER: "1" })).toBe(false);
    },
  );

  it("keeps B's live broker when A starts or ends late", async () => {
    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    const transportUrl = chooseTransport(repo);
    const descriptor = path.join(repo, ".codex-pair", "state", "broker.json");
    const oldHome = createIsolatedBrokerHome({ sourceHome: repo });
    await writeBrokerDescriptor(repo, {
      pid: 99999999,
      transportUrl,
      sessionId: "old",
      isolatedHome: oldHome,
      startedAt: new Date().toISOString(),
    });
    let spawned = 0;
    let spawnedHome = "";
    const injectDeps = {
      spawnBroker: (_marker: string, _url: string, home: string) => {
        spawned++;
        spawnedHome = home;
        return { pid: process.pid, kill: () => true };
      },
      pollSocketReachable: async () => true,
      initializeBroker: async () => ({
        connection: { close: () => {} },
        initializeResult: { codexHome: spawnedHome },
      }),
      readCodexVersion: () => "test",
      isRecordedBroker: (d: { pid: number }) => d.pid === process.pid,
    };
    try {
      const current = await bootstrapBroker(repo, { sessionId: "B", sourceHome: repo, injectDeps });
      expect(current?.sessionId).toBe("B");
      expect(fs.existsSync(oldHome)).toBe(false);
      expect(spawned).toBe(1);
      const delayed = await bootstrapBroker(repo, { sessionId: "A", sourceHome: repo, injectDeps });
      expect(delayed?.sessionId).toBe("B");
      expect(spawned).toBe(1);
      expect(await teardownBroker(repo, { sessionId: "A" })).toBeNull();
      expect(fs.existsSync(descriptor)).toBe(true);
      expect(
        (await teardownBroker(repo, { sessionId: "B", injectDeps: { killPid: async () => true } }))?.sessionId,
      ).toBe("B");
      expect(fs.existsSync(descriptor)).toBe(false);
      expect(fs.existsSync(spawnedHome)).toBe(false);
    } finally {
      removeIsolatedBrokerHome(oldHome);
      removeIsolatedBrokerHome(spawnedHome);
    }
  });

  it("replaces an expired broker lease after a missed SessionEnd", async () => {
    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    const oldHome = createIsolatedBrokerHome({ sourceHome: repo });
    let spawnedHome = "";
    let stopped = false;
    await writeBrokerDescriptor(repo, {
      pid: process.pid,
      transportUrl: chooseTransport(repo),
      sessionId: "old",
      isolatedHome: oldHome,
      startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    try {
      const replacement = await bootstrapBroker(repo, {
        sessionId: "new",
        sourceHome: repo,
        injectDeps: {
          killPid: async () => {
            stopped = true;
            return true;
          },
          spawnBroker: (_marker: string, _url: string, home: string) => {
            spawnedHome = home;
            return { pid: process.pid, kill: () => true };
          },
          pollSocketReachable: async () => true,
          initializeBroker: async () => ({
            connection: { close: () => {} },
            initializeResult: {
              get codexHome() {
                return spawnedHome;
              },
            },
          }),
        },
      });
      expect(replacement?.sessionId).toBe("new");
      expect(stopped).toBe(true);
      expect(fs.existsSync(oldHome)).toBe(false);
      expect(fs.existsSync(spawnedHome)).toBe(true);
      await teardownBroker(repo, { sessionId: "new", injectDeps: { killPid: async () => true } });
    } finally {
      removeIsolatedBrokerHome(oldHome);
      removeIsolatedBrokerHome(spawnedHome);
    }
  });

  it("never signals a recorded pid that is no longer this project's broker", async () => {
    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    const standIn = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
    const homes: string[] = [];
    const injectDeps = {
      spawnBroker: (_marker: string, _url: string, home: string) => {
        homes.push(home);
        return { pid: 2 ** 22 + 1, kill: () => true };
      },
      pollSocketReachable: async () => true,
      initializeBroker: async () => ({
        connection: { close: () => {} },
        initializeResult: { codexHome: homes.at(-1) },
      }),
      readCodexVersion: () => "test",
    };
    const recordStandIn = async (ageMs: number, sessionId: string) => {
      const home = createIsolatedBrokerHome({ sourceHome: repo });
      homes.push(home);
      await writeBrokerDescriptor(repo, {
        pid: standIn.pid as number,
        transportUrl: chooseTransport(home),
        sessionId,
        isolatedHome: home,
        protocolVersion: "v2",
        startedAt: new Date(Date.now() - ageMs).toISOString(),
      });
      return home;
    };
    const alive = () => {
      try {
        process.kill(standIn.pid as number, 0);
        return true;
      } catch {
        return false;
      }
    };
    try {
      const expiredHome = await recordStandIn(25 * 60 * 60 * 1000, "old");
      expect((await bootstrapBroker(repo, { sessionId: "B", sourceHome: repo, injectDeps }))?.sessionId).toBe("B");
      expect(alive()).toBe(true);
      expect(fs.existsSync(expiredHome)).toBe(false);

      await recordStandIn(60_000, "fresh");
      expect((await bootstrapBroker(repo, { sessionId: "C", sourceHome: repo, injectDeps }))?.sessionId).toBe("C");
      expect(alive()).toBe(true);

      await recordStandIn(60_000, "D");
      expect((await teardownBroker(repo, { sessionId: "D" }))?.sessionId).toBe("D");
      expect(alive()).toBe(true);
    } finally {
      standIn.kill("SIGKILL");
      for (const home of homes) removeIsolatedBrokerHome(home);
    }
  });

  it("terminates only a codex process listening on the recorded transport", async () => {
    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    const home = createIsolatedBrokerHome({ sourceHome: repo });
    const transportUrl = chooseTransport(home);
    const fakeCodex = path.join(repo, "codex");
    fs.writeFileSync(fakeCodex, "#!/usr/bin/env node\nsetTimeout(() => {}, 30000);\n", { mode: 0o755 });
    const broker = spawn(fakeCodex, ["app-server", "--listen", transportUrl], { detached: true, stdio: "ignore" });
    const lookalike = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 30000)", "app-server", "--listen", transportUrl],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    try {
      expect(await until(() => isRecordedBroker({ pid: broker.pid as number, transportUrl }))).toBe(true);
      expect(isRecordedBroker({ pid: lookalike.pid as number, transportUrl })).toBe(false);
      expect(isRecordedBroker({ pid: broker.pid as number, transportUrl: `${transportUrl}x` })).toBe(false);
      expect(isRecordedBroker({ pid: broker.pid as number, transportUrl })).toBe(true);
      await writeBrokerDescriptor(repo, {
        pid: broker.pid as number,
        transportUrl,
        sessionId: "E",
        isolatedHome: home,
        protocolVersion: "v2",
        startedAt: new Date().toISOString(),
      });
      await teardownBroker(repo, { sessionId: "E", graceMs: 1000 });
      expect(await until(() => broker.exitCode !== null || broker.signalCode !== null)).toBe(true);
      expect(lookalike.exitCode === null && lookalike.signalCode === null).toBe(true);
    } finally {
      broker.kill("SIGKILL");
      lookalike.kill("SIGKILL");
      removeIsolatedBrokerHome(home);
    }
  });

  it("reclaims a lock abandoned by a killed bootstrap and stops the broker it spawned", async () => {
    const stateDir = path.join(repo, ".codex-pair", "state");
    const lock = path.join(stateDir, "broker.lock");
    fs.mkdirSync(lock, { recursive: true });
    const orphanHome = createIsolatedBrokerHome({ sourceHome: repo });
    const orphanUrl = chooseTransport(orphanHome);
    const fakeCodex = path.join(repo, "codex");
    fs.writeFileSync(fakeCodex, "#!/usr/bin/env node\nsetTimeout(() => {}, 30000);\n", { mode: 0o755 });
    const orphan = spawn(fakeCodex, ["app-server", "--listen", orphanUrl], { detached: true, stdio: "ignore" });
    const deadOwner = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], {
      encoding: "utf-8",
    });
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: Number(deadOwner.stdout), at: Date.now() }));
    fs.writeFileSync(
      path.join(lock, "spawn.json"),
      JSON.stringify({ transportUrl: orphanUrl, isolatedHome: orphanHome }),
    );
    let spawnedHome = "";
    try {
      expect(await until(() => isRecordedBroker({ pid: orphan.pid as number, transportUrl: orphanUrl }))).toBe(true);
      const result = await bootstrapBroker(repo, {
        sessionId: "F",
        sourceHome: repo,
        injectDeps: {
          spawnBroker: (_marker: string, _url: string, home: string) => {
            spawnedHome = home;
            return { pid: 2 ** 22 + 2, kill: () => true };
          },
          pollSocketReachable: async () => true,
          initializeBroker: async () => ({
            connection: { close: () => {} },
            initializeResult: {
              get codexHome() {
                return spawnedHome;
              },
            },
          }),
          readCodexVersion: () => "test",
        },
      });
      expect(result?.sessionId).toBe("F");
      expect(await until(() => orphan.exitCode !== null || orphan.signalCode !== null)).toBe(true);
      expect(fs.existsSync(orphanHome)).toBe(false);
      expect(fs.existsSync(lock)).toBe(false);
    } finally {
      orphan.kill("SIGKILL");
      removeIsolatedBrokerHome(orphanHome);
      removeIsolatedBrokerHome(spawnedHome);
    }
  });

  it("leaves a lock held by a live bootstrap alone", async () => {
    const lock = path.join(repo, ".codex-pair", "state", "broker.lock");
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ pid: process.pid, at: Date.now() }));
    expect(await bootstrapBroker(repo, { sessionId: "G", sourceHome: repo })).toBeNull();
    expect(fs.existsSync(lock)).toBe(true);
  });

  it("creates a private broker home with only auth and disabled apps", () => {
    fs.writeFileSync(path.join(repo, "auth.json"), "test credential");
    fs.writeFileSync(path.join(repo, "hooks.json"), "user hook");
    fs.writeFileSync(path.join(repo, "config.toml"), "[mcp_servers.marker]");
    const home = createIsolatedBrokerHome({ sourceHome: repo });
    try {
      expect(fs.statSync(home).mode & 0o777).toBe(0o700);
      expect(fs.readdirSync(home).sort()).toEqual(["auth.json", "config.toml"]);
      expect(fs.readFileSync(path.join(home, "auth.json"), "utf8")).toBe("test credential");
      expect(fs.readFileSync(path.join(home, "config.toml"), "utf8")).toBe("[features]\napps = false\n");
    } finally {
      removeIsolatedBrokerHome(home);
    }
  });

  it("rejects broker launch without an isolated home", () => {
    expect(() => spawnBroker(repo, chooseTransport(repo), undefined)).toThrow(/isolated Codex home/);
  });

  it("launches the fake app-server with isolated credentials and config", async () => {
    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    fs.writeFileSync(path.join(repo, "auth.json"), "test credential");
    fs.writeFileSync(path.join(repo, "hooks.json"), "user hook");
    fs.mkdirSync(path.join(repo, "rules"));
    fs.writeFileSync(path.join(repo, "config.toml"), "[mcp_servers.marker]");
    const report = path.join(repo, "report.json");
    const home = createIsolatedBrokerHome({ sourceHome: repo });
    const prior = {
      PATH: process.env.PATH,
      FAKE_CODEX_SCENARIO: process.env.FAKE_CODEX_SCENARIO,
      FAKE_CODEX_PROBE_FILE: process.env.FAKE_CODEX_PROBE_FILE,
    };
    try {
      process.env.PATH = `${path.join(PLUGIN_ROOT, "src", "__tests__", "_fixtures")}:${prior.PATH}`;
      process.env.FAKE_CODEX_SCENARIO = "broker-home-probe";
      process.env.FAKE_CODEX_PROBE_FILE = report;
      const child = spawnBroker(repo, chooseTransport(repo), home);
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      expect(JSON.parse(fs.readFileSync(report, "utf8"))).toEqual({
        authenticated: true,
        hooksLoaded: false,
        rulesLoaded: false,
        minimalConfig: true,
      });
    } finally {
      for (const [key, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      removeIsolatedBrokerHome(home);
    }
  });

  it("falls back to direct review when the broker cannot connect", async () => {
    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), "---\ndebounceMs: 0\n---\n# ctx");
    const file = path.join(repo, "edited.ts");
    fs.writeFileSync(file, "export const ready = true;\n");
    const home = createIsolatedBrokerHome({ sourceHome: repo });
    try {
      await writeBrokerDescriptor(repo, {
        pid: process.pid,
        transportUrl: chooseTransport(repo),
        protocolVersion: "v2",
        isolatedHome: home,
        sessionId: session,
        startedAt: new Date().toISOString(),
      });
      const env = {
        ...process.env,
        PATH: `${path.join(PLUGIN_ROOT, "src", "__tests__", "_fixtures")}:${process.env.PATH}`,
        FAKE_CODEX_SCENARIO: "none",
        ASK_CODEX_DEBOUNCE_MS: "0",
      };
      delete env.ASK_CODEX_BROKER;
      const res = spawnSync("node", [path.join(PLUGIN_ROOT, "scripts", "codex-pair-watch.mjs")], {
        input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file }, session_id: session }),
        cwd: repo,
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(res.status).toBe(0);
      const log = fs.readFileSync(path.join(repo, ".codex-pair", "log.jsonl"), "utf8");
      expect(log).toContain('"verdict":"broker_fallback"');
    } finally {
      removeIsolatedBrokerHome(home);
    }
  });

  it("skips the broker and keeps direct reviews when Node cannot run TypeScript", async () => {
    fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), "---\ndebounceMs: 0\n---\n# ctx");
    const file = path.join(repo, "edited.ts");
    fs.writeFileSync(file, "export const ready = true;\n");
    const env = {
      ...process.env,
      PATH: `${path.join(PLUGIN_ROOT, "src", "__tests__", "_fixtures")}:${process.env.PATH}`,
      FAKE_CODEX_SCENARIO: "none",
      ASK_CODEX_DEBOUNCE_MS: "0",
    };
    delete env.ASK_CODEX_BROKER;
    const start = spawnSync("node", ["--no-experimental-strip-types", SESSION_PATH], {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: session }),
      cwd: repo,
      env,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(start.status).toBe(0);
    expect(fs.existsSync(path.join(repo, ".codex-pair", "state", "broker.json"))).toBe(false);

    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    const home = createIsolatedBrokerHome({ sourceHome: repo });
    try {
      await writeBrokerDescriptor(repo, {
        pid: process.pid,
        transportUrl: chooseTransport(repo),
        protocolVersion: "v2",
        isolatedHome: home,
        sessionId: session,
        startedAt: new Date().toISOString(),
      });
      const edit = spawnSync(
        "node",
        ["--no-experimental-strip-types", path.join(PLUGIN_ROOT, "scripts", "codex-pair-watch.mjs")],
        {
          input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file }, session_id: session }),
          cwd: repo,
          env,
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      expect(edit.status).toBe(0);
      const log = fs.readFileSync(path.join(repo, ".codex-pair", "log.jsonl"), "utf8");
      expect(log).toContain('"verdict":"none"');
      expect(log).not.toContain("broker_fallback");
    } finally {
      removeIsolatedBrokerHome(home);
    }
  });
});
