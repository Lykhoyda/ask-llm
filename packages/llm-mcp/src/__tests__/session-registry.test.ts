import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  clearSession,
  collectSessionMarkers,
  readRegisteredMarkers,
  registerMarker,
  sessionDir,
  sessionRegistryRoot,
  sweepStaleSessions,
} from "../../scripts/lib/session-registry.mjs";

// Point the registry root at a private fixture dir so the destructive TTL sweep
// tests never touch the shared os.tmpdir() root — which holds this dev machine's
// real codex-pair session state (and any parallel test run's fixtures).
let registryRoot: string;
let prevRoot: string | undefined;
beforeAll(() => {
  prevRoot = process.env.CODEX_PAIR_SESSION_REGISTRY_ROOT;
  registryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cp-registry-root-"));
  process.env.CODEX_PAIR_SESSION_REGISTRY_ROOT = registryRoot;
});
afterAll(() => {
  if (prevRoot === undefined) delete process.env.CODEX_PAIR_SESSION_REGISTRY_ROOT;
  else process.env.CODEX_PAIR_SESSION_REGISTRY_ROOT = prevRoot;
  fs.rmSync(registryRoot, { recursive: true, force: true });
});

// Unique session id per test keeps fixtures within the isolated root distinct.
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

  it("namespaces CODEX_PAIR_SESSION_REGISTRY_ROOT as a base dir, never the raw sweep root", () => {
    // The destructive TTL sweep rmSyncs stale child dirs, so the env var must be
    // treated as a BASE and suffixed with the dedicated subdir — otherwise
    // pointing it at /tmp or $HOME would let the sweep delete unrelated data.
    expect(sessionRegistryRoot()).toBe(path.join(registryRoot, "codex-pair-sessions"));
    expect(path.basename(sessionRegistryRoot())).toBe("codex-pair-sessions");
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

  it("writes entries atomically — no lingering .tmp, entry is valid JSON", () => {
    const s = track(sid());
    registerMarker(s, "/repo/atomic");
    const files = fs.readdirSync(sessionDir(s));
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
    expect(files.some((f) => f.includes(".tmp"))).toBe(false);
    const entry = JSON.parse(fs.readFileSync(path.join(sessionDir(s), files[0]), "utf8"));
    expect(entry.markerDir).toBe("/repo/atomic");
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
    // must fall back to the 7-day default. Re-import fresh so the module-level
    // const re-evaluates against the overridden env.
    const prev = process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS;
    process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS = "not-a-number";
    try {
      vi.resetModules();
      const mod = await import("../../scripts/lib/session-registry.mjs");
      expect(Number.isFinite(mod.SESSION_REGISTRY_TTL_MS)).toBe(true);
      expect(mod.SESSION_REGISTRY_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    } finally {
      if (prev === undefined) delete process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS;
      else process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS = prev;
      vi.resetModules();
    }
  });
});
