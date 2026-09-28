import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseResetHint } from "../../scripts/lib/parser.mjs";
import {
  AUTOPAUSE_FAILURE_THRESHOLD,
  clearAutoPause,
  clearReviewFailures,
  failuresPath,
  pausePath,
  readFailureCount,
  readPauseInfo,
  readPluginVersion,
  recordReviewFailure,
  resolveAutoResume,
  writeAutoPause,
} from "../../scripts/lib/state.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

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

  it("readPauseInfo → parsed JSON for a failures-kind body", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(
      pausePath(dir),
      JSON.stringify({ v: 1, kind: "failures", reason: "3 consecutive failures", at: "2026-06-11T00:00:00Z" }),
    );
    const info = readPauseInfo(dir);
    expect(info?.kind).toBe("failures");
    expect(info?.reason).toBe("3 consecutive failures");
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

describe("lib/parser.mjs — parseResetHint (#176)", () => {
  it.each([
    ["You've hit your usage limit. Try again in 3 hours 25 minutes.", "3 hours 25 minutes"],
    ["Rate limited, try again at 14:30 UTC", "14:30 UTC"],
    ["quota exceeded; resets at 2026-06-12T00:00:00Z", "2026-06-12T00:00:00Z"],
    ["please try again after 2 hours", "2 hours"],
  ])("extracts the hint from %j", (input, expected) => {
    expect(parseResetHint(input)).toBe(expected);
  });

  it("strips trailing clauses after , or ; inside the capture", () => {
    expect(parseResetHint("try again in 2 hours, or contact support")).toBe("2 hours");
  });

  it("does not bleed across newlines", () => {
    expect(parseResetHint("try again in 2 hours\nstack trace line")).toBe("2 hours");
  });

  it("rejects bare-numeric captures (decimal-seconds truncation)", () => {
    expect(parseResetHint("Please try again in 1.928s.")).toBeNull();
  });

  it("returns null when nothing parseable", () => {
    expect(parseResetHint("rate_limit_exceeded: capacity exhausted")).toBeNull();
    expect(parseResetHint("")).toBeNull();
    expect(parseResetHint(null as unknown as string)).toBeNull();
  });

  it("caps absurdly long hints", () => {
    const hint = parseResetHint(`try again in ${"x".repeat(300)}`);
    expect(hint).toBeNull(); // > 80 chars is not a plausible reset time
  });
});

describe("lib/state.mjs — self-healing auto-pause (2026-07-02 seamless-pairing design)", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "auto-resume-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const HOUR = 3_600_000;
  const NOW = Date.parse("2026-07-02T12:00:00Z");
  const atHoursAgo = (h: number) => new Date(NOW - h * HOUR).toISOString();

  it("manual pause never auto-resumes", () => {
    expect(resolveAutoResume({ manual: true }, { now: NOW, currentVersion: "1.0.0" }).resume).toBe(false);
    expect(resolveAutoResume(null, { now: NOW, currentVersion: "1.0.0" }).resume).toBe(false);
  });

  it("quota pause: fresh stays paused, past TTL resumes", () => {
    const fresh = { kind: "quota", reason: "r", at: atHoursAgo(1) };
    const stale = { kind: "quota", reason: "r", at: atHoursAgo(7) };
    expect(resolveAutoResume(fresh, { now: NOW }).resume).toBe(false);
    const decision = resolveAutoResume(stale, { now: NOW });
    expect(decision.resume).toBe(true);
    expect(decision.why).toBe("ttl-expired");
  });

  it("failures pause: fresh stays paused, past TTL resumes", () => {
    const fresh = { kind: "failures", reason: "r", at: atHoursAgo(23) };
    const stale = { kind: "failures", reason: "r", at: atHoursAgo(25) };
    expect(resolveAutoResume(fresh, { now: NOW }).resume).toBe(false);
    expect(resolveAutoResume(stale, { now: NOW }).resume).toBe(true);
  });

  it("failures pause resumes immediately when the plugin version changed", () => {
    const fresh = { kind: "failures", reason: "r", at: atHoursAgo(1), pluginVersion: "0.9.0" };
    const decision = resolveAutoResume(fresh, { now: NOW, currentVersion: "0.9.6" });
    expect(decision.resume).toBe(true);
    expect(decision.why).toBe("plugin-updated");
  });

  it("version match or missing version falls back to TTL", () => {
    const same = { kind: "failures", reason: "r", at: atHoursAgo(1), pluginVersion: "0.9.6" };
    const noVersion = { kind: "failures", reason: "r", at: atHoursAgo(1) };
    expect(resolveAutoResume(same, { now: NOW, currentVersion: "0.9.6" }).resume).toBe(false);
    expect(resolveAutoResume(noVersion, { now: NOW, currentVersion: "0.9.6" }).resume).toBe(false);
    // quota pauses ignore the version shortcut entirely (quota is time-bound, not code-bound)
    const quota = { kind: "quota", reason: "r", at: atHoursAgo(1), pluginVersion: "0.9.0" };
    expect(resolveAutoResume(quota, { now: NOW, currentVersion: "0.9.6" }).resume).toBe(false);
  });

  it("unparseable `at` is liveness-biased (resumes)", () => {
    expect(resolveAutoResume({ kind: "failures", reason: "r", at: "garbage" }, { now: NOW }).resume).toBe(true);
    expect(resolveAutoResume({ kind: "quota", reason: "r" }, { now: NOW }).resume).toBe(true);
  });

  it("TTL overrides are honored (env-configurable knobs)", () => {
    const p = { kind: "quota", reason: "r", at: atHoursAgo(1) };
    expect(resolveAutoResume(p, { now: NOW, quotaTtlMs: 30 * 60_000 }).resume).toBe(true);
    const f = { kind: "failures", reason: "r", at: atHoursAgo(1) };
    expect(resolveAutoResume(f, { now: NOW, failuresTtlMs: 30 * 60_000 }).resume).toBe(true);
  });

  it("writeAutoPause stamps the running pluginVersion", () => {
    writeAutoPause(dir, { kind: "failures", reason: "r" });
    const body = JSON.parse(fs.readFileSync(pausePath(dir), "utf8"));
    const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8")) as { version: string };
    expect(body.pluginVersion).toBe(manifest.version);
    expect(readPluginVersion()).toBe(manifest.version);
  });

  it("clearAutoPause removes sentinel AND failure counter", () => {
    writeAutoPause(dir, { kind: "failures", reason: "r" });
    recordReviewFailure(dir, "x");
    recordReviewFailure(dir, "y");
    expect(clearAutoPause(dir)).toBe(true);
    expect(readPauseInfo(dir)).toBeNull();
    expect(readFailureCount(dir)).toBe(0);
    // idempotent on already-clear state
    expect(clearAutoPause(dir)).toBe(false);
  });

  it("clearAutoPause never removes a manual pause", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(pausePath(dir), ""); // manual pause
    expect(clearAutoPause(dir)).toBe(false);
    expect(clearAutoPause(dir, { kind: "failures", at: "2026-06-14T13:23:04.000Z" })).toBe(false);
    expect(fs.existsSync(pausePath(dir))).toBe(true);
  });

  it("clearAutoPause aborts when the sentinel changed since it was evaluated", () => {
    writeAutoPause(dir, { kind: "failures", reason: "old" });
    const evaluated = readPauseInfo(dir);
    // A different pause replaces the one the caller evaluated
    fs.writeFileSync(
      pausePath(dir),
      JSON.stringify({ v: 1, kind: "quota", reason: "new", at: new Date().toISOString() }),
    );
    expect(clearAutoPause(dir, evaluated)).toBe(false);
    expect(readPauseInfo(dir)?.kind).toBe("quota"); // untouched
    // Matching identity clears
    const current = readPauseInfo(dir);
    expect(clearAutoPause(dir, current)).toBe(true);
    expect(readPauseInfo(dir)).toBeNull();
  });
});

