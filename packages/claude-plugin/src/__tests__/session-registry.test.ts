import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  collectSessionMarkers,
  readRegisteredMarkers,
  registerMarker,
  sessionDir,
  sweepStaleSessions,
} from "../../scripts/lib/session-registry.mjs";

// Unique session id per test keeps the shared os.tmpdir() registry isolated.
let counter = 0;
const sid = () => `cp-test-session-${process.pid}-${counter++}`;
const sessions: string[] = [];
const track = (s: string) => {
  sessions.push(s);
  return s;
};

afterEach(() => {
  for (const s of sessions.splice(0)) clearSession(s);
});

describe("session-registry", () => {
  it("register → read round-trips a markerDir", () => {
    const s = track(sid());
    registerMarker(s, "/repo/a");
    expect(readRegisteredMarkers(s)).toEqual(["/repo/a"]);
  });

  it("is idempotent and dedupes across repeat + multi registrations", () => {
    const s = track(sid());
    registerMarker(s, "/repo/a");
    registerMarker(s, "/repo/a");
    registerMarker(s, "/repo/b");
    expect(readRegisteredMarkers(s).sort()).toEqual(["/repo/a", "/repo/b"]);
  });

  it("falsy sessionId is a no-op on write and returns [] on read", () => {
    registerMarker("", "/repo/a");
    expect(readRegisteredMarkers("")).toEqual([]);
    expect(readRegisteredMarkers(undefined as unknown as string)).toEqual([]);
  });

  it("falsy markerDir does not register", () => {
    const s = track(sid());
    registerMarker(s, "");
    expect(readRegisteredMarkers(s)).toEqual([]);
  });

  it("tolerates a malformed entry file", () => {
    const s = track(sid());
    registerMarker(s, "/repo/a");
    fs.writeFileSync(path.join(sessionDir(s), "junk.json"), "{not json");
    expect(readRegisteredMarkers(s)).toEqual(["/repo/a"]);
  });

  it("collectSessionMarkers unions the cwd marker with registered, deduped", () => {
    const s = track(sid());
    registerMarker(s, "/repo/b");
    expect(collectSessionMarkers("/repo/a", s).sort()).toEqual(["/repo/a", "/repo/b"]);
    // cwd marker already registered → no duplicate
    registerMarker(s, "/repo/a");
    expect(collectSessionMarkers("/repo/a", s).sort()).toEqual(["/repo/a", "/repo/b"]);
    // null cwd marker → registered only
    expect(collectSessionMarkers(null, s).sort()).toEqual(["/repo/a", "/repo/b"]);
  });

  it("clearSession removes the whole entry", () => {
    const s = track(sid());
    registerMarker(s, "/repo/a");
    clearSession(s);
    expect(readRegisteredMarkers(s)).toEqual([]);
  });

  it("sweepStaleSessions drops only dirs older than ttl", () => {
    const fresh = track(sid());
    const stale = track(sid());
    registerMarker(fresh, "/repo/fresh");
    registerMarker(stale, "/repo/stale");
    // Backdate the stale session's entry mtimes by 48h.
    const old = Date.now() - 48 * 3600 * 1000;
    for (const f of fs.readdirSync(sessionDir(stale))) {
      const p = path.join(sessionDir(stale), f);
      fs.utimesSync(p, new Date(old), new Date(old));
    }
    sweepStaleSessions(Date.now(), 24 * 3600 * 1000);
    expect(readRegisteredMarkers(fresh)).toEqual(["/repo/fresh"]);
    expect(fs.existsSync(sessionDir(stale))).toBe(false);
  });

  it("sweepStaleSessions never deletes the exceptSessionId (live-session guard)", () => {
    const live = track(sid());
    registerMarker(live, "/repo/live");
    // Backdate its entries past the TTL — it would be swept if not excepted.
    const old = Date.now() - 48 * 3600 * 1000;
    for (const f of fs.readdirSync(sessionDir(live))) {
      const p = path.join(sessionDir(live), f);
      fs.utimesSync(p, new Date(old), new Date(old));
    }
    sweepStaleSessions(Date.now(), 24 * 3600 * 1000, live);
    expect(readRegisteredMarkers(live)).toEqual(["/repo/live"]);
  });

  it("does not sweep a freshly-created empty session dir (mid-registration race)", () => {
    // Simulate the window between registerMarker's mkdirSync and its writeFileSync:
    // the dir exists but has no entry yet. A concurrent sweep must NOT delete it,
    // or the pending write would ENOENT and the marker would be lost.
    const s = track(sid());
    fs.mkdirSync(sessionDir(s), { recursive: true });
    sweepStaleSessions(Date.now(), 24 * 3600 * 1000);
    expect(fs.existsSync(sessionDir(s))).toBe(true);
  });

  it("falls back to the default TTL when the env override is non-numeric", async () => {
    // A non-numeric override → Number(...) is NaN, which would silently disable
    // the sweep (newest < now-NaN is always false). The Number.isFinite guard
    // must fall back to the 24h default. Re-import fresh so the module-level
    // const re-evaluates against the overridden env.
    const prev = process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS;
    process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS = "not-a-number";
    try {
      vi.resetModules();
      const mod = await import("../../scripts/lib/session-registry.mjs");
      expect(Number.isFinite(mod.SESSION_REGISTRY_TTL_MS)).toBe(true);
      expect(mod.SESSION_REGISTRY_TTL_MS).toBe(24 * 60 * 60 * 1000);
    } finally {
      if (prev === undefined) delete process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS;
      else process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS = prev;
      vi.resetModules();
    }
  });
});
