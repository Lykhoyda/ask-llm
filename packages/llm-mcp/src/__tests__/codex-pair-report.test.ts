import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PLUGIN_ROOT } from "./_helpers.js";

let scratch: string;
let repo: string;
let cwd: string;
let pair: string;
let log: string;
let state: string;

const ACKED = "b421584ba336fb83";
const BLOCKING = "fc69d46835dfd2ab";
// First 16 hex characters of SHA-256("a.ts:Legacy medium comment").
const LEGACY_MEDIUM = "33e4573a12d24e64";

function script(name: string, args: string[], input = "") {
  const result = spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", name), ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, CODEX_PAIR_DISABLED: "0", CLAUDE_CONFIG_DIR: join(scratch, "claude") },
    timeout: 5000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

function cli(...args: string[]) {
  const result = script("codex-pair-log.mjs", args);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  return result.stdout;
}

function writeLog(...entries: object[]) {
  writeFileSync(log, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

function stopGate() {
  const result = script("codex-pair-stop-gate.mjs", [], '{"hook_event_name":"Stop"}');
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return result.stdout;
}

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "codex-pair-report-")));
  repo = join(scratch, "project");
  cwd = join(repo, "nested");
  pair = join(repo, ".codex-pair");
  log = join(pair, "log.jsonl");
  state = join(pair, "state");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(pair);
  writeFileSync(join(pair, "context.md"), "---\nblockOn: HIGH\n---\n# Fixture");
  execFileSync("git", ["init", "--quiet", repo]);
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