describe("codex-pair-session.mjs — SessionStart pause notice / auto-resume (runtime)", () => {
  const SESSION_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-session.mjs");
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-pause-"));
    fs.mkdirSync(path.join(dir, ".codex-pair"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".codex-pair", "context.md"), "# ctx");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function runSession(event: string) {
    return spawnSync("node", [SESSION_PATH], {
      input: JSON.stringify({ hook_event_name: event }),
      cwd: dir,
      encoding: "utf-8",
      timeout: 10_000,
    });
  }

  it("fresh auto-pause → paused reminder via SessionStart additionalContext", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(
      pausePath(dir),
      JSON.stringify({ v: 1, kind: "quota", reason: "usage limit", at: new Date().toISOString() }),
    );
    const result = runSession("SessionStart");
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/paused/i);
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/codex-pair-resume/);
    // sentinel untouched (not expired)
    expect(fs.existsSync(pausePath(dir))).toBe(true);
  });

  it("expired auto-pause → auto-resume at SessionStart (sentinel + failures cleared, notice emitted)", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(
      pausePath(dir),
      JSON.stringify({ v: 1, kind: "failures", reason: "3 consecutive failures", at: "2026-06-14T13:23:04.000Z" }),
    );
    fs.writeFileSync(failuresPath(dir), JSON.stringify({ v: 1, consecutive: 3 }));
    const result = runSession("SessionStart");
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/auto-resumed/i);
    expect(fs.existsSync(pausePath(dir))).toBe(false);
    expect(fs.existsSync(failuresPath(dir))).toBe(false);
    // auto_resumed is durable in the log
    const log = fs.readFileSync(path.join(dir, ".codex-pair", "log.jsonl"), "utf-8");
    expect(log).toMatch(/auto_resumed/);
  });

  it("manual pause → reminder only, never auto-resumed", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(pausePath(dir), "");
    const result = runSession("SessionStart");
    expect(result.status).toBe(0);
    const out = JSON.parse(result.stdout.trim());
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/paused/i);
    expect(fs.existsSync(pausePath(dir))).toBe(true);
  });

  it("no pause → no stdout emission (silent no-op preserved)", () => {
    const result = runSession("SessionStart");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });

  it("SessionEnd never emits a pause notice", () => {
    fs.mkdirSync(path.dirname(pausePath(dir)), { recursive: true });
    fs.writeFileSync(pausePath(dir), "");
    const result = runSession("SessionEnd");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});
