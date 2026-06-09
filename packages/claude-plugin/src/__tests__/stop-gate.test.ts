import { describe, expect, it } from "vitest";
import { selectLatestEntries, parseGitPorcelain } from "../../scripts/lib/stop-gate.mjs";
import { collectBlockingHighs } from "../../scripts/lib/stop-gate.mjs";

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
    const out = [
      " M src/a.ts",
      "?? src/new.ts",
      "R  old.ts -> src/b.ts",
      "",
    ].join("\n");
    const set = parseGitPorcelain(out, "/repo");
    expect(set.has("/repo/src/a.ts")).toBe(true);
    expect(set.has("/repo/src/new.ts")).toBe(true);
    expect(set.has("/repo/src/b.ts")).toBe(true); // rename → new path is the dirty one
    expect(set.has("/repo/old.ts")).toBe(false);
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