it("reports two unique HIGHs, one MED, cache repeats, actual fallback attribution and a manual pause", () => {
  const a = join(repo, "a.ts");
  const b = join(repo, "b.ts");
  writeFileSync(a, "changed a");
  writeFileSync(b, "current b");
  const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const recent = new Date(Date.now() - 30_000).toISOString();
  const fallback = {
    timestamp: old,
    file: b,
    contentHash: createHash("sha256").update("current b").digest("hex"),
    concernHashes: { high: [BLOCKING], med: [], low: [] },
    concerns: { high: ["Review text stays out of report output"], med: [], low: [] },
    reviewer: "codex",
    model: "gpt-6.1-terra",
    reasoningEffort: "xhigh",
    fellBack: true,
  };
  writeLog(
    {
      timestamp: old,
      file: a,
      verdict: "concerns",
      concernHashes: { high: [ACKED] },
      concerns: { high: ["old high"], med: ["Legacy medium comment"], low: [] },
    },
    { ...fallback, verdict: "concerns" },
    { ...fallback, verdict: "cached" },
    { timestamp: old, verdict: "paused", event: "pause", pauseKind: "manual", pauseSource: "manual" },
    { timestamp: recent, file: a, verdict: "none", reviewer: "codex", model: "gpt-6.2-sol", reasoningEffort: "high" },
    { timestamp: recent, file: b, verdict: "error", contentHash: "a different snapshot" },
  );
  const reason = "Accepted by owner: `literal` and $(literal).\nFollow-up planned.";
  const acked = script("codex-pair-log.mjs", ["ack", ACKED], `${reason}\n`);
  expect(acked.status).toBe(0);
  expect(acked.stdout.trim()).toBe(`codex-pair: acknowledged ${ACKED}`);

  const human = cli("--report").trim().split("\n");
  expect(human).toEqual([
    "codex-pair project (retained log) | reviews run 3, cache hits 1, fallback reviews 1 | 2 HIGH / 1 MED / 0 LOW unique, repeats 1 | 1 acknowledged | 1 HIGH blocking now, 0 other unacknowledged HIGH | 2 findings no longer reported on the latest review of their file | pause windows 1 | unknown/unknown/unknown (1 run, 0 cached), codex/gpt-6.1-terra/xhigh (1 run, 1 cached), codex/gpt-6.2-sol/high (1 run, 0 cached)",
    `Repeated HIGH [${BLOCKING}] "b.ts" ×1`,
    `Acknowledged HIGH [${ACKED}] "a.ts" — ${JSON.stringify(reason)}`,
    `Blocking now HIGH [${BLOCKING}] "b.ts"`,
    `Finding no longer reported on the latest review of its file — HIGH [${ACKED}] "a.ts"`,
    `Finding no longer reported on the latest review of its file — MED [${LEGACY_MEDIUM}] "a.ts"`,
    `Pause manual ${old} → open`,
  ]);
  const json = JSON.parse(cli("--report", "--json"));
  expect(json).toEqual({
    repository: "project",
    since: null,
    reviewsRun: 3,
    cachedHits: 1,
    fallbackReviews: 1,
    findingsComplete: true,
    findingsBySeverity: { high: 2, med: 1, low: 0 },
    repeatedFindings: [{ hash: BLOCKING, file: "b.ts", severity: "high", repeats: 1 }],
    acknowledgedFindings: [{ hash: ACKED, file: "a.ts", severity: "high", reason }],
    blockingHighs: [{ hash: BLOCKING, file: "b.ts", severity: "high" }],
    otherUnacknowledgedHighs: [],
    noLongerReported: [
      { hash: ACKED, file: "a.ts", severity: "high" },
      { hash: LEGACY_MEDIUM, file: "a.ts", severity: "med" },
    ],
    models: [
      { reviewer: "unknown", model: "unknown", reasoningEffort: "unknown", reviewsRun: 1, cachedHits: 0 },
      { reviewer: "codex", model: "gpt-6.1-terra", reasoningEffort: "xhigh", reviewsRun: 1, cachedHits: 1 },
      { reviewer: "codex", model: "gpt-6.2-sol", reasoningEffort: "high", reviewsRun: 1, cachedHits: 0 },
    ],
    pauseWindows: [{ kind: "manual", startedAt: old, endedAt: "open" }],
  });

  const window = JSON.parse(cli("--report", "--json", "--since", "1h"));
  expect(window).toMatchObject({
    reviewsRun: 1,
    cachedHits: 0,
    findingsBySeverity: { high: 0, med: 0, low: 0 },
    blockingHighs: [{ hash: BLOCKING, file: "b.ts", severity: "high" }],
    acknowledgedFindings: [],
    noLongerReported: [],
    pauseWindows: [{ kind: "manual", startedAt: old, endedAt: "open" }],
  });
  expect(Date.parse(window.since)).toBeGreaterThan(Date.parse(old));
  expect(Date.parse(window.since)).toBeLessThan(Date.parse(recent));

  expect(JSON.parse(stopGate())).toMatchObject({ decision: "block", reason: expect.stringContaining(BLOCKING) });
  writeFileSync(b, "edited after review");
  expect(JSON.parse(cli("--report", "--json"))).toMatchObject({
    blockingHighs: [],
    otherUnacknowledgedHighs: [{ hash: BLOCKING, file: "b.ts", severity: "high" }],
    noLongerReported: json.noLongerReported,
  });
  expect(stopGate()).toBe("");
  writeFileSync(b, "current b");
  writeFileSync(join(pair, "context.md"), "---\nblockOn: false\n---\n");
  expect(JSON.parse(cli("--report", "--json"))).toMatchObject({
    blockingHighs: [],
    otherUnacknowledgedHighs: [{ hash: BLOCKING, file: "b.ts", severity: "high" }],
  });
  writeFileSync(join(pair, "context.md"), "---\nblockOn: HIGH\n---\n");
  expect(script("codex-pair-log.mjs", ["ack", BLOCKING], " \n").status).toBe(2);
  expect(JSON.parse(stopGate()).decision).toBe("block");
  expect(script("codex-pair-log.mjs", ["ack", BLOCKING], "Accepted after review\n").status).toBe(0);
  const shards = readdirSync(join(state, "acks")).map((name) =>
    JSON.parse(readFileSync(join(state, "acks", name), "utf8")),
  );
  expect(shards).toContainEqual({ hash: BLOCKING, reason: "Accepted after review", ts: expect.any(String) });
  expect(stopGate()).toBe("");
});

