import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveBrokerPreference } from "../../scripts/lib/broker.mjs";
import {
  chooseTransport,
  cleanupPreviousSessionBroker,
  teardownBroker,
  writeBrokerDescriptor,
} from "../../scripts/lib/broker-lifecycle.mjs";
import { clearSession, readRegisteredMarkers, registerMarker } from "../../scripts/lib/session-registry.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

const SESSION_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-session.mjs");

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

  it("clears the ending session's registry", () => {
    registerMarker(session, repo);
    const res = spawnSync("node", [SESSION_PATH], {
      input: JSON.stringify({ hook_event_name: "SessionEnd", session_id: session }),
      cwd: repo,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(0);
    expect(readRegisteredMarkers(session)).toEqual([]);
  });

  it("requires environment opt-in", () => {
    expect(resolveBrokerPreference(repo, {})).toBe(false);
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

  it("preserves B's broker when A ends late", async () => {
    fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
    const transportUrl = chooseTransport(repo);
    const descriptor = path.join(repo, ".codex-pair", "state", "broker.json");
    await writeBrokerDescriptor(repo, { pid: 99999999, transportUrl, sessionId: "A" });
    expect(await cleanupPreviousSessionBroker(repo, "B")).toBe(true);
    await writeBrokerDescriptor(repo, { pid: 99999999, transportUrl, sessionId: "B" });
    expect(await teardownBroker(repo, { sessionId: "A" })).toBeNull();
    expect(fs.existsSync(descriptor)).toBe(true);
    expect((await teardownBroker(repo, { sessionId: "B" }))?.sessionId).toBe("B");
    expect(fs.existsSync(descriptor)).toBe(false);
  });
});
