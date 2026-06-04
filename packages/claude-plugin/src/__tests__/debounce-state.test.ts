import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bumpEditRecord,
  clearAllDebounceState,
  decideReview,
  drainPending,
  markReviewed,
  readEditRecord,
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

  it("clearAllDebounceState removes records and pending", () => {
    bumpEditRecord(dir, "/x.ts", { sessionId: "s", now: 1 });
    writePending(dir, "/y.ts", "msg");
    clearAllDebounceState(dir);
    expect(readEditRecord(dir, "/x.ts")).toBeNull();
    expect(drainPending(dir)).toEqual([]);
  });
});