it("counts successful Pi reviews with unknown attribution in human and JSON reports", () => {
  const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const recent = new Date(Date.now() - 30_000).toISOString();
  const entry = {
    tool: "edit",
    file: join(repo, "a.ts"),
    verdict: "none",
    source: "pi",
    fellBack: false,
    cached: false,
    counts: { high: 0, med: 0, low: 0 },
    durationMs: 100,
  };
  writeLog(
    { ...entry, timestamp: old },
    { ...entry, timestamp: recent, cached: true, fellBack: true },
    { ...entry, timestamp: recent, verdict: "error", cached: true },
  );
  expect(cli("--report").trim()).toBe(
    "codex-pair project (retained log) | reviews run 1, cache hits 1, fallback reviews 0 | 0 HIGH / 0 MED / 0 LOW unique, repeats 0 | 0 acknowledged | 0 HIGH blocking now, 0 other unacknowledged HIGH | 0 findings no longer reported on the latest review of their file | pause windows 0 | unknown/unknown/unknown (1 run, 1 cached)",
  );
  expect(JSON.parse(cli("--report", "--json"))).toEqual({
    repository: "project",
    since: null,
    reviewsRun: 1,
    cachedHits: 1,
    fallbackReviews: 0,
    findingsComplete: true,
    findingsBySeverity: { high: 0, med: 0, low: 0 },
    repeatedFindings: [],
    acknowledgedFindings: [],
    blockingHighs: [],
    otherUnacknowledgedHighs: [],
    noLongerReported: [],
    models: [{ reviewer: "unknown", model: "unknown", reasoningEffort: "unknown", reviewsRun: 1, cachedHits: 1 }],
    pauseWindows: [],
  });
  expect(JSON.parse(cli("--report", "--json", "--since", "1h"))).toMatchObject({
    reviewsRun: 0,
    cachedHits: 1,
    models: [{ reviewer: "unknown", model: "unknown", reasoningEffort: "unknown", reviewsRun: 0, cachedHits: 1 }],
  });
});

it.each(["high", "med", "low"] as const)("marks counts-only %s finding metrics as partial", (severity) => {
  writeLog({
    timestamp: new Date().toISOString(),
    file: join(repo, "a.ts"),
    source: "pi",
    verdict: "concerns",
    counts: { high: 0, med: 0, low: 0, [severity]: 1 },
  });
  expect(JSON.parse(cli("--report", "--json"))).toMatchObject({
    reviewsRun: 1,
    findingsComplete: false,
    findingsBySeverity: { high: 0, med: 0, low: 0 },
    repeatedFindings: [],
    acknowledgedFindings: [],
    otherUnacknowledgedHighs: [],
    noLongerReported: [],
  });
  expect(cli("--report").trim()).toBe(
    "codex-pair project (retained log) | reviews run 1, cache hits 0, fallback reviews 0 | 0 known (partial) HIGH / 0 known (partial) MED / 0 known (partial) LOW unique, repeats 0 known (partial) | 0 known (partial) acknowledged | 0 HIGH blocking now, 0 known (partial) other unacknowledged HIGH | 0 known (partial) findings no longer reported on the latest review of their file | pause windows 0 | unknown/unknown/unknown (1 run, 0 cached)",
  );
});

it("retains known hashes, repeats and acknowledgement reasons when other identities are missing", () => {
  const known = {
    timestamp: new Date().toISOString(),
    file: join(repo, "a.ts"),
    verdict: "concerns",
    counts: { high: 1, med: 0, low: 0 },
    concernHashes: { high: [ACKED], med: [], low: [] },
  };
  writeLog(
    known,
    { ...known, cached: true },
    { ...known, counts: { high: 2, med: 0, low: 0 } },
  );
  expect(script("codex-pair-log.mjs", ["ack", ACKED], "Accepted legacy finding\n").status).toBe(0);
  expect(JSON.parse(cli("--report", "--json"))).toMatchObject({
    reviewsRun: 2,
    cachedHits: 1,
    findingsComplete: false,
    findingsBySeverity: { high: 1, med: 0, low: 0 },
    repeatedFindings: [{ hash: ACKED, file: "a.ts", severity: "high", repeats: 2 }],
    acknowledgedFindings: [{ hash: ACKED, file: "a.ts", severity: "high", reason: "Accepted legacy finding" }],
    noLongerReported: [],
  });
  const human = cli("--report");
  expect(human).toContain("1 known (partial) HIGH");
  expect(human).toContain("repeats 2 known (partial)");
  expect(human).toContain("1 known (partial) acknowledged");
  expect(human).toContain(`Repeated HIGH [${ACKED}] "a.ts" ×2 known (partial)`);
  expect(human).toContain(`Acknowledged HIGH [${ACKED}] "a.ts" — "Accepted legacy finding"`);
});

