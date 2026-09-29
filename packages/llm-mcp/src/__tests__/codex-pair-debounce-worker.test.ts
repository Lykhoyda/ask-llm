import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { contentHash, drainPending, readDebounceRecords, readEditRecord } from "../../scripts/lib/debounce-state.mjs";
import { inflightLockPath } from "../../scripts/lib/state.mjs";
import { collectInFlight } from "../../scripts/lib/stop-gate.mjs";
import { PLUGIN_ROOT, readFile } from "./_helpers.js";

const WORKER_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-debounce-worker.mjs");
const FIXTURE_DIR = path.join(PLUGIN_ROOT, "src", "__tests__", "_fixtures");

describe("scripts/codex-pair-debounce-worker.mjs — structural invariants", () => {
  const script = readFile("scripts/codex-pair-debounce-worker.mts");

  it("has a node shebang and is executable", () => {
    expect(script.startsWith("#!/usr/bin/env node")).toBe(true);
    expect((fs.statSync(WORKER_PATH).mode & 0o100) !== 0).toBe(true);
  });

  it("has zero workspace imports", () => {
    expect(script).not.toMatch(/from\s+["']@ask-llm\//);
    expect(script).not.toMatch(/from\s+["']ask-(codex|gemini|ollama)-mcp/);
  });
});

describe("scripts/codex-pair-debounce-worker.mjs — runtime behavior", () => {
  let dir: string;
  let started: string;
  let release: string;
  const children: ChildProcess[] = [];
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "debounce-worker-")));
    fs.mkdirSync(path.join(dir, ".codex-pair"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".codex-pair/context.md"), "# ctx");
    started = path.join(dir, "codex-started");
    release = path.join(dir, "codex-release");
  });
  afterEach(async () => {
    // Release any gated fake codex before the directory disappears, or it polls forever.
    fs.writeFileSync(release, "");
    await Promise.race([
      Promise.all(children.map((c) => (c.exitCode === null ? new Promise((r) => c.on("exit", r)) : null))),
      sleep(10_000),
    ]);
    for (const c of children.splice(0)) if (c.exitCode === null) c.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seedRecord(file: string, rec: object) {
    const h = createHash("sha256").update(file).digest("hex").slice(0, 16);
    const p = path.join(dir, ".codex-pair/state/debounce", `${h}.json`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rec));
  }

  function workerEnv(file: string, generation: number, scenario: string | null) {
    return {
      ...process.env,
      CP_MARKER_DIR: dir,
      CP_FILE: file,
      CP_TOOL: "Edit",
      CP_GENERATION: String(generation),
      CP_SETTLE_MS: "50",
      CP_MAX_MS: "60000",
      CP_SESSION_ID: "sess",
      FAKE_CODEX_STARTED_FILE: started,
      FAKE_CODEX_RELEASE_FILE: release,
      // when a scenario is set, the fake codex is on PATH for the re-invoked hook
      ...(scenario ? { PATH: `${FIXTURE_DIR}:${process.env.PATH}`, FAKE_CODEX_SCENARIO: scenario } : {}),
    };
  }

  function runWorker(file: string, generation: number, scenario: string | null) {
    return spawnSync("node", [WORKER_PATH], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 15_000,
      env: workerEnv(file, generation, scenario),
    });
  }

  function startWorker(file: string, generation: number, scenario: string) {
    const child = spawn(process.execPath, [WORKER_PATH], {
      cwd: dir,
      stdio: "ignore",
      env: workerEnv(file, generation, scenario),
    });
    children.push(child);
    const exited = new Promise<void>((r) => child.on("exit", () => r()));
    return { child, exited };
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
    const files = fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir).filter((f) => f.endsWith(".json")) : [];
    expect(files.length).toBe(1);
    const payload = JSON.parse(fs.readFileSync(path.join(pendingDir, files[0]), "utf-8"));
    expect(typeof payload.message).toBe("string");
    expect(payload.message).toMatch(/codex-pair/);
  });

  function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function waitFor(pred: () => boolean, ms: number) {
    const deadline = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error(`waitFor timed out after ${ms}ms`);
      await sleep(20);
    }
  }

  function holdLock(file: string) {
    const lock = inflightLockPath(dir, file);
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, "999999");
    return lock;
  }

  const startedLines = () =>
    fs.existsSync(started) ? fs.readFileSync(started, "utf8").split("\n").filter(Boolean) : [];
  const pendingFiles = () => {
    const p = path.join(dir, ".codex-pair/state/pending");
    return fs.existsSync(p) ? fs.readdirSync(p) : [];
  };
  const settling = () =>
    collectInFlight({ records: readDebounceRecords(dir), lockMtimes: [], now: Date.now(), freshMs: 60_000 }).settling;

  it("B1: the newest generation waits for the lock instead of dropping its review", async () => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "// REVIEW_TOKEN_two\n");
    seedRecord(file, { file, generation: 2, burstStartedAt: Date.now() });
    const lock = holdLock(file);
    fs.writeFileSync(release, "");
    const w2 = startWorker(file, 2, "gated");

    await sleep(500);
    expect(w2.child.exitCode).toBeNull();
    expect(startedLines()).toEqual([]);
    expect(pendingFiles()).toEqual([]);
    expect(settling()).toContain(file);

    fs.unlinkSync(lock);
    await Promise.race([w2.exited, sleep(10_000)]);
    expect(w2.child.exitCode).toBe(0);
    expect(startedLines()).toHaveLength(1);
    const messages = drainPending(dir);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("REVIEW_TOKEN_two");
    expect(readEditRecord(dir, file)?.reviewedGen).toBe(2);
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("B2: an older review that finishes last cannot replace the newer verdict", async () => {
    const file = path.join(dir, "x.ts");
    const burstStartedAt = Date.now();
    fs.writeFileSync(file, "// REVIEW_TOKEN_one\n");
    seedRecord(file, { file, generation: 1, burstStartedAt });
    const w1 = startWorker(file, 1, "gated");
    await waitFor(() => startedLines().length === 1, 10_000);

    fs.writeFileSync(file, "// REVIEW_TOKEN_two\n");
    seedRecord(file, { file, generation: 2, burstStartedAt });
    const w2 = startWorker(file, 2, "gated");
    await sleep(500);
    expect(w2.child.exitCode).toBeNull();
    expect(startedLines()).toHaveLength(1);

    fs.writeFileSync(release, "");
    await Promise.race([Promise.all([w1.exited, w2.exited]), sleep(15_000)]);
    expect([w1.child.exitCode, w2.child.exitCode]).toEqual([0, 0]);
    expect(startedLines()).toHaveLength(2);
    const messages = drainPending(dir);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("REVIEW_TOKEN_two");
    expect(messages[0]).not.toContain("REVIEW_TOKEN_one");
    expect(readEditRecord(dir, file)?.reviewedGen).toBe(2);
    const hashed = fs
      .readFileSync(path.join(dir, ".codex-pair/log.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e) => e.file === file && typeof e.contentHash === "string");
    expect(hashed.at(-1)?.contentHash).toBe(contentHash(fs.readFileSync(file, "utf8")));
  });

  it.each([
    {
      label: "a manual pause",
      scenario: "gated",
      arrange: () => fs.writeFileSync(path.join(dir, ".codex-pair/state/paused"), ""),
    },
    {
      label: "an ignore rule",
      scenario: "gated",
      arrange: () => fs.writeFileSync(path.join(dir, ".codex-pair/ignore"), "x.ts\n"),
    },
    { label: "the file deleted after seeding", scenario: "gated", arrange: (file: string) => fs.unlinkSync(file) },
    { label: "a failing codex", scenario: "exit-nonzero", arrange: () => {} },
  ])("B3: $label finishes the generation and releases the lock", ({ scenario, arrange }) => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    seedRecord(file, { file, generation: 1, burstStartedAt: Date.now() });
    fs.writeFileSync(release, "");
    arrange(file);
    const res = runWorker(file, 1, scenario);
    expect(res.status).toBe(0);
    expect(readEditRecord(dir, file)?.reviewedGen).toBe(1);
    expect(fs.existsSync(inflightLockPath(dir, file))).toBe(false);
    expect(settling()).not.toContain(file);
  });

  it("B4: a lock-acquisition error ends the worker", async () => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    seedRecord(file, { file, generation: 1, burstStartedAt: Date.now() });
    fs.writeFileSync(path.join(dir, ".codex-pair/state/inflight"), "not a directory");
    const w = startWorker(file, 1, "gated");
    await Promise.race([w.exited, sleep(3_000)]);
    expect(w.child.exitCode).toBe(0);
    expect(startedLines()).toEqual([]);
  });

  it("B5: a resume notice survives a stale verdict", () => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "// REVIEW_TOKEN_one\n");
    const stateDir = path.join(dir, ".codex-pair/state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, "paused"),
      JSON.stringify({ v: 1, kind: "failures", reason: "r", at: "2026-06-14T13:23:04.000Z" }),
    );
    seedRecord(file, { file, generation: 1, burstStartedAt: Date.now() });
    fs.writeFileSync(release, "");
    expect(runWorker(file, 1, "gated").status).toBe(0);
    fs.writeFileSync(file, "// REVIEW_TOKEN_two\n");
    const messages = drainPending(dir);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/auto-resumed/);
    expect(messages[0]).not.toContain("REVIEW_TOKEN");
  });

  it.each([
    { label: "frontmatter timeoutMs keeps a 20-minute lock fresh", frontmatter: "timeoutMs: 1800000\n", stolen: false },
    { label: "the ASK_CODEX_TIMEOUT_MS default lets it go stale", frontmatter: "", stolen: true },
  ])("B7: the worker lock TTL follows the project timeout: $label", async ({ frontmatter, stolen }) => {
    fs.writeFileSync(path.join(dir, ".codex-pair/context.md"), `---\ndebounceMs: 50\n${frontmatter}---\n# ctx`);
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    const lock = holdLock(file);
    const twentyMinutesAgo = (Date.now() - 20 * 60_000) / 1000;
    fs.utimesSync(lock, twentyMinutesAgo, twentyMinutesAgo);
    fs.writeFileSync(release, "");
    const { ASK_CODEX_TIMEOUT_MS: _unset, ...env } = workerEnv(file, 0, "gated");
    const hook = spawnSync(process.execPath, [path.join(PLUGIN_ROOT, "scripts", "codex-pair-watch.mjs")], {
      input: JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file } }),
      cwd: dir,
      encoding: "utf-8",
      timeout: 10_000,
      env,
    });
    expect(hook.status).toBe(0);
    if (stolen) {
      await waitFor(() => startedLines().length === 1, 10_000);
    } else {
      await sleep(1_500);
      expect(startedLines()).toEqual([]);
    }
  });

  it("B8: an invalid ASK_CODEX_TIMEOUT_MS still runs the forced review", () => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    seedRecord(file, { file, generation: 1, burstStartedAt: Date.now() });
    fs.writeFileSync(release, "");
    const res = spawnSync("node", [WORKER_PATH], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 15_000,
      env: { ...workerEnv(file, 1, "gated"), ASK_CODEX_TIMEOUT_MS: "not-a-number" },
    });
    expect(res.status).toBe(0);
    expect(fs.readFileSync(path.join(dir, ".codex-pair/log.jsonl"), "utf8")).toContain(file);
  });

  it("B6: an older worker triggered by the burst cap does not wait", async () => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    seedRecord(file, { file, generation: 3, burstStartedAt: Date.now() - 120_000 });
    holdLock(file);
    const w1 = startWorker(file, 1, "gated");
    await Promise.race([w1.exited, sleep(2_000)]);
    expect(w1.child.exitCode).toBe(0);
    expect(startedLines()).toEqual([]);
  });
});
