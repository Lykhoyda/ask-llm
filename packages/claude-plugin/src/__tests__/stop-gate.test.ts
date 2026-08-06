import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSession, registerMarker } from "../../scripts/lib/session-registry.mjs";
import {
  collectBlockingHighs,
  collectInFlight,
  formatBlockMessage,
  formatInFlightMessage,
  parseGitPorcelain,
  selectLatestEntries,
} from "../../scripts/lib/stop-gate.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

describe("selectLatestEntries", () => {
  it("keeps the last entry per file and tolerates blank/garbage lines", () => {
    const log = [
      '{"file":"/r/a.ts","verdict":"concerns","concerns":{"high":["H1"]}}',
      "",
      "not json",
      '{"file":"/r/a.ts","verdict":"none","concerns":{"high":[]}}',
      '{"file":"/r/b.ts","verdict":"concerns","concerns":{"high":["H2"]}}',
    ].join("\n");
    const map = selectLatestEntries(log);
    expect(map.get("/r/a.ts").verdict).toBe("none");
    expect(map.get("/r/b.ts").concerns.high).toEqual(["H2"]);
    expect(map.size).toBe(2);
  });
});

describe("parseGitPorcelain", () => {
  it("maps porcelain entries to absolute paths (modified, untracked, renamed)", () => {
    const out = [" M src/a.ts", "?? src/new.ts", "R  src/b.ts", "old.ts", ""].join("\0");
    const set = parseGitPorcelain(out, "/repo");
    // join(): the impl builds paths with node:path, so expectations must use
    // native separators to hold on Windows too (PR #200).
    expect(set.has(join("/repo", "src/a.ts"))).toBe(true);
    expect(set.has(join("/repo", "src/new.ts"))).toBe(true);
    expect(set.has(join("/repo", "src/b.ts"))).toBe(true); // rename → new path is the dirty one
    expect(set.has(join("/repo", "old.ts"))).toBe(false);
  });

  it("preserves raw special characters from porcelain -z without C-style quote decoding", () => {
    const special = 'src/quote"-backslash\\-newline\n.ts';
    const set = parseGitPorcelain(` M ${special}\0`, "/repo");
    expect(set.has(join("/repo", special))).toBe(true);
  });
});

// helper: build a Map<file, entry>
const m = (obj) => new Map(Object.entries(obj));

describe("collectBlockingHighs", () => {
  const base = { markerDir: "/r", existsFn: () => true, gitDirty: null };

  it("blocks on a HIGH in the latest real entry", () => {
    const entries = m({ "/r/a.ts": { file: "/r/a.ts", verdict: "concerns", concerns: { high: ["H1"] } } });
    const out = collectBlockingHighs({ ...base, entries, acks: {} });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ file: "/r/a.ts", text: "H1" });
    expect(typeof out[0].hash).toBe("string");
  });

  it("[A] drops files that do not exist on disk", () => {
    const entries = m({ "/r/gone.ts": { file: "/r/gone.ts", verdict: "concerns", concerns: { high: ["H"] } } });
    const out = collectBlockingHighs({ ...base, entries, acks: {}, existsFn: () => false });
    expect(out).toHaveLength(0);
  });

  it("[C] indeterminate latest entry → fail-open (no fallback to stale HIGH)", () => {
    const entries = m({ "/r/a.ts": { file: "/r/a.ts", verdict: "error", concerns: { high: [] } } });
    const out = collectBlockingHighs({ ...base, entries, acks: {} });
    expect(out).toHaveLength(0);
  });

  it("[B] drops files clean vs HEAD when gitDirty is provided", () => {
    const entries = m({ "/r/a.ts": { file: "/r/a.ts", verdict: "concerns", concerns: { high: ["H"] } } });
    const clean = collectBlockingHighs({ ...base, entries, acks: {}, gitDirty: new Set() });
    expect(clean).toHaveLength(0);
    const dirty = collectBlockingHighs({ ...base, entries, acks: {}, gitDirty: new Set(["/r/a.ts"]) });
    expect(dirty).toHaveLength(1);
  });

  it("[E] acks are file-scoped — same text on two files acks independently", () => {
    const entries = m({
      "/r/a.ts": { file: "/r/a.ts", verdict: "concerns", concerns: { high: ["dup"] } },
      "/r/b.ts": { file: "/r/b.ts", verdict: "concerns", concerns: { high: ["dup"] } },
    });
    const all = collectBlockingHighs({ ...base, entries, acks: {} });
    expect(all).toHaveLength(2);
    const ackA = all.find((b) => b.file === "/r/a.ts").hash;
    const out = collectBlockingHighs({ ...base, entries, acks: { [ackA]: { reason: "x" } } });
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe("/r/b.ts"); // b still blocks
  });

  it("a clean `none` latest entry blocks nothing (auto-clear on fix)", () => {
    const entries = m({ "/r/a.ts": { file: "/r/a.ts", verdict: "none", concerns: { high: [] } } });
    expect(collectBlockingHighs({ ...base, entries, acks: {} })).toHaveLength(0);
  });
});

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acksPath, acksRoot, addAck, readAcks } from "../../scripts/lib/state.mjs";

