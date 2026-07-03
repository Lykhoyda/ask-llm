import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
