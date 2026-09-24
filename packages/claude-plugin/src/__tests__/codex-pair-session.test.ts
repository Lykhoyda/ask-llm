import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBrokerPreference } from "../../scripts/lib/broker.mjs";
import {
  chooseTransport,
  cleanupPreviousSessionBroker,
  createIsolatedBrokerHome,
  removeIsolatedBrokerHome,
  spawnBroker,
  writeBrokerDescriptor,
} from "../../scripts/lib/broker-lifecycle.mjs";
import { clearSession, readRegisteredMarkers, registerMarker } from "../../scripts/lib/session-registry.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

describe("codex-pair-session.mjs — SessionEnd clears registry (#209)", () => {
  const SESSION_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-session.mjs");
  let repo: string;
  const SESSION = `cp-session-clear-${process.pid}`;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-session-"));
    fs.mkdirSync(path.join(repo, ".codex-pair"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), "# ctx");
  });
  afterEach(() => {
    clearSession(SESSION);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("removes the session's registered markers on SessionEnd", () => {
    registerMarker(SESSION, repo);
    expect(readRegisteredMarkers(SESSION)).toContain(repo);

    const res = spawnSync("node", [SESSION_PATH], {
      input: JSON.stringify({ hook_event_name: "SessionEnd", session_id: SESSION }),
      cwd: repo,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(0);
    expect(readRegisteredMarkers(SESSION)).toEqual([]);
  });
});

describe("broker opt-in preference", () => {
  let repo: string;
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-broker-preference-"));
    fs.mkdirSync(path.join(repo, ".codex-pair"));
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("starts enabled by default", () => {
    fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), "# project");
    expect(resolveBrokerPreference(repo, {})).toBe(true);
  });

  it("accepts explicit environment and project opt-in", () => {
    const marker = path.join(repo, ".codex-pair", "context.md");
    fs.writeFileSync(marker, "# project");
    expect(resolveBrokerPreference(repo, { ASK_CODEX_BROKER: "1" })).toBe(true);
    fs.writeFileSync(marker, "---\nbroker: true\n---\n# project");
    expect(resolveBrokerPreference(repo, {})).toBe(true);
  });

  it("either opt-out disables the broker", () => {
    const marker = path.join(repo, ".codex-pair", "context.md");
    fs.writeFileSync(marker, "---\nbroker: true\n---\n# project");
    expect(resolveBrokerPreference(repo, { ASK_CODEX_BROKER: "0" })).toBe(false);
    fs.writeFileSync(marker, "---\nbroker: false\n---\n# project");
    expect(resolveBrokerPreference(repo, { ASK_CODEX_BROKER: "1" })).toBe(false);
  });
});

describe("isolated broker home", () => {
  it("keeps auth available without loading the operator's hooks or MCP config", () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "cp-broker-source-"));
    const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cp-broker-target-"));
    fs.writeFileSync(path.join(source, "auth.json"), "test credential");
    fs.writeFileSync(path.join(source, "hooks.json"), "configured hook");
    fs.writeFileSync(path.join(source, "config.toml"), "[mcp_servers.probe]");
    try {
      const home = createIsolatedBrokerHome({ sourceHome: source, tempRoot: targetRoot });
      expect(fs.statSync(home).mode & 0o777).toBe(0o700);
      expect(fs.readFileSync(path.join(home, "auth.json"), "utf8")).toBe("test credential");
      expect(fs.readdirSync(home)).toEqual(["auth.json"]);
      removeIsolatedBrokerHome(home);
      expect(fs.existsSync(home)).toBe(false);
    } finally {
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(targetRoot, { recursive: true, force: true });
    }
  });

  it("launches the fake Codex app-server with isolated credentials only", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-broker-spawn-"));
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "cp-broker-source-"));
    const fixtureDir = path.join(PLUGIN_ROOT, "src", "__tests__", "_fixtures");
    const report = path.join(repo, "report.json");
    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    fs.writeFileSync(path.join(source, "auth.json"), "test credential");
    fs.writeFileSync(path.join(source, "hooks.json"), "configured hook");
    fs.writeFileSync(path.join(source, "config.toml"), "[mcp_servers.probe]");
    fs.mkdirSync(path.join(source, "rules"));
    const home = createIsolatedBrokerHome({ sourceHome: source });
    const before = {
      PATH: process.env.PATH,
      FAKE_CODEX_SCENARIO: process.env.FAKE_CODEX_SCENARIO,
      FAKE_CODEX_PROBE_FILE: process.env.FAKE_CODEX_PROBE_FILE,
    };
    try {
      process.env.PATH = `${fixtureDir}:${before.PATH}`;
      process.env.FAKE_CODEX_SCENARIO = "broker-home-probe";
      process.env.FAKE_CODEX_PROBE_FILE = report;
      const child = spawnBroker(repo, chooseTransport(repo), home);
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
      expect(JSON.parse(fs.readFileSync(report, "utf8"))).toEqual({
        authenticated: true,
        hooksLoaded: false,
        mcpLoaded: false,
        rulesLoaded: false,
      });
    } finally {
      for (const [key, value] of Object.entries(before)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      removeIsolatedBrokerHome(home);
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("refuses to launch without an isolated Codex home", () => {
    expect(() => spawnBroker("/unused", "unix:///unused.sock", undefined)).toThrow(/isolated Codex home/);
  });

  it("cleans a broker left by a session that missed SessionEnd", async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-broker-orphan-"));
    const source = fs.mkdtempSync(path.join(os.tmpdir(), "cp-broker-auth-"));
    fs.writeFileSync(path.join(source, "auth.json"), "test credential");
    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    const home = createIsolatedBrokerHome({ sourceHome: source });
    const transportUrl = chooseTransport(repo);
    fs.writeFileSync(transportUrl.slice("unix://".length), "");
    try {
      await writeBrokerDescriptor(repo, { pid: 99999999, transportUrl, sessionId: "old", isolatedHome: home });
      expect(await cleanupPreviousSessionBroker(repo, "new")).toBe(true);
      expect(fs.existsSync(home)).toBe(false);
      expect(fs.existsSync(path.join(repo, ".codex-pair", "state", "broker.json"))).toBe(false);
    } finally {
      removeIsolatedBrokerHome(home);
      fs.rmSync(source, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