describe("acks state helpers", () => {
  it("addAck persists, readAcks reads back, missing file → {}", () => {
    const dir = mkdtempSync(join(tmpdir(), "ackstest-"));
    try {
      expect(readAcks(dir)).toEqual({});
      expect(acksPath(dir).endsWith(join(".codex-pair", "state", "acks.json"))).toBe(true);
      addAck(dir, "abc123", { reason: "stale" });
      const acks = readAcks(dir);
      expect(acks.abc123.reason).toBe("stale");
      expect(typeof acks.abc123.ts).toBe("string");
      addAck(dir, "def456", { reason: "pre-existing" });
      expect(Object.keys(readAcks(dir))).toHaveLength(2);
      expect(readdirSync(acksRoot(dir)).filter((name) => name.endsWith(".json"))).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("formatBlockMessage", () => {
  it("lists each finding with a short hash, file, and ack instructions", () => {
    const msg = formatBlockMessage(
      [
        { file: "/r/src/auth.ts", text: "onSubmit awaits mutation without .unwrap()", hash: "a1b2c3d4e5" },
        { file: "/r/src/del.tsx", text: "replace() after swallowed catch", hash: "d4e5f6a7b8" },
      ],
      "/r",
    );
    expect(msg).toContain("2 unaddressed HIGH");
    expect(msg).toContain("[a1b2c3d4e5]");
    // relative() output uses native separators — join() keeps this portable.
    expect(msg).toContain(join("src", "auth.ts"));
    expect(msg).toContain("/codex-pair-ack a1b2c3d4e5");
  });
});

describe("collectInFlight (2026-07-02 seamless-pairing design)", () => {
  const NOW = 1_800_000_000_000;
  const FRESH = 900_000;

  it("lists unconsumed debounce records as settling files", () => {
    const records = [
      { file: "/r/a.ts", generation: 3, reviewedGen: 1 },
      { file: "/r/b.ts", generation: 2, reviewedGen: 2 },
    ];
    const result = collectInFlight({ records, lockMtimes: [], now: NOW, freshMs: FRESH });
    expect(result.settling).toEqual(["/r/a.ts"]);
    expect(result.reviewing).toBe(0);
    expect(result.any).toBe(true);
  });

  it("counts only fresh inflight locks; stale ones are crash junk", () => {
    const result = collectInFlight({
      records: [],
      lockMtimes: [NOW - 60_000, NOW - FRESH - 1, Number.NaN],
      now: NOW,
      freshMs: FRESH,
    });
    expect(result.reviewing).toBe(1);
    expect(result.settling).toEqual([]);
    expect(result.any).toBe(true);
  });

  it("tolerates malformed records and reports quiet state", () => {
    const result = collectInFlight({
      records: [null, {}, { file: 42, generation: 1, reviewedGen: 0 }],
      lockMtimes: [],
      now: NOW,
      freshMs: FRESH,
    });
    expect(result.any).toBe(false);
  });
});

describe("formatInFlightMessage", () => {
  it("names settling files, running count, and the log path with wait guidance", () => {
    const msg = formatInFlightMessage({ settling: ["/r/src/a.ts", "/r/src/b.ts"], reviewing: 1 }, "/r");
    expect(msg).toMatch(/in flight/i);
    expect(msg).toMatch(/a\.ts/);
    expect(msg).toMatch(/b\.ts/);
    expect(msg).toMatch(/1 review\(s\) running/);
    expect(msg).toMatch(/log\.jsonl/);
    expect(msg).toMatch(/HIGH/);
  });

  it("caps the settling file list", () => {
    const settling = Array.from({ length: 9 }, (_, i) => `/r/f${i}.ts`);
    const msg = formatInFlightMessage({ settling, reviewing: 0 }, "/r");
    expect(msg).toMatch(/\+4 more/);
  });
});

describe("codex-pair-stop-gate.mjs — runtime (pending drain + in-flight block)", () => {
  const GATE_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-stop-gate.mjs");
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stop-gate-rt-"));
    fs.mkdirSync(path.join(dir, ".codex-pair"), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeMarker(frontmatter = "") {
    fs.writeFileSync(path.join(dir, ".codex-pair", "context.md"), `${frontmatter}# ctx`);
  }
  function seedPending(message: string) {
    const pendingDir = path.join(dir, ".codex-pair", "state", "pending");
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, "seed.json"), JSON.stringify({ file: "/x", message }));
  }
  function runGate(payload: object = { hook_event_name: "Stop" }) {
    return spawnSync("node", [GATE_PATH], {
      input: JSON.stringify(payload),
      cwd: dir,
      encoding: "utf-8",
      timeout: 10_000,
    });
  }

  it("no blockOn: drained pending verdicts reach the model via Stop additionalContext", () => {
    writeMarker();
    seedPending("[codex-pair] reviewed x.ts — 1H/0M/0L");
    const result = runGate();
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out.hookSpecificOutput?.hookEventName).toBe("Stop");
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/reviewed x\.ts/);
    expect(out.decision).toBeUndefined();
    // queue is cleared — surfaced exactly once
    const files = fs.readdirSync(path.join(dir, ".codex-pair", "state", "pending"));
    expect(files.filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  it("no blockOn + nothing pending: silent exit (existing behavior preserved)", () => {
    writeMarker();
    const result = runGate();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("blockOn HIGH: unconsumed debounce record blocks once with wait guidance", () => {
    writeMarker("---\nblockOn: HIGH\n---\n");
    const debounceDir = path.join(dir, ".codex-pair", "state", "debounce");
    fs.mkdirSync(debounceDir, { recursive: true });
    const edited = path.join(dir, "src.ts");
    fs.writeFileSync(
      path.join(debounceDir, "aaaa.json"),
      JSON.stringify({ file: edited, generation: 2, reviewedGen: 0, burstStartedAt: Date.now() }),
    );
    const result = runGate();
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/in flight/i);
    expect(out.reason).toMatch(/src\.ts/);
  });

  it("blockOn HIGH: a worker `reviewing` marker blocks (handoff-gap coverage)", () => {
    writeMarker("---\nblockOn: HIGH\n---\n");
    const reviewingDir = path.join(dir, ".codex-pair", "state", "reviewing");
    fs.mkdirSync(reviewingDir, { recursive: true });
    fs.writeFileSync(
      path.join(reviewingDir, "bbbb.json"),
      JSON.stringify({ file: path.join(dir, "src.ts"), at: Date.now() }),
    );
    const result = runGate();
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/in flight/i);
  });

  it("blockOn HIGH: fresh inflight lock blocks; stale lock does not", () => {
    writeMarker("---\nblockOn: HIGH\n---\n");
    const inflightDir = path.join(dir, ".codex-pair", "state", "inflight");
    fs.mkdirSync(inflightDir, { recursive: true });
    const lock = path.join(inflightDir, "abc123");
    fs.writeFileSync(lock, "12345");
    const fresh = runGate();
    expect(JSON.parse(fresh.stdout.trim()).decision).toBe("block");
    // age the lock beyond the freshness window → treated as crash junk
    const old = new Date(Date.now() - 2 * 3_600_000);
    fs.utimesSync(lock, old, old);
    const stale = runGate();
    expect(stale.status).toBe(0);
    expect(stale.stdout.trim()).toBe("");
  });

  it("blockOn HIGH: marker frontmatter timeoutMs extends the lock freshness window (PR #208 review)", () => {
    // A project pinning a 2h per-review timeout must keep a 1h-old lock
    // registering as in-flight (default freshness is ~14.3 min).
    writeMarker("---\nblockOn: HIGH\ntimeoutMs: 7200000\n---\n");
    const inflightDir = path.join(dir, ".codex-pair", "state", "inflight");
    fs.mkdirSync(inflightDir, { recursive: true });
    const lock = path.join(inflightDir, "abc123");
    fs.writeFileSync(lock, "12345");
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(lock, old, old);
    const result = runGate();
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/in flight/i);
  });

  it("stop_hook_active exits 0 without draining or blocking (loop guard)", () => {
    writeMarker("---\nblockOn: HIGH\n---\n");
    seedPending("queued verdict");
    const result = runGate({ hook_event_name: "Stop", stop_hook_active: true });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
    // pending NOT consumed — it will surface on a later drain
    const files = fs.readdirSync(path.join(dir, ".codex-pair", "state", "pending"));
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
  });

  it("blockOn HIGH: unacked HIGH in log blocks and folds drained pending into the reason", () => {
    writeMarker("---\nblockOn: HIGH\n---\n");
    const edited = path.join(dir, "src.ts");
    fs.writeFileSync(edited, "export const x = 1;");
    fs.writeFileSync(
      path.join(dir, ".codex-pair", "log.jsonl"),
      `${JSON.stringify({ file: edited, verdict: "concerns", concerns: { high: ["H-finding"] } })}\n`,
    );
    seedPending("[codex-pair] queued verdict text");
    const result = runGate();
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/H-finding/);
    expect(out.reason).toMatch(/queued verdict text/);
  });
});

describe("codex-pair-stop-gate.mjs — cross-repo (#209)", () => {
  const GATE_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-stop-gate.mjs");
  let cwdRepo: string;
  let otherRepo: string;
  const SESSION = `cp-gate-xrepo-${process.pid}`;

  beforeEach(() => {
    cwdRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-gate-cwd-"));
    otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-gate-other-"));
    for (const r of [cwdRepo, otherRepo]) fs.mkdirSync(path.join(r, ".codex-pair"), { recursive: true });
    // cwd repo has a marker but no findings.
    fs.writeFileSync(path.join(cwdRepo, ".codex-pair", "context.md"), "# ctx");
  });
  afterEach(() => {
    clearSession(SESSION);
    fs.rmSync(cwdRepo, { recursive: true, force: true });
    fs.rmSync(otherRepo, { recursive: true, force: true });
  });

  function run(session?: string) {
    return spawnSync("node", [GATE_PATH], {
      input: JSON.stringify({ hook_event_name: "Stop", ...(session ? { session_id: session } : {}) }),
      cwd: cwdRepo,
      encoding: "utf-8",
      timeout: 10_000,
    });
  }

  it("drains a registered non-cwd repo's pending verdict via additionalContext", () => {
    fs.writeFileSync(path.join(otherRepo, ".codex-pair", "context.md"), "# ctx"); // no blockOn
    const pend = path.join(otherRepo, ".codex-pair", "state", "pending");
    fs.mkdirSync(pend, { recursive: true });
    fs.writeFileSync(
      path.join(pend, "seed.json"),
      JSON.stringify({ file: "/x", message: "[codex-pair] reviewed q.ts — 1H/0M/0L" }),
    );
    registerMarker(SESSION, otherRepo);

    const res = run(SESSION);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.trim());
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/reviewed q\.ts/);
    expect(fs.readdirSync(pend).filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  it("blocks turn-end on an unaddressed HIGH in a registered non-cwd repo", () => {
    fs.writeFileSync(path.join(otherRepo, ".codex-pair", "context.md"), "---\nblockOn: HIGH\n---\n# ctx");
    const target = path.join(otherRepo, "auth.ts");
    fs.writeFileSync(target, "export const x = 1;\n");
    fs.writeFileSync(
      path.join(otherRepo, ".codex-pair", "log.jsonl"),
      `${JSON.stringify({ file: target, verdict: "concerns", concerns: { high: ["missing await on mutation"] } })}\n`,
    );
    registerMarker(SESSION, otherRepo);

    const res = run(SESSION);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.trim());
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/unaddressed HIGH/);
    expect(out.reason).toMatch(/auth\.ts/);
  });

  it("without session_id, the non-cwd HIGH does NOT block (cwd-only fallback)", () => {
    fs.writeFileSync(path.join(otherRepo, ".codex-pair", "context.md"), "---\nblockOn: HIGH\n---\n# ctx");
    const target = path.join(otherRepo, "auth.ts");
    fs.writeFileSync(target, "export const x = 1;\n");
    fs.writeFileSync(
      path.join(otherRepo, ".codex-pair", "log.jsonl"),
      `${JSON.stringify({ file: target, verdict: "concerns", concerns: { high: ["missing await"] } })}\n`,
    );
    registerMarker(SESSION, otherRepo);

    const res = run(); // no session_id
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("");
  });

  it("caps surfaced verdicts globally across markers, not per-repo", () => {
    // 5 pending in cwd repo + 5 in the registered repo = 10 total. The
    // MAX_SURFACE_VERDICTS (8) cap must apply ONCE across markers → exactly one
    // "+2 more" trailer. The pre-fix per-marker cap would show all 10 with no
    // trailer (5 ≤ 8 in each repo).
    fs.writeFileSync(path.join(otherRepo, ".codex-pair", "context.md"), "# ctx"); // no blockOn
    const seed = (repo: string, n: number, tag: string) => {
      const pend = path.join(repo, ".codex-pair", "state", "pending");
      fs.mkdirSync(pend, { recursive: true });
      for (let i = 0; i < n; i++) {
        fs.writeFileSync(
          path.join(pend, `${tag}-${i}.json`),
          JSON.stringify({ file: `/x/${tag}${i}`, message: `[codex-pair] ${tag} verdict ${i}` }),
        );
      }
    };
    seed(cwdRepo, 5, "cwd");
    seed(otherRepo, 5, "other");
    registerMarker(SESSION, otherRepo);

    const res = run(SESSION);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.trim());
    const ctx = out.hookSpecificOutput?.additionalContext ?? "";
    expect(ctx).toMatch(/\+2 more verdict\(s\) drained/);
    expect((ctx.match(/more verdict\(s\) drained/g) || []).length).toBe(1);
  });
});
