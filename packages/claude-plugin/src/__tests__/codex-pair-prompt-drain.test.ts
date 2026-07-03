import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSession, registerMarker } from "../../scripts/lib/session-registry.mjs";
import { PLUGIN_ROOT, readFile } from "./_helpers.js";

const DRAIN_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-prompt-drain.mjs");

describe("scripts/codex-pair-prompt-drain.mjs — structural invariants", () => {
  const script = readFile("scripts/codex-pair-prompt-drain.mjs");
  const hooks = readFile("hooks/hooks.json");

  it("has a node shebang and is executable", () => {
    expect(script.startsWith("#!/usr/bin/env node")).toBe(true);
    expect((fs.statSync(DRAIN_PATH).mode & 0o100) !== 0).toBe(true);
  });

  it("drains pending and exits 0 on every path", () => {
    expect(script).toMatch(/drainPending\(/);
    expect(script).toMatch(/UserPromptSubmit/);
    expect(script).toMatch(/main\(\)\.catch\(\(\)\s*=>\s*process\.exit\(0\)\)/);
  });

  it("is wired into hooks.json on UserPromptSubmit", () => {
    const parsed = JSON.parse(hooks);
    const ups = parsed.hooks.UserPromptSubmit;
    expect(Array.isArray(ups)).toBe(true);
    expect(JSON.stringify(ups)).toMatch(/codex-pair-prompt-drain\.mjs/);
  });
});

describe("scripts/codex-pair-prompt-drain.mjs — runtime behavior", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cp-prompt-drain-"));
    fs.mkdirSync(path.join(cwd, ".codex-pair/state/pending"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".codex-pair/context.md"), "# ctx");
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function runDrain() {
    return spawnSync("node", [DRAIN_PATH], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hi" }),
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
    });
  }

  it("surfaces a pending verdict as additionalContext and clears it", () => {
    fs.writeFileSync(
      path.join(cwd, ".codex-pair/state/pending", "seed.json"),
      JSON.stringify({ file: path.join(cwd, "y.ts"), message: "[codex-pair] reviewed y.ts — 1H/0M/0L" }),
    );
    const res = runDrain();
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/additionalContext/);
    expect(res.stdout).toMatch(/reviewed y\.ts/);
    expect(fs.readdirSync(path.join(cwd, ".codex-pair/state/pending")).filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  it("emits nothing when no pending verdict exists", () => {
    const res = runDrain();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toMatch(/additionalContext/);
  });
});

describe("codex-pair-prompt-drain.mjs — cross-repo (#209)", () => {
  let cwdRepo: string;
  let otherRepo: string;
  const SESSION = `cp-drain-xrepo-${process.pid}`;

  beforeEach(() => {
    cwdRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-drain-cwd-"));
    otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-drain-other-"));
    for (const r of [cwdRepo, otherRepo]) {
      fs.mkdirSync(path.join(r, ".codex-pair/state/pending"), { recursive: true });
      fs.writeFileSync(path.join(r, ".codex-pair/context.md"), "# ctx");
    }
  });
  afterEach(() => {
    clearSession(SESSION);
    fs.rmSync(cwdRepo, { recursive: true, force: true });
    fs.rmSync(otherRepo, { recursive: true, force: true });
  });

  it("drains a pending verdict from a registered non-cwd repo", () => {
    registerMarker(SESSION, otherRepo);
    fs.writeFileSync(
      path.join(otherRepo, ".codex-pair/state/pending", "seed.json"),
      JSON.stringify({ file: path.join(otherRepo, "z.ts"), message: "[codex-pair] reviewed z.ts — 1H/0M/0L" }),
    );
    const res = spawnSync("node", [DRAIN_PATH], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hi", session_id: SESSION }),
      cwd: cwdRepo,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/additionalContext/);
    expect(res.stdout).toMatch(/reviewed z\.ts/);
    expect(
      fs.readdirSync(path.join(otherRepo, ".codex-pair/state/pending")).filter((f) => f.endsWith(".json")),
    ).toEqual([]);
  });

  it("no session_id → cwd-only behavior unchanged (other repo untouched)", () => {
    registerMarker(SESSION, otherRepo);
    fs.writeFileSync(
      path.join(otherRepo, ".codex-pair/state/pending", "seed.json"),
      JSON.stringify({ file: path.join(otherRepo, "z.ts"), message: "[codex-pair] reviewed z.ts" }),
    );
    const res = spawnSync("node", [DRAIN_PATH], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hi" }),
      cwd: cwdRepo,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).not.toMatch(/additionalContext/);
    expect(
      fs.readdirSync(path.join(otherRepo, ".codex-pair/state/pending")).filter((f) => f.endsWith(".json")),
    ).toHaveLength(1);
  });
});
