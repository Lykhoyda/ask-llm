import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
});