it.each([
  { verdict: "concerns" },
  { verdict: "cached" },
  { verdict: "concerns", counts: { high: 1, med: 0, low: 0 }, concernHashes: { high: [ACKED], med: [], low: [] } },
])("marks finding metrics as partial when a legacy review lacks a file: %j", (entry) => {
  writeLog({ timestamp: new Date().toISOString(), ...entry });
  expect(JSON.parse(cli("--report", "--json"))).toMatchObject({ findingsComplete: false });
  expect(cli("--report")).toContain("0 known (partial) acknowledged");
});

it("excludes old incomplete rows from window metrics but retains latest-review uncertainty", () => {
  const file = join(repo, "a.ts");
  const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const recent = new Date(Date.now() - 30_000).toISOString();
  const incomplete = { timestamp: old, file, verdict: "concerns", counts: { high: 1, med: 0, low: 0 } };
  const known = { timestamp: recent, file, verdict: "concerns", concernHashes: { high: [ACKED], med: [], low: [] } };
  writeLog(incomplete, known);
  expect(JSON.parse(cli("--report", "--json", "--since", "1h"))).toMatchObject({ findingsComplete: true });
  writeLog(known, incomplete);
  expect(JSON.parse(cli("--report", "--json", "--since", "1h"))).toMatchObject({
    findingsComplete: false,
    noLongerReported: [],
  });
});

it("records manual transitions once and resumes the shared hook state", () => {
  expect(cli("resume")).toContain("was not paused");
  expect(existsSync(log)).toBe(false);
  expect(cli("pause")).toContain("paused for");
  expect(readFileSync(join(state, "paused"), "utf8")).toBe("");
  expect(cli("--status")).toContain("State: paused (manual)");
  expect(cli("pause")).toContain("already paused");
  writeFileSync(join(state, "failures.json"), "{}");
  expect(cli("resume")).toContain("resumed for");
  expect(cli("resume")).toContain("was not paused");
  expect(cli("--status")).toContain("State: active");
  expect(existsSync(join(state, "paused"))).toBe(false);
  expect(existsSync(join(state, "failures.json"))).toBe(false);
  const transitions = readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(transitions).toEqual([
    { timestamp: expect.any(String), verdict: "paused", event: "pause", pauseKind: "manual", pauseSource: "manual" },
    { timestamp: expect.any(String), verdict: "resumed", event: "resume", pauseKind: "manual", pauseSource: "manual" },
  ]);
  expect(JSON.parse(cli("--report", "--json")).pauseWindows).toEqual([
    { kind: "manual", startedAt: transitions[0].timestamp, endedAt: transitions[1].timestamp },
  ]);
});

it("preserves a legacy auto-pause when already paused and records who resumed it", () => {
  mkdirSync(state);
  const at = "2026-01-05T00:00:00.000Z";
  writeFileSync(
    join(state, "paused"),
    JSON.stringify({ kind: "quota", at, reason: "test quota", resetHint: "1 hour" }),
  );
  expect(cli("pause")).toContain("already paused");
  expect(cli("resume")).toContain("Previous auto-pause (quota) — test quota, resets ~1 hour");
  const event = JSON.parse(readFileSync(log, "utf8"));
  expect(event).toEqual({
    timestamp: expect.any(String),
    verdict: "resumed",
    event: "resume",
    pauseKind: "quota",
    pauseSource: "manual",
    pauseStartedAt: at,
  });
  expect(JSON.parse(cli("--report", "--json")).pauseWindows).toEqual([
    { kind: "quota", startedAt: at, endedAt: event.timestamp },
  ]);
});
