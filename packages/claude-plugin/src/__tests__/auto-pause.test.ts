import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTOPAUSE_FAILURE_THRESHOLD,
  clearReviewFailures,
  failuresPath,
  pausePath,
  readFailureCount,
  readPauseInfo,
  recordReviewFailure,
  writeAutoPause,
} from "../../scripts/lib/state.mjs";

describe("lib/state.mjs — auto-pause sentinel (#176)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-pause-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("readPauseInfo → null when no sentinel exists", () => {
    expect(readPauseInfo(dir)).toBeNull();
  });

  it("readPauseInfo → {manual:true} for the empty sentinel /codex-pair-pause writes", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(pausePath(dir), "");
    expect(readPauseInfo(dir)).toEqual({ manual: true });
  });

  it("readPauseInfo → parsed JSON for an auto-pause body", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(
      pausePath(dir),
      JSON.stringify({ v: 1, kind: "quota", reason: "usage limit", resetHint: "3 hours", at: "2026-06-11T00:00:00Z" }),
    );
    const info = readPauseInfo(dir);
    expect(info?.kind).toBe("quota");
    expect(info?.resetHint).toBe("3 hours");
  });

  it("readPauseInfo → {manual:true} for a corrupt/unknown body (conservative)", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(pausePath(dir), "not json {][");
    expect(readPauseInfo(dir)).toEqual({ manual: true });
    fs.writeFileSync(pausePath(dir), JSON.stringify({ kind: "unknown-kind" }));
    expect(readPauseInfo(dir)).toEqual({ manual: true });
  });

  it("writeAutoPause creates the sentinel (kind/reason/at) and returns true", () => {
    const ok = writeAutoPause(dir, { kind: "quota", reason: "usage limit hit" });
    expect(ok).toBe(true);
    const body = JSON.parse(fs.readFileSync(pausePath(dir), "utf8"));
    expect(body.v).toBe(1);
    expect(body.kind).toBe("quota");
    expect(body.reason).toBe("usage limit hit");
    expect(typeof body.at).toBe("string");
    expect(body.resetHint).toBeUndefined();
  });

  it("writeAutoPause includes resetHint only when provided", () => {
    writeAutoPause(dir, { kind: "quota", reason: "r", resetHint: "3h 25m" });
    const body = JSON.parse(fs.readFileSync(pausePath(dir), "utf8"));
    expect(body.resetHint).toBe("3h 25m");
  });

  it("writeAutoPause NEVER clobbers an existing pause (wx) — returns false", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(pausePath(dir), ""); // manual pause
    const ok = writeAutoPause(dir, { kind: "failures", reason: "r" });
    expect(ok).toBe(false);
    expect(fs.readFileSync(pausePath(dir), "utf8")).toBe(""); // untouched
  });
});

describe("lib/state.mjs — consecutive-failure counter (#176)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-pause-fails-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("threshold constant is 3", () => {
    expect(AUTOPAUSE_FAILURE_THRESHOLD).toBe(3);
  });

  it("starts at 0, increments, and persists lastReason", () => {
    expect(readFailureCount(dir)).toBe(0);
    expect(recordReviewFailure(dir, "timeout A")).toBe(1);
    expect(recordReviewFailure(dir, "timeout B")).toBe(2);
    expect(readFailureCount(dir)).toBe(2);
    const body = JSON.parse(fs.readFileSync(failuresPath(dir), "utf8"));
    expect(body.consecutive).toBe(2);
    expect(body.lastReason).toBe("timeout B");
    expect(typeof body.lastAt).toBe("string");
  });

  it("clearReviewFailures resets to 0 (file removed) and is a no-op when absent", () => {
    recordReviewFailure(dir, "x");
    clearReviewFailures(dir);
    expect(readFailureCount(dir)).toBe(0);
    expect(fs.existsSync(failuresPath(dir))).toBe(false);
    clearReviewFailures(dir); // must not throw
  });

  it("treats corrupt failures.json as 0", () => {
    fs.mkdirSync(path.dirname(failuresPath(dir)), { recursive: true });
    fs.writeFileSync(failuresPath(dir), "garbage }{");
    expect(readFailureCount(dir)).toBe(0);
    expect(recordReviewFailure(dir, "y")).toBe(1);
  });
});
