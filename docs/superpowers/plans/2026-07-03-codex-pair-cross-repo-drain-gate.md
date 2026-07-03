# codex-pair cross-repo Stop drain + gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the codex-pair Stop drain, `blockOn:HIGH` gate, and UserPromptSubmit drain act on every repo touched this session — not just Claude Code's cwd repo (issue #209).

**Architecture:** A session-scoped marker registry under `os.tmpdir()`, keyed by `session_id`. The watch hook (which knows both `session_id` and the edited repo's `markerDir`) records each active project; the Stop and prompt hooks read the set back and drain/gate every registered marker unioned with the cwd marker. One file per `(session, project)` pair → registration is a single idempotent write, so parallel watch fires never race (mirrors the per-file sharding of `inflight/`, ADR-087).

**Tech Stack:** Node ESM `.mjs` hook scripts (no build step, marketplace git-subdir install), Vitest integration tests that `spawnSync` the scripts, Changesets, Biome.

## Global Constraints

- **Zero workspace imports** in `scripts/**` — marketplace installs have no `node_modules`; only Node built-ins and sibling `./lib/*.mjs` relative imports.
- **Every hook exits 0 on every path** (ADR-077). Registry helpers are best-effort and **must never throw**.
- **Atomic / race-tolerant state** — single writes, tolerant reads (missing/malformed → empty), mirroring `lib/state.mjs` and `lib/debounce-state.mjs`.
- **No behavior change on the single-repo happy path**, and **no `session_id` → identical to today's cwd-only behavior**.
- Test files are `.ts` under `src/__tests__/`, use **explicit type imports**, and are excluded from `tsc --noEmit`.
- Keep comments purposeful and matched to the surrounding (heavily-annotated) hook style; no gratuitous comments.
- Run tests with `yarn workspace @ask-llm/plugin run test`.

---

### Task 1: `session-registry.mjs` module + unit tests

**Files:**
- Create: `packages/claude-plugin/scripts/lib/session-registry.mjs`
- Test: `packages/claude-plugin/src/__tests__/session-registry.test.ts`

**Interfaces:**
- Produces:
  - `registerMarker(sessionId: string, markerDir: string): void` — idempotent best-effort write; no-op on falsy args.
  - `readRegisteredMarkers(sessionId: string): string[]` — deduped markerDirs; `[]` on falsy/missing; probabilistic TTL sweep.
  - `collectSessionMarkers(cwdMarker: string | null, sessionId: string): string[]` — union of `cwdMarker` (if truthy) with registered markers, deduped.
  - `clearSession(sessionId: string): void` — remove the session's registry dir.
  - `sweepStaleSessions(now: number, ttlMs: number, exceptSessionId?: string): void` — drop session dirs whose newest entry mtime < `now - ttlMs`, skipping `exceptSessionId`.
  - `sessionRegistryRoot(): string`, `sessionDir(sessionId: string): string`.

- [ ] **Step 1: Write the failing test**

Create `packages/claude-plugin/src/__tests__/session-registry.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test session-registry`
Expected: FAIL — cannot resolve `../../scripts/lib/session-registry.mjs`.

- [ ] **Step 3: Write the module**

Create `packages/claude-plugin/scripts/lib/session-registry.mjs`:

```js
// Session-scoped marker registry (ADR-131, issue #209).
//
// The watch hook (PostToolUse) knows both the session_id and the EDITED repo's
// markerDir; the Stop / UserPromptSubmit hooks know only session_id + cwd. This
// registry bridges them: the watch hook records every project marker it touches
// this session, and the turn/prompt-scoped hooks read the set back so they drain
// + gate every repo active this session, not just cwd.
//
// Storage: <tmpdir>/codex-pair-sessions/<sha256(session)[:16]>/<sha256(marker)[:16]>.json
// One independent file per (session, project) — registration is a single
// idempotent write, so parallel watch fires for DIFFERENT repos never race
// (mirrors the per-file sharding of inflight/ and pending/, ADR-087/097).
//
// Zero workspace imports (marketplace git-subdir install has no node_modules).
// Every export is best-effort and MUST NOT throw (ADR-077).

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SESSION_REGISTRY_DIRNAME = "codex-pair-sessions";
export const SESSION_REGISTRY_TTL_MS = Number(
  process.env.CODEX_PAIR_SESSION_REGISTRY_TTL_MS ?? 24 * 60 * 60 * 1000,
);

export const sessionRegistryRoot = () => join(tmpdir(), SESSION_REGISTRY_DIRNAME);

function hash16(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
}

export const sessionDir = (sessionId) => join(sessionRegistryRoot(), hash16(sessionId));

const markerEntryPath = (sessionId, markerDir) =>
  join(sessionDir(sessionId), `${hash16(markerDir)}.json`);

// Record that `markerDir` saw activity in `sessionId`. Idempotent, best-effort.
// No-op when either argument is falsy (e.g. payload lacked session_id).
export function registerMarker(sessionId, markerDir) {
  if (!sessionId || !markerDir) return;
  try {
    mkdirSync(sessionDir(sessionId), { recursive: true });
    // Overwrite is fine (idempotent) — a single write, no read-modify-write,
    // so concurrent registrations of DIFFERENT repos never clobber each other.
    writeFileSync(
      markerEntryPath(sessionId, markerDir),
      JSON.stringify({ markerDir, at: new Date().toISOString() }),
    );
  } catch {
    // best-effort (ADR-077) — a registry write failure must never affect review
  }
}

// Deduped set of markerDirs registered for `sessionId`. Tolerant of missing dir
// / malformed entries. Returns [] when sessionId is falsy. Runs a probabilistic
// TTL sweep (~5%) so a crash that skipped SessionEnd can't leak dirs forever.
export function readRegisteredMarkers(sessionId) {
  if (!sessionId) return [];
  const dir = sessionDir(sessionId);
  const markers = new Set();
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const { markerDir } = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (typeof markerDir === "string" && markerDir.length > 0) markers.add(markerDir);
    } catch {
      // skip malformed / vanished entry
    }
  }
  // Pass sessionId as exceptSessionId so a read NEVER sweeps its own live session
  // (a session idle >TTL since its last edit would otherwise erase its registry
  // mid-session and silently fall back to cwd-only — reopening the #209 gap).
  if (Math.random() < 0.05) sweepStaleSessions(Date.now(), SESSION_REGISTRY_TTL_MS, sessionId);
  return [...markers];
}

// The one place both drain hooks agree on "which markers to act on this turn":
// the cwd-resolved marker (may be null) unioned with the session-registered set.
export function collectSessionMarkers(cwdMarker, sessionId) {
  const set = new Set();
  if (cwdMarker) set.add(cwdMarker);
  for (const m of readRegisteredMarkers(sessionId)) set.add(m);
  return [...set];
}

// Drop the whole registry entry for a session (SessionEnd). Best-effort.
export function clearSession(sessionId) {
  if (!sessionId) return;
  try {
    rmSync(sessionDir(sessionId), { recursive: true, force: true });
  } catch {
    // already gone
  }
}

// Drop session dirs whose NEWEST entry mtime is older than ttlMs — a backstop
// for sessions whose SessionEnd never fired (crash). Skips `exceptSessionId` so a
// live session's own read can never sweep it. Best-effort; never throws.
export function sweepStaleSessions(now, ttlMs, exceptSessionId) {
  const skip = exceptSessionId ? hash16(exceptSessionId) : null;
  let sessions;
  try {
    sessions = readdirSync(sessionRegistryRoot());
  } catch {
    return;
  }
  const cutoff = now - ttlMs;
  for (const s of sessions) {
    if (s === skip) continue; // never sweep the live session that's reading us
    const sdir = join(sessionRegistryRoot(), s);
    try {
      let newest = 0;
      for (const name of readdirSync(sdir)) {
        try {
          newest = Math.max(newest, statSync(join(sdir, name)).mtimeMs);
        } catch {
          // entry vanished between readdir and stat
        }
      }
      if (newest < cutoff) rmSync(sdir, { recursive: true, force: true });
    } catch {
      // skip unreadable / racing session dir
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test session-registry`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/lib/session-registry.mjs packages/claude-plugin/src/__tests__/session-registry.test.ts
git commit -m "feat(codex-pair): session-scoped marker registry (#209, ADR-131)"
```

---

### Task 2: Watch hook registers each edited repo's marker

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-watch.mjs` (import block near line 87; `main()` near line 1001)
- Test: `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts`

**Interfaces:**
- Consumes: `registerMarker` from Task 1.

- [ ] **Step 1: Write the failing test**

Append to `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts` (inside the file's top-level; mirror the existing imports — it already imports `spawnSync`, `fs`, `os`, `path`, `PLUGIN_ROOT`). If those imports are absent, add them. Add:

```ts
import {
  clearSession,
  readRegisteredMarkers,
} from "../../scripts/lib/session-registry.mjs";

describe("codex-pair-watch.mjs — session registry (#209)", () => {
  const WATCH_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-watch.mjs");
  let repo: string;
  const SESSION = `cp-watch-reg-${process.pid}`;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-watch-reg-"));
    fs.mkdirSync(path.join(repo, ".codex-pair"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), "# ctx");
  });
  afterEach(() => {
    clearSession(SESSION);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("registers the edited repo's marker under the payload session_id (skipped file → no codex call)", () => {
    // A .png hits SKIP_PATTERNS, so the hook registers the marker and exits 0
    // BEFORE any codex spawn — registration sits above the skip gate.
    const res = spawnSync("node", [WATCH_PATH], {
      input: JSON.stringify({
        tool_name: "Edit",
        tool_input: { file_path: path.join(repo, "logo.png") },
        session_id: SESSION,
      }),
      cwd: repo,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(0);
    expect(readRegisteredMarkers(SESSION)).toContain(fs.realpathSync(repo));
  });
});
```

Note: the temp repo path may be a symlink on macOS (`/var` → `/private/var`); the hook registers the raw `markerDir` returned by `findMarkerUp(dirname(filePath))`, which resolves from the absolute `file_path`. Assert with `fs.realpathSync(repo)` only if the hook canonicalizes; it does NOT — it registers the raw dir. Use the raw value the hook sees:

```ts
    expect(readRegisteredMarkers(SESSION)).toContain(repo);
```

Replace the `realpathSync` assertion above with this raw-`repo` assertion. (macOS `mkdtempSync` under `os.tmpdir()` returns a `/var/...` path; `dirname(file_path)` preserves it, so raw `repo` matches.)

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-watch`
Expected: FAIL — `readRegisteredMarkers(SESSION)` is `[]` (no registration yet).

- [ ] **Step 3: Add the import**

In `packages/claude-plugin/scripts/codex-pair-watch.mjs`, after the `./lib/state.mjs` import block (ends ~line 87), add:

```js
import { registerMarker } from "./lib/session-registry.mjs";
```

- [ ] **Step 4: Register the marker in `main()`**

In `main()`, find (near line 1000):

```js
  markerAnchor = dirname(filePath);
  const markerDir = await findMarkerUp(markerAnchor);
  if (!markerDir) process.exit(0);
```

Insert immediately after the `if (!markerDir) process.exit(0);` line:

```js
  // ADR-131 (#209): record this repo as active in this session so the
  // cwd-anchored Stop/UserPromptSubmit drains + blockOn:HIGH gate can see it at
  // turn-end even when Claude Code's cwd is a DIFFERENT repo. Placed above the
  // skip/ignore gates so a repo with earlier HIGH findings still registers even
  // when this particular edit is skipped. Best-effort; must not affect review.
  registerMarker(payload?.session_id, markerDir);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-watch`
Expected: PASS (existing watch tests + the new registration test).

- [ ] **Step 6: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-watch.mjs packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts
git commit -m "feat(codex-pair): watch hook registers edited repo in session registry (#209)"
```

---

### Task 3: Prompt drain across every registered marker

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-prompt-drain.mjs` (imports ~line 17; `main()` ~lines 59-63)
- Test: `packages/claude-plugin/src/__tests__/codex-pair-prompt-drain.test.ts`

**Interfaces:**
- Consumes: `collectSessionMarkers` from Task 1.

- [ ] **Step 1: Write the failing test**

Append to `packages/claude-plugin/src/__tests__/codex-pair-prompt-drain.test.ts` a new describe block (the file already imports `spawnSync`, `fs`, `os`, `path`, `PLUGIN_ROOT`, `readFile`):

```ts
import {
  clearSession,
  registerMarker,
} from "../../scripts/lib/session-registry.mjs";

describe("codex-pair-prompt-drain.mjs — cross-repo (#209)", () => {
  const DRAIN = path.join(PLUGIN_ROOT, "scripts", "codex-pair-prompt-drain.mjs");
  let cwdRepo: string;
  let otherRepo: string;
  const SESSION = `cp-drain-xrepo-${process.pid}`;

  beforeEach(() => {
    cwdRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-drain-cwd-"));
    otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-drain-other-"));
    for (const r of [cwdRepo, otherRepo]) {
      fs.mkdirSync(path.join(r, ".codex-pair/state/pending"), { recursive: true });
      fs.writeFileSync(path.join(r, ".codex-pair/context.md"), "# ctx");
    }
  });
  afterEach(() => {
    clearSession(SESSION);
    fs.rmSync(cwdRepo, { recursive: true, force: true });
    fs.rmSync(otherRepo, { recursive: true, force: true });
  });

  it("drains a pending verdict from a registered non-cwd repo", () => {
    registerMarker(SESSION, otherRepo);
    fs.writeFileSync(
      path.join(otherRepo, ".codex-pair/state/pending", "seed.json"),
      JSON.stringify({ file: path.join(otherRepo, "z.ts"), message: "[codex-pair] reviewed z.ts — 1H/0M/0L" }),
    );
    const res = spawnSync("node", [DRAIN], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hi", session_id: SESSION }),
      cwd: cwdRepo,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/additionalContext/);
    expect(res.stdout).toMatch(/reviewed z\.ts/);
    expect(
      fs.readdirSync(path.join(otherRepo, ".codex-pair/state/pending")).filter((f) => f.endsWith(".json")),
    ).toEqual([]);
  });

  it("no session_id → cwd-only behavior unchanged (other repo untouched)", () => {
    registerMarker(SESSION, otherRepo);
    fs.writeFileSync(
      path.join(otherRepo, ".codex-pair/state/pending", "seed.json"),
      JSON.stringify({ file: path.join(otherRepo, "z.ts"), message: "[codex-pair] reviewed z.ts" }),
    );
    const res = spawnSync("node", [DRAIN], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hi" }), // no session_id
      cwd: cwdRepo,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(0);
    expect(res.stdout).not.toMatch(/additionalContext/);
    // other repo's pending is left intact because it was never drained
    expect(
      fs.readdirSync(path.join(otherRepo, ".codex-pair/state/pending")).filter((f) => f.endsWith(".json")),
    ).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-prompt-drain`
Expected: FAIL on the first new test — cwd repo has no pending, so today's code drains nothing and emits no `additionalContext`.

- [ ] **Step 3: Add the import**

In `packages/claude-plugin/scripts/codex-pair-prompt-drain.mjs`, after the debounce-state import (line 17), add:

```js
import { collectSessionMarkers } from "./lib/session-registry.mjs";
```

- [ ] **Step 4: Union the markers in `main()`**

Replace (lines ~59-63):

```js
  const markerDir = await findMarkerUp(process.cwd());
  if (!markerDir) process.exit(0);

  const messages = drainPending(markerDir);
  if (messages.length === 0) process.exit(0);
```

with:

```js
  // ADR-131 (#209): drain EVERY repo active this session, not just cwd's. The
  // watch hook registers each edited repo under session_id; union it with the
  // cwd marker so single-repo behavior is unchanged when no session_id is present.
  const cwdMarker = await findMarkerUp(process.cwd());
  const markers = collectSessionMarkers(cwdMarker, payload?.session_id);
  if (markers.length === 0) process.exit(0);

  const messages = markers.flatMap((m) => drainPending(m));
  if (messages.length === 0) process.exit(0);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-prompt-drain`
Expected: PASS (structural + original runtime + 2 new cross-repo tests).

- [ ] **Step 6: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-prompt-drain.mjs packages/claude-plugin/src/__tests__/codex-pair-prompt-drain.test.ts
git commit -m "feat(codex-pair): prompt drain covers every registered repo (#209)"
```

---

### Task 4: Stop gate — evaluate every registered marker

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-stop-gate.mjs` (imports ~line 30; extract `evaluateMarker`; rewrite `main()` ~lines 161-245)
- Test: `packages/claude-plugin/src/__tests__/stop-gate.test.ts`

**Interfaces:**
- Consumes: `collectSessionMarkers` from Task 1; existing `drainPending`, `joinPendingForSurface`, `readBlockOn`, `collectInFlight`, `collectBlockingHighs`, `formatBlockMessage`, `formatInFlightMessage`, the module-local `readInFlightInputs`, `inflightFreshMs`, `gitDirtySet`, `canonicalizeEntries`, `findMarkerUp`, `writeAndExit`.
- Produces (module-local): `evaluateMarker(markerDir: string): { pendingText: string | null, blockReason: string | null }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/claude-plugin/src/__tests__/stop-gate.test.ts`, inside the runtime describe block (or a new sibling describe that recreates the `GATE_PATH`/`dir` scaffolding). Add a cross-repo block:

```ts
import { clearSession, registerMarker } from "../../scripts/lib/session-registry.mjs";

describe("codex-pair-stop-gate.mjs — cross-repo (#209)", () => {
  const GATE_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-stop-gate.mjs");
  let cwdRepo: string;
  let otherRepo: string;
  const SESSION = `cp-gate-xrepo-${process.pid}`;

  beforeEach(() => {
    cwdRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-gate-cwd-"));
    otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-gate-other-"));
    for (const r of [cwdRepo, otherRepo]) fs.mkdirSync(path.join(r, ".codex-pair"), { recursive: true });
    // cwd repo has a marker but no findings.
    fs.writeFileSync(path.join(cwdRepo, ".codex-pair", "context.md"), "# ctx");
  });
  afterEach(() => {
    clearSession(SESSION);
    fs.rmSync(cwdRepo, { recursive: true, force: true });
    fs.rmSync(otherRepo, { recursive: true, force: true });
  });

  function run(session?: string) {
    return spawnSync("node", [GATE_PATH], {
      input: JSON.stringify({ hook_event_name: "Stop", ...(session ? { session_id: session } : {}) }),
      cwd: cwdRepo,
      encoding: "utf-8",
      timeout: 10_000,
    });
  }

  it("drains a registered non-cwd repo's pending verdict via additionalContext", () => {
    fs.writeFileSync(path.join(otherRepo, ".codex-pair", "context.md"), "# ctx"); // no blockOn
    const pend = path.join(otherRepo, ".codex-pair", "state", "pending");
    fs.mkdirSync(pend, { recursive: true });
    fs.writeFileSync(path.join(pend, "seed.json"), JSON.stringify({ file: "/x", message: "[codex-pair] reviewed q.ts — 1H/0M/0L" }));
    registerMarker(SESSION, otherRepo);

    const res = run(SESSION);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.trim());
    expect(out.decision).toBeUndefined();
    expect(out.hookSpecificOutput?.additionalContext).toMatch(/reviewed q\.ts/);
    expect(fs.readdirSync(pend).filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  it("blocks turn-end on an unaddressed HIGH in a registered non-cwd repo", () => {
    // otherRepo opts into blockOn:HIGH, has a real file + a HIGH log entry + is git-free.
    fs.writeFileSync(path.join(otherRepo, ".codex-pair", "context.md"), "---\nblockOn: HIGH\n---\n# ctx");
    const target = path.join(otherRepo, "auth.ts");
    fs.writeFileSync(target, "export const x = 1;\n");
    fs.writeFileSync(
      path.join(otherRepo, ".codex-pair", "log.jsonl"),
      `${JSON.stringify({ file: target, verdict: "concerns", concerns: { high: ["missing await on mutation"] } })}\n`,
    );
    registerMarker(SESSION, otherRepo);

    const res = run(SESSION);
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout.trim());
    expect(out.decision).toBe("block");
    expect(out.reason).toMatch(/unaddressed HIGH/);
    expect(out.reason).toMatch(/auth\.ts/);
  });

  it("without session_id, the non-cwd HIGH does NOT block (cwd-only fallback)", () => {
    fs.writeFileSync(path.join(otherRepo, ".codex-pair", "context.md"), "---\nblockOn: HIGH\n---\n# ctx");
    const target = path.join(otherRepo, "auth.ts");
    fs.writeFileSync(target, "export const x = 1;\n");
    fs.writeFileSync(
      path.join(otherRepo, ".codex-pair", "log.jsonl"),
      `${JSON.stringify({ file: target, verdict: "concerns", concerns: { high: ["missing await"] } })}\n`,
    );
    registerMarker(SESSION, otherRepo);

    const res = run(); // no session_id
    expect(res.status).toBe(0);
    // cwd repo has no blockOn + nothing pending → silent exit, no block
    expect(res.stdout.trim()).toBe("");
  });
});
```

Note on the block test: `collectBlockingHighs` drops files clean vs HEAD only when `gitDirtySet` returns a Set. `otherRepo` is not a git repo, so `gitDirtySet` returns `null` and the `[B]` filter is skipped — the HIGH blocks purely on the existing file + log entry. That is the intended non-git path.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: FAIL — the first two new tests get a silent exit (`""`) because today's gate only sees the empty cwd repo.

- [ ] **Step 3: Add the import**

In `packages/claude-plugin/scripts/codex-pair-stop-gate.mjs`, after the `./lib/stop-gate.mjs` import block (ends ~line 30), add:

```js
import { collectSessionMarkers } from "./lib/session-registry.mjs";
```

- [ ] **Step 4: Extract `evaluateMarker` and rewrite `main()`**

Replace the entire `async function main() { ... }` body (lines ~161-245) with the following two functions. `evaluateMarker` is the per-marker distillation of today's inline flow; `main()` fans out over the union of markers.

```js
// Evaluate one project marker: drain its pending verdicts and, if it opted into
// blockOn:HIGH, compute whether it wants to block (unaddressed HIGH and/or an
// in-flight review). Returns marker-scoped text; aggregation happens in main().
// Reads in-flight state from the RAW markerDir (matches where the watch hook
// writes it); canonicalizes only for git/log path alignment (macOS /var).
function evaluateMarker(markerDir) {
  const pending = drainPending(markerDir);
  const pendingText = pending.length > 0 ? joinPendingForSurface(pending) : null;

  if (readBlockOn(markerDir) !== "HIGH") {
    return { pendingText, blockReason: null };
  }

  const inFlight = collectInFlight({
    ...readInFlightInputs(markerDir),
    now: Date.now(),
    freshMs: inflightFreshMs(markerDir),
  });

  let canonical = markerDir;
  try {
    canonical = realpathSync(markerDir);
  } catch {
    // keep raw on the rare realpath failure
  }

  let logText = "";
  try {
    logText = readFileSync(logPath(canonical), "utf8");
  } catch {
    // no log yet — an in-flight first-ever review can still block below
  }

  const blocking = collectBlockingHighs({
    entries: canonicalizeEntries(selectLatestEntries(logText)),
    acks: readAcks(canonical),
    existsFn: existsSync,
    gitDirty: gitDirtySet(canonical),
    markerDir: canonical,
  });

  let blockReason = null;
  if (blocking.length > 0) {
    blockReason = formatBlockMessage(blocking, canonical);
    if (inFlight.any) blockReason = `${formatInFlightMessage(inFlight, canonical)}\n\n${blockReason}`;
  } else if (inFlight.any) {
    blockReason = formatInFlightMessage(inFlight, canonical);
  }
  return { pendingText, blockReason };
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (payload?.hook_event_name !== "Stop") process.exit(0);
  if (payload?.stop_hook_active) process.exit(0);

  // ADR-131 (#209): evaluate EVERY repo active this session, not just cwd. The
  // cwd marker may even be null (cwd repo has no .codex-pair) while edits landed
  // in a registered sibling repo — so we no longer early-exit on a missing cwd
  // marker; collectSessionMarkers unions cwd (if any) with the registered set.
  const cwdMarker = findMarkerUp(process.cwd());
  const markers = collectSessionMarkers(cwdMarker, payload?.session_id);
  if (markers.length === 0) process.exit(0);

  const pendingTexts = [];
  const blockReasons = [];
  for (const markerDir of markers) {
    const { pendingText, blockReason } = evaluateMarker(markerDir);
    if (pendingText) pendingTexts.push(pendingText);
    if (blockReason) blockReasons.push(blockReason);
  }
  const pendingCombined = pendingTexts.length > 0 ? pendingTexts.join("\n\n") : null;

  if (blockReasons.length > 0) {
    let reason = blockReasons.join("\n\n");
    if (pendingCombined) reason = `${pendingCombined}\n\n${reason}`;
    writeAndExit({ decision: "block", reason });
    return;
  }

  if (pendingCombined) {
    writeAndExit({
      hookSpecificOutput: { hookEventName: "Stop", additionalContext: pendingCombined },
    });
    return;
  }

  process.exit(0);
}
```

Leave the module's helper functions (`findMarkerUp`, `readInFlightInputs`, `inflightFreshMs`, `gitDirtySet`, `canonicalizeEntries`, `writeAndExit`, `readBlockOn`, `readMarkerScalar`) and the `main().catch(...)` fail-open handler unchanged.

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: PASS — all prior single-repo runtime tests plus the 3 new cross-repo tests. (The single-repo tests still pass because `collectSessionMarkers(cwdMarker, undefined)` returns `[cwdMarker]`, so a Stop with no `session_id` behaves exactly as before.)

- [ ] **Step 6: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-stop-gate.mjs packages/claude-plugin/src/__tests__/stop-gate.test.ts
git commit -m "feat(codex-pair): Stop gate evaluates every registered repo (#209)"
```

---

### Task 5: SessionEnd clears the session registry

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-session.mjs` (imports ~line 24; SessionEnd branch ~lines 158-167)
- Test: `packages/claude-plugin/src/__tests__/codex-pair-session.test.ts` (create if absent)

**Interfaces:**
- Consumes: `clearSession`, `registerMarker`, `readRegisteredMarkers` from Task 1.

- [ ] **Step 1: Write the failing test**

Create or append `packages/claude-plugin/src/__tests__/codex-pair-session.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLUGIN_ROOT } from "./_helpers.js";
import {
  clearSession,
  readRegisteredMarkers,
  registerMarker,
} from "../../scripts/lib/session-registry.mjs";

describe("codex-pair-session.mjs — SessionEnd clears registry (#209)", () => {
  const SESSION_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-session.mjs");
  let repo: string;
  const SESSION = `cp-session-clear-${process.pid}`;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "cp-session-"));
    fs.mkdirSync(path.join(repo, ".codex-pair"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), "# ctx");
  });
  afterEach(() => {
    clearSession(SESSION);
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("removes the session's registered markers on SessionEnd", () => {
    registerMarker(SESSION, repo);
    expect(readRegisteredMarkers(SESSION)).toContain(repo);

    const res = spawnSync("node", [SESSION_PATH], {
      input: JSON.stringify({ hook_event_name: "SessionEnd", session_id: SESSION }),
      cwd: repo,
      encoding: "utf-8",
      timeout: 10_000,
    });
    expect(res.status).toBe(0);
    expect(readRegisteredMarkers(SESSION)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-session`
Expected: FAIL — after SessionEnd, `readRegisteredMarkers(SESSION)` still contains `repo`.

- [ ] **Step 3: Add the import**

In `packages/claude-plugin/scripts/codex-pair-session.mjs`, after the `./lib/state.mjs` import block (ends ~line 24), add:

```js
import { clearSession } from "./lib/session-registry.mjs";
```

- [ ] **Step 4: Clear the registry in the SessionEnd branch**

Find (lines ~158-167):

```js
  if (event === "SessionEnd") {
    const dbMarkerDir = await findMarkerUp(process.cwd());
    if (dbMarkerDir) {
      try {
        clearAllDebounceState(dbMarkerDir);
      } catch {
        // best-effort (ADR-077)
      }
    }
  }
```

Replace with:

```js
  if (event === "SessionEnd") {
    const dbMarkerDir = await findMarkerUp(process.cwd());
    if (dbMarkerDir) {
      try {
        clearAllDebounceState(dbMarkerDir);
      } catch {
        // best-effort (ADR-077)
      }
    }
    // ADR-131 (#209): drop this session's cross-repo marker registry. Keyed by
    // session_id, not cwd — so it cleans up regardless of which repo cwd is.
    try {
      clearSession(payload?.session_id);
    } catch {
      // best-effort (ADR-077)
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-session`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-session.mjs packages/claude-plugin/src/__tests__/codex-pair-session.test.ts
git commit -m "feat(codex-pair): clear session registry on SessionEnd (#209)"
```

---

### Task 6: Rollout artifacts (ADR-131, changeset, docs, full gate)

**Files:**
- Modify: `docs/DECISIONS.md` (append ADR-131)
- Create: `.changeset/codex-pair-cross-repo-drain-gate.md`
- Modify: `docs/ROADMAP.md` (run-log entry), `docs/BUGS.md` (mark #209 fixed with deferred-scope note)

- [ ] **Step 1: Append ADR-131 to `docs/DECISIONS.md`**

Add a new section (match the file's existing ADR heading style):

```markdown
## ADR-131: codex-pair cross-repo Stop drain + gate via a session-scoped marker registry

**Status:** Accepted — 2026-07-03 · **Issue:** #209 · **Extends:** ADR-130 (seamless-pairing Stop drain), ADR-118 (blockOn:HIGH gate)

**Context:** Stop, UserPromptSubmit, SessionStart, and SessionEnd hook events carry no file paths, so the Stop drain, `blockOn:HIGH` gate, and prompt drain all resolve their project marker from `process.cwd()`. In a multi-repo session (cwd = repo A, edit touches repo B) the watch hook correctly writes B's pending/gate state under B's `.codex-pair/` (anchored on the edited file, #65), but the cwd-anchored hooks never see it — B's verdicts don't drain at turn-end and B's HIGH gate never fires. Pre-existing structural gap; ADR-130 inherited, did not regress, it.

**Decision:** Add a session-scoped marker registry under `os.tmpdir()/codex-pair-sessions/<hash(session_id)>/<hash(markerDir)>.json` — one idempotent file per (session, project). The watch hook (the only hook that knows both `session_id` and the edited `markerDir`) registers each active repo; the Stop and prompt hooks read the set back and drain/gate every registered marker unioned with the cwd marker. Per-file sharding mirrors ADR-087/097, so parallel registrations never race. SessionEnd clears the entry; a probabilistic mtime TTL sweep (24h) backstops crash-skipped SessionEnds.

**Consequences:** Multi-repo sessions now get the same post-"done" safety net as single-repo. No `session_id` on the payload → identical cwd-only behavior (blast radius confined to real multi-repo Claude Code sessions). Each repo keeps its own `blockOn`/`timeoutMs`. Registry helpers are best-effort and never throw (ADR-077).

**Deferred (follow-ups on #209, not this change):** cross-repo SessionEnd debounce cleanup, SessionStart pause-visibility, and broker bootstrap/teardown. The broker is env-gated (`ASK_CODEX_BROKER`, off by default) and debounce state self-heals via its TTL sweep.

**Alternatives rejected:** (a) Parse the Stop payload's `transcript_path` for edited-file paths — couples to Claude Code's transcript JSON format, re-reads a large file every turn-end. (b) Document-only — unacceptable for a must-be correctness gap.
```

- [ ] **Step 2: Create the changeset**

`.changeset/codex-pair-cross-repo-drain-gate.md`:

```markdown
---
"@ask-llm/plugin": patch
---

codex-pair: the Stop drain, `blockOn: HIGH` gate, and UserPromptSubmit drain now cover every repository edited during the session — not just Claude Code's current working directory. In multi-repo sessions where an edit lands in a different repo than the cwd, that repo's queued verdicts now drain at turn-end and its unaddressed HIGH findings correctly block "done" (issue #209, ADR-131). Behavior is unchanged for single-repo sessions and when the hook payload carries no `session_id`.
```

Note: `scripts/**` is NOT `packages/shared/src/`, so the shared-changeset drift guard (`check-shared-changeset.mjs`) does not require the other four MCP packages. Only `@ask-llm/plugin` is bumped.

- [ ] **Step 3: Update `docs/ROADMAP.md` and `docs/BUGS.md`**

- ROADMAP.md: add a dated run entry: "2026-07-03 — Fixed #209 (codex-pair cross-repo Stop drain + gate) via session-scoped marker registry (ADR-131). New `session-registry.mjs`; watch/stop-gate/prompt-drain/session hooks updated; deferred broker+pause cross-repo to follow-ups."
- BUGS.md: mark #209 fixed with a one-line pointer to ADR-131 and the deferred-scope note.

- [ ] **Step 4: Full verification gate**

Run:
```bash
yarn workspace @ask-llm/plugin run test
yarn lint
```
Expected: all plugin tests pass; Biome + `tsc --noEmit` clean. If Biome flags formatting on new files, run `yarn lint --write` (or `biome check --write`) and re-run.

- [ ] **Step 5: Commit**

This is intentionally a **docs/changeset-only** commit — the functional changes (registry
module, hook edits, tests) were already staged and committed by Tasks 1-5's own commit
steps. Before running this, `git status` should show only the four files below as
unstaged; if any `scripts/` or `__tests__/` files are still dirty here, a prior task's
commit was missed — commit it under that task's message first.

```bash
git add docs/DECISIONS.md docs/ROADMAP.md docs/BUGS.md .changeset/codex-pair-cross-repo-drain-gate.md
git commit -m "docs(codex-pair): ADR-131 + changeset + roadmap/bugs for #209"
```

---

## Post-implementation

- Push the branch and open a PR referencing #209. The pre-push husky smoke test runs live provider integration; quota errors skip-with-warning (ADR-051).
- Per CLAUDE.md: after `/speckit.implement`-style completion, run the consultant/reviewer agent to evaluate the solution; address findings before merge.
- No Postman or docs-site changes — no MCP tool or HTTP endpoint surface changed.

## Self-Review (author checklist — completed)

- **Spec coverage:** registry module (T1) ✓; watch registration (T2) ✓; prompt drain union (T3) ✓; Stop gate per-marker eval + aggregate block (T4) ✓; SessionEnd cleanup (T5) ✓; ADR/changeset/docs (T6) ✓; TTL sweep + live-session guard (T1) ✓; degradation-on-no-session tests (T3, T4) ✓. Deferred items explicitly out of scope in spec + ADR.
- **Spec-review findings addressed:** TTL sweep never deletes the live session (`exceptSessionId`, T1 + regression test); Stop-drain output channel documented as ADR-130-preserved (spec); per-marker git latency bound documented (spec).
- **Placeholder scan:** none — every step has concrete code/commands/expected output.
- **Type consistency:** `registerMarker`, `readRegisteredMarkers`, `collectSessionMarkers`, `clearSession`, `sweepStaleSessions`, `sessionDir` are named and used identically across Tasks 1-5. `evaluateMarker` returns `{ pendingText, blockReason }` consumed verbatim in `main()`.
```
