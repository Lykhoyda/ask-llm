import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bumpEditRecord,
  clearAllDebounceState,
  contentHash,
  debounceRecordPath,
  decideReview,
  drainPending,
  joinPendingForSurface,
  MAX_SURFACE_VERDICTS,
  markReviewed,
  pendingPath,
  pendingRoot,
  readEditRecord,
  reviewedPath,
  sweepHorizonMs,
  sweepStaleDebounce,
  writePending,
  writePendingNotice,
} from "../../scripts/lib/debounce-state.mjs";

describe("lib/debounce-state.mjs", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "debounce-state-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("bumpEditRecord increments generation across edits", () => {
    const a = bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 1000 });
    const b = bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 1100 });
    expect(a.generation).toBe(1);
    expect(b.generation).toBe(2);
  });

  it("bumpEditRecord preserves burstStartedAt while a burst is unconsumed", () => {
    bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 1000 });
    const b = bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 5000 });
    expect(b.burstStartedAt).toBe(1000);
  });

  it("bumpEditRecord resets burstStartedAt after the prior burst was reviewed", () => {
    bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 1000 }); // gen 1
    markReviewed(dir, "/x.ts", 1);
    const next = bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 9000 }); // gen 2
    expect(next.burstStartedAt).toBe(9000);
  });

  it("readEditRecord returns null for missing/malformed", () => {
    expect(readEditRecord(dir, "/missing.ts")).toBeNull();
  });

  it("decideReview: latest generation → review (settled)", () => {
    const record = { file: "/x.ts", generation: 3, burstStartedAt: 0, reviewedGen: 0 };
    expect(decideReview({ record, myGeneration: 3, now: 100, maxMs: 60000 })).toEqual({
      review: true,
      reason: "settled",
    });
  });

  it("decideReview: superseded + under cap → skip", () => {
    const record = { file: "/x.ts", generation: 5, burstStartedAt: 1000, reviewedGen: 0 };
    expect(decideReview({ record, myGeneration: 2, now: 2000, maxMs: 60000 })).toEqual({
      review: false,
      reason: "superseded",
    });
  });

  it("decideReview: superseded but burst exceeded maxMs → review (cap)", () => {
    const record = { file: "/x.ts", generation: 5, burstStartedAt: 1000, reviewedGen: 0 };
    expect(decideReview({ record, myGeneration: 2, now: 70000, maxMs: 60000 })).toEqual({
      review: true,
      reason: "max-cap",
    });
  });

  it("decideReview: missing record → skip (cancelled)", () => {
    expect(decideReview({ record: null, myGeneration: 1, now: 0, maxMs: 60000 })).toEqual({
      review: false,
      reason: "record-missing",
    });
  });

  it("decideReview: already reviewed at >= my generation → skip", () => {
    const record = { file: "/x.ts", generation: 3, burstStartedAt: 0, reviewedGen: 3 };
    expect(decideReview({ record, myGeneration: 3, now: 0, maxMs: 60000 }).review).toBe(false);
  });

  function seedVerdict(name: string, text: string, message: string) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    writePending(dir, file, message, contentHash(text));
    return file;
  }

  it("writePending then drainPending returns the message and clears it", () => {
    seedVerdict("x.ts", "export const x = 1;\n", "[codex-pair] reviewed x.ts — 1H");
    expect(drainPending(dir)).toEqual(["[codex-pair] reviewed x.ts — 1H"]);
    expect(drainPending(dir)).toEqual([]); // drained exactly once
  });

  it("drainPending on a fresh dir returns []", () => {
    expect(drainPending(dir)).toEqual([]);
  });

  it("joinPendingForSurface joins all messages when under the cap", () => {
    const msgs = ["a", "b", "c"];
    expect(joinPendingForSurface(msgs)).toBe("a\n\nb\n\nc");
  });

  it("joinPendingForSurface caps the surfaced verdicts and appends an overflow trailer", () => {
    const msgs = Array.from({ length: MAX_SURFACE_VERDICTS + 3 }, (_, i) => `v${i}`);
    const out = joinPendingForSurface(msgs);
    const shown = out.split("\n\n").filter((l) => /^v\d+$/.test(l));
    expect(shown.length).toBe(MAX_SURFACE_VERDICTS);
    expect(out).toMatch(/\+3 more verdict\(s\) drained — see \.codex-pair\/log\.jsonl/);
  });

  it("clearAllDebounceState removes records and pending", () => {
    bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 1 });
    seedVerdict("y.ts", "export const y = 1;\n", "msg");
    clearAllDebounceState(dir);
    expect(readEditRecord(dir, "/x.ts")).toBeNull();
    expect(drainPending(dir)).toEqual([]);
  });

  it("C1: markReviewed never rewrites the edit record", () => {
    bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 1000 });
    const before = fs.readFileSync(debounceRecordPath(dir, "/x.ts"));
    markReviewed(dir, "/x.ts", 1);
    expect(fs.readFileSync(debounceRecordPath(dir, "/x.ts"))).toEqual(before);
    expect(readEditRecord(dir, "/x.ts")?.reviewedGen).toBe(1);
  });

  it("C2: markReviewed is monotonic", () => {
    bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 1000 });
    markReviewed(dir, "/x.ts", 5);
    markReviewed(dir, "/x.ts", 3);
    expect(readEditRecord(dir, "/x.ts")?.reviewedGen).toBe(5);
  });

  it("C3: a swept edit record restarts above the done-marker", () => {
    bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 1000 });
    markReviewed(dir, "/x.ts", 7);
    fs.unlinkSync(debounceRecordPath(dir, "/x.ts"));
    const next = bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 2000 });
    expect(next.generation).toBe(8);
    const decision = decideReview({ record: readEditRecord(dir, "/x.ts"), myGeneration: 8, now: 2000, maxMs: 60000 });
    expect(decision.reason).toBe("settled");
  });

  it("C5: sweep retains active generations and expires all three state roots after the review horizon", () => {
    const file = path.join(dir, "active.ts");
    bumpEditRecord(dir, file, { now: Date.now() });
    writePending(dir, file, "review", contentHash("review"));
    markReviewed(dir, file, 1);
    const paths = [debounceRecordPath(dir, file), pendingPath(dir, file), reviewedPath(dir, file)];
    const timing = { debounceMaxMs: 60_000, timeoutMs: 800_000, settleMs: 15_000 };
    const age = (minutes: number) => {
      const old = new Date(Date.now() - minutes * 60_000);
      for (const p of paths) fs.utimesSync(p, old, old);
    };

    age(20);
    sweepStaleDebounce(dir, timing);
    expect(paths.every(fs.existsSync)).toBe(true);

    age(31);
    sweepStaleDebounce(dir, timing);
    expect(paths.every((p) => !fs.existsSync(p))).toBe(true);

    const floorTiming = { debounceMaxMs: 1_200_000, timeoutMs: 1, settleMs: 0 };
    expect(sweepHorizonMs(floorTiming)).toBe(1_500_000);
    bumpEditRecord(dir, file, { now: Date.now() });
    const record = debounceRecordPath(dir, file);
    const old = new Date(Date.now() - 24 * 60_000);
    fs.utimesSync(record, old, old);
    sweepStaleDebounce(dir, floorTiming);
    expect(fs.existsSync(record)).toBe(true);
    const expired = new Date(Date.now() - 26 * 60_000);
    fs.utimesSync(record, expired, expired);
    sweepStaleDebounce(dir, floorTiming);
    expect(fs.existsSync(record)).toBe(false);
  });

  it("C4: drain surfaces a verdict whose content is still on disk", () => {
    seedVerdict("a.ts", "export const a = 1;\n", "verdict a");
    expect(drainPending(dir)).toEqual(["verdict a"]);
    expect(fs.readdirSync(pendingRoot(dir))).toEqual([]);
  });

  it("C4: drain drops a verdict for content that has since changed", () => {
    const file = seedVerdict("b.ts", "export const b = 1;\n", "verdict b");
    fs.writeFileSync(file, "export const b = 2;\n");
    expect(drainPending(dir)).toEqual([]);
    expect(fs.readdirSync(pendingRoot(dir))).toEqual([]);
  });

  it("C4: drain drops a pre-upgrade entry with no content hash", () => {
    const file = path.join(dir, "c.ts");
    fs.writeFileSync(file, "export const c = 1;\n");
    fs.mkdirSync(pendingRoot(dir), { recursive: true });
    fs.writeFileSync(path.join(pendingRoot(dir), "legacy.json"), JSON.stringify({ file, message: "legacy" }));
    expect(drainPending(dir)).toEqual([]);
    expect(fs.readdirSync(pendingRoot(dir))).toEqual([]);
  });

  it("C4: drain surfaces notices without checking file content", () => {
    writePendingNotice(dir, "codex-pair auto-resumed");
    expect(drainPending(dir)).toEqual(["codex-pair auto-resumed"]);
    expect(fs.readdirSync(pendingRoot(dir))).toEqual([]);
  });
});
