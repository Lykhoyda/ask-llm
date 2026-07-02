import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bumpEditRecord,
  clearAllDebounceState,
  clearReviewing,
  decideReview,
  drainPending,
  joinPendingForSurface,
  MAX_SURFACE_VERDICTS,
  markReviewed,
  markReviewing,
  readEditRecord,
  reviewingPath,
  reviewingRoot,
  sweepStaleDebounce,
  writePending,
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

  it("writePending then drainPending returns the message and clears it", () => {
    writePending(dir, "/x.ts", "[codex-pair] reviewed x.ts — 1H");
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
    writePending(dir, "/y.ts", "msg");
    clearAllDebounceState(dir);
    expect(readEditRecord(dir, "/x.ts")).toBeNull();
    expect(drainPending(dir)).toEqual([]);
  });
});

describe("reviewing marker (worker handoff coverage, 2026-07-02)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "reviewing-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("markReviewing writes a marker under state/reviewing; clearReviewing removes it", () => {
    markReviewing(dir, "/r/a.ts");
    const p = reviewingPath(dir, "/r/a.ts");
    expect(fs.existsSync(p)).toBe(true);
    const body = JSON.parse(fs.readFileSync(p, "utf8"));
    expect(body.file).toBe("/r/a.ts");
    expect(typeof body.at).toBe("number");
    clearReviewing(dir, "/r/a.ts");
    expect(fs.existsSync(p)).toBe(false);
    expect(() => clearReviewing(dir, "/r/a.ts")).not.toThrow(); // idempotent
  });

  it("clearAllDebounceState and sweepStaleDebounce also cover the reviewing dir", () => {
    markReviewing(dir, "/r/a.ts");
    clearAllDebounceState(dir);
    expect(fs.readdirSync(reviewingRoot(dir))).toEqual([]);
    markReviewing(dir, "/r/b.ts");
    const p = reviewingPath(dir, "/r/b.ts");
    const old = new Date(Date.now() - 2 * 3_600_000);
    fs.utimesSync(p, old, old);
    sweepStaleDebounce(dir, 60_000);
    expect(fs.existsSync(p)).toBe(false);
  });
});
