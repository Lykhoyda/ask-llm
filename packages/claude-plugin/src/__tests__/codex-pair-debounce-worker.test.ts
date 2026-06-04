import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLUGIN_ROOT, readFile } from "./_helpers.js";

const WORKER_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-debounce-worker.mjs");
const FIXTURE_DIR = path.join(PLUGIN_ROOT, "src", "__tests__", "_fixtures");

describe("scripts/codex-pair-debounce-worker.mjs — structural invariants", () => {
  const script = readFile("scripts/codex-pair-debounce-worker.mjs");

  it("has a node shebang and is executable", () => {
    expect(script.startsWith("#!/usr/bin/env node")).toBe(true);
    expect((fs.statSync(WORKER_PATH).mode & 0o100) !== 0).toBe(true);
  });

  it("has zero workspace imports", () => {
    expect(script).not.toMatch(/from\s+["']@ask-llm/);
    expect(script).not.toMatch(/from\s+["']ask-(codex|gemini|ollama)-mcp/);
  });

  it("re-invokes the hook in forced-sync mode and exits 0 on every path", () => {
    expect(script).toMatch(/CODEX_PAIR_FORCE_SYNC:\s*["']1["']/);
    expect(script).toMatch(/codex-pair-watch\.mjs/);
    expect(script).toMatch(/decideReview/);
    expect(script).toMatch(/main\(\)\.catch\(\(\)\s*=>\s*process\.exit\(0\)\)/);
  });
});

describe("scripts/codex-pair-debounce-worker.mjs — runtime behavior", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "debounce-worker-"));
    fs.mkdirSync(path.join(dir, ".codex-pair"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".codex-pair/context.md"), "# ctx");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function seedRecord(file: string, rec: object) {
    const h = createHash("sha256").update(file).digest("hex").slice(0, 16);
    const p = path.join(dir, ".codex-pair/state/debounce", `${h}.json`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rec));
  }

  function runWorker(file: string, generation: number, scenario: string | null) {
    return spawnSync("node", [WORKER_PATH], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 15_000,
      env: {
        ...process.env,
        CP_MARKER_DIR: dir,
        CP_FILE: file,
        CP_TOOL: "Edit",
        CP_GENERATION: String(generation),
        CP_SETTLE_MS: "50",
        CP_MAX_MS: "60000",
        CP_SESSION_ID: "sess",
        // when a scenario is set, the fake codex is on PATH for the re-invoked hook
        ...(scenario ? { PATH: `${FIXTURE_DIR}:${process.env.PATH}`, FAKE_CODEX_SCENARIO: scenario } : {}),
      },
    });
  }

  it("superseded worker exits without reviewing (no pending written)", () => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    seedRecord(file, { file, generation: 5, burstStartedAt: Date.now(), reviewedGen: 0 });
    const res = runWorker(file, 2, "none"); // gen 2 < 5, under cap → skip
    expect(res.status).toBe(0);
    const pendingDir = path.join(dir, ".codex-pair/state/pending");
    expect(fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir) : []).toEqual([]);
  });

  it("latest-gen worker reviews via the hook and writes a pending verdict", () => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    seedRecord(file, { file, generation: 1, burstStartedAt: Date.now(), reviewedGen: 0 });
    const res = runWorker(file, 1, "none"); // latest gen → review (fake codex 'none')
    expect(res.status).toBe(0);
    const pendingDir = path.join(dir, ".codex-pair/state/pending");
    const files = fs.existsSync(pendingDir)
      ? fs.readdirSync(pendingDir).filter((f) => f.endsWith(".json"))
      : [];
    expect(files.length).toBe(1);
    const payload = JSON.parse(fs.readFileSync(path.join(pendingDir, files[0]), "utf-8"));
    expect(typeof payload.message).toBe("string");
    expect(payload.message).toMatch(/codex-pair/);
  });
});
