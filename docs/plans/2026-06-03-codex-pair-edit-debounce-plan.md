# codex-pair edit-debounce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse a burst of rapid same-file edits into a single review of the settled state, cutting Codex spend ~⅓ and eliminating the intermediate-state false alarms from #96 Bug 2.

**Architecture:** The PostToolUse hook stops reviewing inline when debounce is on. Instead it records the edit (bumping a per-file `generation`) and spawns a **detached worker** that sleeps the settle window, then — only if no newer edit superseded it (trailing-edge debounce) or the burst exceeded a max cap — **re-invokes the hook in forced-synchronous mode** (`CODEX_PAIR_FORCE_SYNC=1`) to run the real review. The worker captures the hook's emitted `systemMessage` and queues it in a per-file pending store; the *next* edit hook drains and surfaces it. State lives in two per-file JSON stores under `.codex-pair/state/`; concurrency is backstopped by the existing inflight-lock.

**Tech Stack:** Node ESM `.mjs` scripts (zero workspace imports — must run on a marketplace git-subdir install), Vitest (`@ask-llm/plugin`), the existing `_fixtures/codex` fake (scenario via `FAKE_CODEX_SCENARIO`), atomic tmp+rename writes (ADR-086/091).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/claude-plugin/scripts/lib/debounce-state.mjs` | **create** | Pure, unit-testable state + decision module: edit record (generation/burst), `decideReview`, pending store (`writePending`/`drainPending`), `clearAllDebounceState`, `sweepStaleDebounce`. |
| `packages/claude-plugin/src/__tests__/debounce-state.test.ts` | **create** | Unit tests for the above (no subprocess, no codex). |
| `packages/claude-plugin/scripts/codex-pair-debounce-worker.mjs` | **create** | Detached worker: sleep → `decideReview` → re-invoke hook in forced-sync mode → capture verdict → `writePending`. Exits 0 on every path. |
| `packages/claude-plugin/scripts/codex-pair-watch.mjs` | **modify** | Add `debounceMs`/`debounceMaxMs` to `resolveConfig` + constants; add the drain + dispatch branch; honor `CODEX_PAIR_FORCE_SYNC`. |
| `packages/claude-plugin/scripts/codex-pair-session.mjs` | **modify** | `SessionEnd` calls `clearAllDebounceState` — **un-gated** by `ASK_CODEX_BROKER`. |
| `packages/claude-plugin/scripts/codex-pair-prompt-drain.mjs` | **create** | `UserPromptSubmit` hook: drains pending verdicts at the start of the next user turn (closes the no-further-edit gap from the plan red-team). |
| `packages/claude-plugin/hooks/hooks.json` | **modify** | Add the `UserPromptSubmit` entry pointing to `codex-pair-prompt-drain.mjs`. |
| `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts` | **modify** | Structural-invariant + behavioral tests for the new hook wiring. |
| `packages/claude-plugin/src/__tests__/codex-pair-debounce-worker.test.ts` | **create** | Structural + behavioral tests for the worker (uses the fake-codex fixture). |
| `packages/claude-plugin/src/__tests__/codex-pair-prompt-drain.test.ts` | **create** | Structural + behavioral tests for the trailing-drain hook. |
| `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/BUGS.md` | **modify** | New ADR superseding ADR-111's "deferred"; roadmap + #96 closure note. |
| `packages/claude-plugin/skills/codex-pair/SKILL.md` | **modify** | Document the debounce window + `debounceMs:0` escape hatch. |

**Test command (all tasks):**
`yarn workspace @ask-llm/plugin run test -- src/__tests__/<file>` (Vitest passthrough; drop the `-- <file>` to run the whole suite).

---

## Task 1: Pure state + decision module (`lib/debounce-state.mjs`)

**Files:**
- Create: `packages/claude-plugin/scripts/lib/debounce-state.mjs`
- Test: `packages/claude-plugin/src/__tests__/debounce-state.test.ts`

This task has **no subprocess and no codex** — it is the deterministic heart of the feature, so it gets the most thorough unit tests.

- [ ] **Step 1: Write the failing test**

Create `packages/claude-plugin/src/__tests__/debounce-state.test.ts`:

```ts
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
    expect(decideReview({ record, myGeneration: 3, now: 100, maxMs: 60000 }))
      .toEqual({ review: true, reason: "settled" });
  });

  it("decideReview: superseded + under cap → skip", () => {
    const record = { file: "/x.ts", generation: 5, burstStartedAt: 1000, reviewedGen: 0 };
    expect(decideReview({ record, myGeneration: 2, now: 2000, maxMs: 60000 }))
      .toEqual({ review: false, reason: "superseded" });
  });

  it("decideReview: superseded but burst exceeded maxMs → review (cap)", () => {
    const record = { file: "/x.ts", generation: 5, burstStartedAt: 1000, reviewedGen: 0 };
    expect(decideReview({ record, myGeneration: 2, now: 70000, maxMs: 60000 }))
      .toEqual({ review: true, reason: "max-cap" });
  });

  it("decideReview: missing record → skip (cancelled)", () => {
    expect(decideReview({ record: null, myGeneration: 1, now: 0, maxMs: 60000 }))
      .toEqual({ review: false, reason: "record-missing" });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/debounce-state.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/lib/debounce-state.mjs'`.

- [ ] **Step 3: Write the implementation**

Create `packages/claude-plugin/scripts/lib/debounce-state.mjs`:

```js
// Per-file edit-debounce state (design 2026-06-03, closes #96 Bug 2 / Idea 1).
//
// Two per-file stores under <markerDir>/.codex-pair/state/:
//   debounce/<sha256(file)[0:16]>.json — edit record { file, generation, burstStartedAt, reviewedGen, sessionId }
//   pending/<sha256(file)[0:16]>.json  — settled verdict { file, message } awaiting surface
//
// Atomic writes use tmp+rename (ADR-086/091). Reads tolerate missing/malformed
// (return null / []). Every write is best-effort — debounce state failures must
// never break the hook (ADR-077).

import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { stateRoot } from "./state.mjs";

export const DEBOUNCE_DIR = "debounce";
export const PENDING_DIR = "pending";
export const DEFAULT_DEBOUNCE_MS = 15_000;
export const DEFAULT_DEBOUNCE_MAX_MS = 60_000;
// Sweep records/pending older than maxMs + this buffer (junk from crashes).
export const DEBOUNCE_STALE_BUFFER_MS = 300_000;

export const debounceRoot = (markerDir) => join(stateRoot(markerDir), DEBOUNCE_DIR);
export const pendingRoot = (markerDir) => join(stateRoot(markerDir), PENDING_DIR);

function fileHash(file) {
  return createHash("sha256").update(String(file)).digest("hex").slice(0, 16);
}
export const debounceRecordPath = (markerDir, file) =>
  join(debounceRoot(markerDir), `${fileHash(file)}.json`);
export const pendingPath = (markerDir, file) =>
  join(pendingRoot(markerDir), `${fileHash(file)}.json`);

function writeAtomicSync(p, value) {
  try {
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(value));
    renameSync(tmp, p);
  } catch {
    // best-effort (ADR-077)
  }
}

// Record one edit. Increments generation; preserves burstStartedAt while a
// burst is unconsumed (reviewedGen < generation), resets it for a fresh burst.
export function bumpEditRecord(markerDir, file, { sessionId, now }) {
  let prev = null;
  try {
    prev = JSON.parse(readFileSync(debounceRecordPath(markerDir, file), "utf8"));
  } catch {
    prev = null;
  }
  const generation = (prev?.generation ?? 0) + 1;
  const burstInProgress = prev && prev.reviewedGen < prev.generation;
  const burstStartedAt = burstInProgress ? prev.burstStartedAt : now;
  const record = { file, generation, burstStartedAt, reviewedGen: prev?.reviewedGen ?? 0, sessionId };
  writeAtomicSync(debounceRecordPath(markerDir, file), record);
  return record;
}

export function readEditRecord(markerDir, file) {
  try {
    return JSON.parse(readFileSync(debounceRecordPath(markerDir, file), "utf8"));
  } catch {
    return null;
  }
}

// Pure decision: should the worker born for `myGeneration` review now?
export function decideReview({ record, myGeneration, now, maxMs }) {
  if (!record) return { review: false, reason: "record-missing" };
  if (record.reviewedGen >= myGeneration) return { review: false, reason: "already-reviewed" };
  if (record.generation === myGeneration) return { review: true, reason: "settled" };
  if (now - record.burstStartedAt >= maxMs) return { review: true, reason: "max-cap" };
  return { review: false, reason: "superseded" };
}

// Advance reviewedGen so the next edit starts a fresh burst. Best-effort.
export function markReviewed(markerDir, file, generation) {
  const p = debounceRecordPath(markerDir, file);
  let rec;
  try {
    rec = JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return;
  }
  if (rec.reviewedGen < generation) {
    rec.reviewedGen = generation;
    writeAtomicSync(p, rec);
  }
}

export function writePending(markerDir, file, message) {
  writeAtomicSync(pendingPath(markerDir, file), { file, message });
}

// Read + clear every pending verdict (surfaced exactly once). Returns messages.
export function drainPending(markerDir) {
  const root = pendingRoot(markerDir);
  const messages = [];
  let names;
  try {
    names = readdirSync(root);
  } catch {
    return messages;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const full = join(root, name);
    try {
      const { message } = JSON.parse(readFileSync(full, "utf8"));
      if (typeof message === "string" && message.length > 0) messages.push(message);
    } catch {
      // skip malformed
    }
    try {
      unlinkSync(full);
    } catch {
      // already gone
    }
  }
  return messages;
}

// SessionEnd cancel: drop all debounce + pending state so orphaned sleepers
// self-cancel (decideReview → record-missing) and no stale verdict leaks into
// a later session.
export function clearAllDebounceState(markerDir) {
  for (const root of [debounceRoot(markerDir), pendingRoot(markerDir)]) {
    let names;
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        unlinkSync(join(root, name));
      } catch {
        // best-effort
      }
    }
  }
}

// Probabilistic TTL sweep (mirrors ADR-097). Best-effort; never throws.
export function sweepStaleDebounce(markerDir, maxMs) {
  const cutoff = Date.now() - (maxMs + DEBOUNCE_STALE_BUFFER_MS);
  for (const root of [debounceRoot(markerDir), pendingRoot(markerDir)]) {
    let names;
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(root, name);
      try {
        if (statSync(full).mtimeMs < cutoff) unlinkSync(full);
      } catch {
        // skip
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/debounce-state.test.ts`
Expected: PASS — 12 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/lib/debounce-state.mjs \
        packages/claude-plugin/src/__tests__/debounce-state.test.ts
git commit -m "feat(codex-pair): debounce state + decision module (#96)"
```

---

## Task 2: Config knobs + force-sync constant (`codex-pair-watch.mjs`)

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-watch.mjs` (constants `:90-94`, `resolveConfig` `:443-463`)
- Test: `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts` (structural block, append near other `resolveConfig`/constant invariants)

- [ ] **Step 1: Write the failing structural test**

Append inside the existing `describe("scripts/codex-pair-watch.mjs — structural invariants (ADR-077)", ...)` block in `codex-pair-watch.test.ts`:

```ts
  it("resolveConfig exposes debounceMs (default 15000) and debounceMaxMs (default 60000)", () => {
    expect(script).toMatch(/debounceMs:/);
    expect(script).toMatch(/debounceMaxMs:/);
    expect(script).toMatch(/DEFAULT_DEBOUNCE_MS/);
    expect(script).toMatch(/DEFAULT_DEBOUNCE_MAX_MS/);
  });

  it("debounceMs accepts 0 (>= 0 guard) to restore synchronous review", () => {
    // The frontmatter guard must allow 0 (disable), unlike timeoutMs (> 0).
    expect(script).toMatch(/fm\.debounceMs\s*===\s*"number"\s*&&\s*fm\.debounceMs\s*>=\s*0/);
  });

  it("honors CODEX_PAIR_FORCE_SYNC as a per-invocation synchronous override", () => {
    expect(script).toMatch(/CODEX_PAIR_FORCE_SYNC/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-watch.test.ts -t "debounceMs"`
Expected: FAIL — no match for `debounceMs:` / `DEFAULT_DEBOUNCE_MS`.

- [ ] **Step 3: Add the import + constants**

In `codex-pair-watch.mjs`, add to the lib import (near `:42`, alongside the existing `./lib/state.mjs` import — keep them adjacent). **Import only the constants here** — the functions (`bumpEditRecord`/`drainPending`/`sweepStaleDebounce`) are added in Task 3 where they're used, so `yarn lint` stays clean between commits:

```js
import { DEFAULT_DEBOUNCE_MS, DEFAULT_DEBOUNCE_MAX_MS } from "./lib/debounce-state.mjs";
```

After the existing constant block (right after `:94`, the `MAX_FILE_BYTES` line):

```js
const DEBOUNCE_MS = Number(process.env.ASK_CODEX_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS);
const DEBOUNCE_MAX_MS = Number(process.env.ASK_CODEX_DEBOUNCE_MAX_MS ?? DEFAULT_DEBOUNCE_MAX_MS);
```

- [ ] **Step 4: Extend `resolveConfig`**

In `resolveConfig` (`:446-462`), add two keys to the returned object (after `surfaceThreshold`):

```js
    debounceMs:
      typeof fm.debounceMs === "number" && fm.debounceMs >= 0 ? fm.debounceMs : DEBOUNCE_MS,
    debounceMaxMs:
      typeof fm.debounceMaxMs === "number" && fm.debounceMaxMs > 0 ? fm.debounceMaxMs : DEBOUNCE_MAX_MS,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-watch.test.ts -t "debounce"`
Expected: PASS — the 3 new structural tests green. (Only the two constants are imported here and both are used by the constant block, so `yarn lint` is clean at this commit. Behavioral wiring lands in Task 3.)

- [ ] **Step 6: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-watch.mjs \
        packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts
git commit -m "feat(codex-pair): debounceMs/debounceMaxMs config + force-sync hook flag (#96)"
```

---

## Task 3: Drain + dispatch branch in the hook (`codex-pair-watch.mjs`)

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-watch.mjs` (insert after `const config = resolveConfig(frontmatter);`, `:925`)
- Test: `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts`

- [ ] **Step 1: Write the failing tests**

Structural — append to the structural-invariants `describe`:

```ts
  it("dispatches to a detached debounce worker when debounceMs > 0", () => {
    expect(script).toMatch(/codex-pair-debounce-worker\.mjs/);
    expect(script).toMatch(/detached:\s*true/);
    expect(script).toMatch(/\.unref\(\)/);
  });

  it("drains pending verdicts and skips both drain+dispatch under force-sync", () => {
    expect(script).toMatch(/drainPending\(/);
    // The effective window collapses to 0 under force-sync (no drain, no dispatch).
    expect(script).toMatch(/CODEX_PAIR_FORCE_SYNC[^\n]*\?\s*0\s*:/);
  });
```

Behavioral — append a new test to the runtime-behavior `describe` (`:731`). It asserts that with `debounceMs` enabled, the hook returns fast, writes a debounce record, and does **not** emit its own verdict:

```ts
  it("debounce ON: records the edit + spawns a worker, emits no inline verdict", () => {
    // Short window + PATH isolation so the detached worker wakes fast and its
    // codex spawn ENOENTs instantly — no multi-second orphan after afterEach.
    // The assertions (record written, no inline verdict) are synchronous in the
    // hook, so the window value does not affect them.
    setupMarker(tempDir, "---\ndebounceMs: 300\n---\n# ctx");
    const target = path.join(tempDir, "x.ts");
    fs.writeFileSync(target, "export const a = 1;\n");
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: target },
      session_id: "sess-1",
    });
    // PATH-isolate so even if a worker mis-fires it cannot reach real codex.
    const isolatedPath = path.dirname(process.execPath);
    const result = runHook(payload, tempDir, { PATH: isolatedPath });
    expect(result.status).toBe(0);
    // No inline verdict on stdout (review is deferred to the worker).
    expect(result.stdout).not.toMatch(/systemMessage/);
    // A per-file debounce record was written.
    const debounceDir = path.join(tempDir, ".codex-pair/state/debounce");
    expect(fs.existsSync(debounceDir)).toBe(true);
    expect(fs.readdirSync(debounceDir).filter((f) => f.endsWith(".json")).length).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-watch.test.ts -t "debounce ON"`
Expected: FAIL — no debounce record dir created; `systemMessage` present (current code reviews inline).

- [ ] **Step 3: Extend the debounce import + add `spawnDebounceWorker` helper**

First extend the import added in Task 2 to include the functions used below:

```js
import { DEFAULT_DEBOUNCE_MS, DEFAULT_DEBOUNCE_MAX_MS, bumpEditRecord, drainPending, sweepStaleDebounce } from "./lib/debounce-state.mjs";
```

Then, near the other spawn helpers (after `spawnCodex`, ~`:650`), add:

```js
// Spawn the detached edit-debounce worker (design 2026-06-03). Mirrors the
// detached+unref pattern from spawnBroker. Returns true on success; the caller
// falls back to a synchronous review when this returns false.
function spawnDebounceWorker({ markerDir, filePath, toolName, generation, settleMs, maxMs, sessionId }) {
  try {
    const worker = spawn(process.execPath, [join(SCRIPT_DIR, "codex-pair-debounce-worker.mjs")], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CP_MARKER_DIR: markerDir,
        CP_FILE: filePath,
        CP_TOOL: toolName,
        CP_GENERATION: String(generation),
        CP_SETTLE_MS: String(settleMs),
        CP_MAX_MS: String(maxMs),
        CP_SESSION_ID: sessionId ?? "",
      },
    });
    worker.on("error", () => {});
    worker.unref();
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Insert the drain + dispatch branch**

In `main()`, immediately after `const config = resolveConfig(frontmatter);` (`:925`) and **before** the `let fileContent;` block (`:927`):

```js
  // Edit-debounce (design 2026-06-03, #96). When enabled, this edit is recorded
  // and a detached worker reviews the SETTLED file after the window — the hook
  // does NOT review inline. force-sync (set by the worker's re-invocation)
  // collapses the window to 0 so the synchronous path below runs verbatim.
  const effectiveDebounceMs = process.env.CODEX_PAIR_FORCE_SYNC === "1" ? 0 : config.debounceMs;
  if (effectiveDebounceMs > 0) {
    // Surface any verdict a prior worker queued (the worker has no stdout to
    // Claude). This is the ONLY systemMessage this invocation emits.
    const pendingMessages = drainPending(markerDir);
    if (pendingMessages.length > 0) {
      await emitSystemMessage(pendingMessages.join("\n\n"));
    }
    const record = bumpEditRecord(markerDir, filePath, {
      sessionId: payload?.session_id,
      now: Date.now(),
    });
    if (Math.random() < 0.05) sweepStaleDebounce(markerDir, config.debounceMaxMs);
    const spawned = spawnDebounceWorker({
      markerDir,
      filePath,
      toolName,
      generation: record.generation,
      settleMs: effectiveDebounceMs,
      maxMs: config.debounceMaxMs,
      sessionId: payload?.session_id,
    });
    if (spawned) process.exit(0);
    // Worker spawn failed → fall through to a synchronous review (safety net).
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-watch.test.ts`
Expected: PASS — new structural + behavioral tests green; **all pre-existing tests still green** (sync-mode path unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-watch.mjs \
        packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts
git commit -m "feat(codex-pair): drain pending + dispatch detached debounce worker (#96)"
```

---

## Task 4: The detached worker (`codex-pair-debounce-worker.mjs`)

**Files:**
- Create: `packages/claude-plugin/scripts/codex-pair-debounce-worker.mjs`
- Test: `packages/claude-plugin/src/__tests__/codex-pair-debounce-worker.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/claude-plugin/src/__tests__/codex-pair-debounce-worker.test.ts`:

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLUGIN_ROOT, readFile } from "./_helpers.js";

const WORKER_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-debounce-worker.mjs");
const FIXTURE_DIR = path.join(PLUGIN_ROOT, "src", "__tests__", "_fixtures");

describe("scripts/codex-pair-debounce-worker.mjs — structural invariants", () => {
  const script = readFile("scripts/codex-pair-debounce-worker.mjs");

  it("has a node shebang and is executable", () => {
    expect(script.startsWith("#!/usr/bin/env node")).toBe(true);
    expect((fs.statSync(WORKER_PATH).mode & 0o100) !== 0).toBe(true);
  });

  it("has zero workspace imports", () => {
    expect(script).not.toMatch(/from\s+["']@ask-llm/);
    expect(script).not.toMatch(/from\s+["']ask-(codex|gemini|ollama)-mcp/);
  });

  it("re-invokes the hook in forced-sync mode and exits 0 on every path", () => {
    expect(script).toMatch(/CODEX_PAIR_FORCE_SYNC:\s*["']1["']/);
    expect(script).toMatch(/codex-pair-watch\.mjs/);
    expect(script).toMatch(/decideReview/);
    expect(script).toMatch(/main\(\)\.catch\(\(\)\s*=>\s*process\.exit\(0\)\)/);
  });
});

describe("scripts/codex-pair-debounce-worker.mjs — runtime behavior", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "debounce-worker-"));
    fs.mkdirSync(path.join(dir, ".codex-pair"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".codex-pair/context.md"), "# ctx");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function seedRecord(file: string, rec: object) {
    const h = createHash("sha256").update(file).digest("hex").slice(0, 16);
    const p = path.join(dir, ".codex-pair/state/debounce", `${h}.json`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(rec));
  }

  function runWorker(file: string, generation: number, scenario: string | null) {
    return spawnSync("node", [WORKER_PATH], {
      cwd: dir,
      encoding: "utf-8",
      timeout: 15_000,
      env: {
        ...process.env,
        CP_MARKER_DIR: dir,
        CP_FILE: file,
        CP_TOOL: "Edit",
        CP_GENERATION: String(generation),
        CP_SETTLE_MS: "50",
        CP_MAX_MS: "60000",
        CP_SESSION_ID: "sess",
        // when a scenario is set, the fake codex is on PATH for the re-invoked hook
        ...(scenario ? { PATH: `${FIXTURE_DIR}:${process.env.PATH}`, FAKE_CODEX_SCENARIO: scenario } : {}),
      },
    });
  }

  it("superseded worker exits without reviewing (no pending written)", () => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    seedRecord(file, { file, generation: 5, burstStartedAt: Date.now(), reviewedGen: 0 });
    const res = runWorker(file, 2, "none"); // gen 2 < 5, under cap → skip
    expect(res.status).toBe(0);
    const pendingDir = path.join(dir, ".codex-pair/state/pending");
    expect(fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir) : []).toEqual([]);
  });

  it("latest-gen worker reviews via the hook and writes a pending verdict", () => {
    const file = path.join(dir, "x.ts");
    fs.writeFileSync(file, "export const a = 1;\n");
    seedRecord(file, { file, generation: 1, burstStartedAt: Date.now(), reviewedGen: 0 });
    const res = runWorker(file, 1, "none"); // latest gen → review (fake codex 'none')
    expect(res.status).toBe(0);
    const pendingDir = path.join(dir, ".codex-pair/state/pending");
    const files = fs.existsSync(pendingDir) ? fs.readdirSync(pendingDir).filter((f) => f.endsWith(".json")) : [];
    expect(files.length).toBe(1);
    const payload = JSON.parse(fs.readFileSync(path.join(pendingDir, files[0]), "utf-8"));
    expect(typeof payload.message).toBe("string");
    expect(payload.message).toMatch(/codex-pair/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-debounce-worker.test.ts`
Expected: FAIL — `Cannot find module .../codex-pair-debounce-worker.mjs` / file not executable.

- [ ] **Step 3: Write the worker**

Create `packages/claude-plugin/scripts/codex-pair-debounce-worker.mjs`:

```js
#!/usr/bin/env node
// Detached edit-debounce worker (design 2026-06-03, closes #96 Bug 2 / Idea 1).
//
// Spawned by codex-pair-watch.mjs on each edit when debounceMs > 0. Sleeps the
// settle window, then — only if no newer edit superseded it (trailing-edge) or
// the burst exceeded the max cap — re-invokes the hook in FORCED-SYNC mode to
// run the real review. The forced-sync hook acquires the existing per-file
// inflight lock itself, so concurrent workers race there and exactly one
// reviews (the inflight lock IS the claim — the worker holds no lock, which
// would otherwise deadlock against the hook).
//
// The worker has no stdout channel to Claude, so it captures the hook's emitted
// systemMessage and queues it in the per-file pending store; the next edit hook
// drains and surfaces it. MUST exit 0 on every path (ADR-077).

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideReview, markReviewed, readEditRecord, writePending } from "./lib/debounce-state.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(SCRIPT_DIR, "codex-pair-watch.mjs");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// The forced-sync hook writes one `{ "continue": true, "systemMessage": "..." }`
// JSON line to stdout. Pull systemMessage from the last parseable line.
function extractSystemMessage(stdout) {
  if (!stdout) return null;
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (typeof obj.systemMessage === "string") return obj.systemMessage;
    } catch {
      // not JSON — skip
    }
  }
  return null;
}

async function main() {
  const markerDir = process.env.CP_MARKER_DIR;
  const file = process.env.CP_FILE;
  const tool = process.env.CP_TOOL || "Edit";
  const myGeneration = Number(process.env.CP_GENERATION);
  const settleMs = Number(process.env.CP_SETTLE_MS);
  const maxMs = Number(process.env.CP_MAX_MS);
  if (!markerDir || !file || !Number.isFinite(myGeneration)) process.exit(0);

  await sleep(Number.isFinite(settleMs) ? settleMs : 15_000);

  const record = readEditRecord(markerDir, file);
  const decision = decideReview({ record, myGeneration, now: Date.now(), maxMs });
  if (!decision.review) process.exit(0);

  // Advance the burst marker so the next edit starts a fresh burst. The actual
  // concurrency claim is the inflight lock acquired by the forced-sync hook.
  markReviewed(markerDir, file, myGeneration);

  const payload = JSON.stringify({
    hook_event_name: "PostToolUse",
    tool_name: tool,
    tool_input: { file_path: file },
    session_id: process.env.CP_SESSION_ID || "",
  });
  const codexTimeout = Number(process.env.ASK_CODEX_TIMEOUT_MS ?? 800_000);
  const res = spawnSync(process.execPath, [HOOK_PATH], {
    input: payload,
    cwd: markerDir,
    encoding: "utf-8",
    env: { ...process.env, CODEX_PAIR_FORCE_SYNC: "1" },
    timeout: codexTimeout + 60_000,
  });
  const message = extractSystemMessage(res.stdout);
  if (message) writePending(markerDir, file, message);
  process.exit(0);
}

main().catch(() => process.exit(0));
```

- [ ] **Step 4: Make the worker executable**

Run: `chmod +x packages/claude-plugin/scripts/codex-pair-debounce-worker.mjs`
(The structural test asserts the owner-exec bit — mirrors the hook.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-debounce-worker.test.ts`
Expected: PASS — structural + both behavioral tests green. (The "latest-gen" test exercises worker → forced-sync hook → fake codex `none` → pending write end-to-end.)

- [ ] **Step 6: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-debounce-worker.mjs \
        packages/claude-plugin/src/__tests__/codex-pair-debounce-worker.test.ts
git commit -m "feat(codex-pair): detached debounce worker re-invokes hook in forced-sync mode (#96)"
```

---

## Task 5: SessionEnd cancellation (`codex-pair-session.mjs`)

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-session.mjs` (`handleSessionEnd` `:68-78`, and the `ASK_CODEX_BROKER` gate `:96`)
- Test: `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts` (or a session-specific structural test if one exists — otherwise add to the watch structural block reading the session script)

- [ ] **Step 1: Write the failing test**

Append to the structural-invariants block (it can read a second script via `readFile`):

```ts
  it("SessionEnd clears debounce state regardless of the broker flag", () => {
    const sessionScript = readFile("scripts/codex-pair-session.mjs");
    expect(sessionScript).toMatch(/clearAllDebounceState/);
    // The debounce cleanup must run even when ASK_CODEX_BROKER !== "1".
    expect(sessionScript).toMatch(/SessionEnd/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-watch.test.ts -t "SessionEnd clears debounce"`
Expected: FAIL — `clearAllDebounceState` not referenced in the session script.

- [ ] **Step 3: Wire SessionEnd cleanup un-gated by the broker flag**

In `codex-pair-session.mjs`, add the import (near `:14`):

```js
import { clearAllDebounceState } from "./lib/debounce-state.mjs";
```

Restructure `main()` so the debounce cleanup runs independent of the broker gate. Replace the broker-gate early-return region (`:94-98`) and the dispatch (`:100-107`) with:

```js
  // Edit-debounce cleanup runs for BOTH SessionStart and SessionEnd, regardless
  // of the broker flag (debounce is not broker-gated). On SessionEnd it cancels
  // orphaned sleepers; on SessionStart it clears any state a crashed prior
  // session left behind.
  const cwd = process.cwd();
  const dbMarkerDir = await findMarkerUp(cwd);
  if (dbMarkerDir) {
    try {
      clearAllDebounceState(dbMarkerDir);
    } catch {
      // best-effort (ADR-077)
    }
  }

  // Broker lifecycle remains gated behind ASK_CODEX_BROKER=1.
  if (process.env.ASK_CODEX_BROKER !== "1") {
    process.exit(0);
  }

  try {
    if (event === "SessionStart") await handleSessionStart();
    else if (event === "SessionEnd") await handleSessionEnd();
  } catch {
    // ADR-077 silent-on-error
  }
  process.exit(0);
```

(Place this after the existing `const event = payload?.hook_event_name; if (event !== "SessionStart" && event !== "SessionEnd") process.exit(0);` guard at `:89-92`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-watch.test.ts -t "SessionEnd clears debounce"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-session.mjs \
        packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts
git commit -m "feat(codex-pair): SessionEnd cancels orphaned debounce workers (#96)"
```

---

## Task 6: Trailing-verdict drain on `UserPromptSubmit`

Closes the plan red-team gap: a single edit with no following edit triggers a paid review whose verdict would otherwise never reach Claude. A `UserPromptSubmit` hook drains pending verdicts at the start of the next user turn — by which point the ~15s worker review has completed. Chosen over `Stop` (which fires before the review finishes) and avoids ADR-048's removed-Stop-hook baggage.

**Files:**
- Create: `packages/claude-plugin/scripts/codex-pair-prompt-drain.mjs`
- Modify: `packages/claude-plugin/hooks/hooks.json`
- Test: `packages/claude-plugin/src/__tests__/codex-pair-prompt-drain.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/claude-plugin/src/__tests__/codex-pair-prompt-drain.test.ts`:

```ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLUGIN_ROOT, readFile } from "./_helpers.js";

const DRAIN_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-prompt-drain.mjs");

describe("scripts/codex-pair-prompt-drain.mjs — structural invariants", () => {
  const script = readFile("scripts/codex-pair-prompt-drain.mjs");
  const hooks = readFile("hooks/hooks.json");

  it("has a node shebang and is executable", () => {
    expect(script.startsWith("#!/usr/bin/env node")).toBe(true);
    expect((fs.statSync(DRAIN_PATH).mode & 0o100) !== 0).toBe(true);
  });

  it("drains pending and exits 0 on every path", () => {
    expect(script).toMatch(/drainPending\(/);
    expect(script).toMatch(/UserPromptSubmit/);
    expect(script).toMatch(/main\(\)\.catch\(\(\)\s*=>\s*process\.exit\(0\)\)/);
  });

  it("is wired into hooks.json on UserPromptSubmit", () => {
    const parsed = JSON.parse(hooks);
    const ups = parsed.hooks.UserPromptSubmit;
    expect(Array.isArray(ups)).toBe(true);
    expect(JSON.stringify(ups)).toMatch(/codex-pair-prompt-drain\.mjs/);
  });
});

describe("scripts/codex-pair-prompt-drain.mjs — runtime behavior", () => {
  let cwd: string;
  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cp-prompt-drain-"));
    fs.mkdirSync(path.join(cwd, ".codex-pair/state/pending"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".codex-pair/context.md"), "# ctx");
  });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  function runDrain() {
    return spawnSync("node", [DRAIN_PATH], {
      input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hi" }),
      cwd, encoding: "utf-8", timeout: 10_000,
    });
  }

  it("surfaces a pending verdict as additionalContext and clears it", () => {
    fs.writeFileSync(
      path.join(cwd, ".codex-pair/state/pending", "seed.json"),
      JSON.stringify({ file: path.join(cwd, "y.ts"), message: "[codex-pair] reviewed y.ts — 1H/0M/0L" }),
    );
    const res = runDrain();
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/additionalContext/);
    expect(res.stdout).toMatch(/reviewed y\.ts/);
    expect(fs.readdirSync(path.join(cwd, ".codex-pair/state/pending")).filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  it("emits nothing when no pending verdict exists", () => {
    const res = runDrain();
    expect(res.status).toBe(0);
    expect(res.stdout).not.toMatch(/additionalContext/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-prompt-drain.test.ts`
Expected: FAIL — `Cannot find module .../codex-pair-prompt-drain.mjs`; `hooks.UserPromptSubmit` undefined.

- [ ] **Step 3: Write the drain hook**

Create `packages/claude-plugin/scripts/codex-pair-prompt-drain.mjs`:

```js
#!/usr/bin/env node
// UserPromptSubmit drain hook (design 2026-06-03 + plan red-team 2026-06-04).
//
// Surfaces any verdict a debounce worker queued, at the START of the next user
// turn — closing the gap where a single edit (with no following edit) leaves
// its review in the log but never in Claude's context. Cheap no-op when nothing
// is pending. MUST exit 0 on every path (ADR-077).
//
// findMarkerUp is duplicated from codex-pair-watch/session.mjs by design:
// zero-workspace-imports (marketplace git-subdir install has no node_modules)
// and the helper is too small to extract (15 LOC).

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONTEXT_FILENAME, PAIR_ROOT_DIR } from "./lib/state.mjs";
import { drainPending } from "./lib/debounce-state.mjs";

const MARKER_FILE = join(PAIR_ROOT_DIR, CONTEXT_FILENAME);

async function findMarkerUp(startDir) {
  const home = homedir();
  let current = resolve(startDir);
  for (let depth = 0; depth < 20; depth++) {
    try {
      await access(join(current, MARKER_FILE));
      return current;
    } catch {
      // not here
    }
    const parent = dirname(current);
    if (parent === current || current === home) return null;
    current = parent;
  }
  return null;
}

async function readStdin() {
  return new Promise((r) => {
    let data = "";
    process.stdin.on("data", (c) => {
      data += c.toString();
    });
    process.stdin.on("end", () => r(data));
    process.stdin.on("error", () => r(""));
  });
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  if (payload?.hook_event_name !== "UserPromptSubmit") process.exit(0);

  const markerDir = await findMarkerUp(process.cwd());
  if (!markerDir) process.exit(0);

  const messages = drainPending(markerDir);
  if (messages.length === 0) process.exit(0);

  // UserPromptSubmit context-injection contract: additionalContext is added to
  // the model's context for the upcoming turn. (Verify the exact shape against
  // the hook spec — plugin-dev:hook-development — before shipping.)
  const out = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: messages.join("\n\n"),
    },
  });
  process.stdout.write(`${out}\n`, () => process.exit(0));
}

main().catch(() => process.exit(0));
```

- [ ] **Step 4: Wire the hook + make executable**

Add to `packages/claude-plugin/hooks/hooks.json` (a new top-level key under `hooks`, alongside `PostToolUse`/`SessionStart`/`SessionEnd`):

```json
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/codex-pair-prompt-drain.mjs"
          }
        ]
      }
    ]
```

Run: `chmod +x packages/claude-plugin/scripts/codex-pair-prompt-drain.mjs`

- [ ] **Step 5: Run tests to verify they pass**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-prompt-drain.test.ts`
Expected: PASS — structural (incl. hooks.json wiring) + both behavioral tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-prompt-drain.mjs \
        packages/claude-plugin/hooks/hooks.json \
        packages/claude-plugin/src/__tests__/codex-pair-prompt-drain.test.ts
git commit -m "feat(codex-pair): UserPromptSubmit drain surfaces trailing debounce verdicts (#96)"
```

---

## Task 7: End-to-end burst + regression anchor

**Files:**
- Test: `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts` (new tests in the fake-codex describe block, `:1313`)

This task adds no production code — it proves the two headline behaviors against the real fake-codex path.

- [ ] **Step 1: Write the regression anchor (debounceMs:0 → synchronous, unchanged)**

Add to the fake-codex `describe` block:

```ts
  it("debounceMs:0 → synchronous review surfaces inline, no worker, no pending", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cp-sync-"));
    fs.mkdirSync(path.join(cwd, ".codex-pair"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".codex-pair/context.md"), "---\ndebounceMs: 0\n---\n# ctx");
    const target = path.join(cwd, "x.ts");
    fs.writeFileSync(target, "export const a = 1;\n");
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: target },
      session_id: "s",
    });
    const result = spawnSync("node", [HOOK_PATH], {
      input: payload, cwd, encoding: "utf-8", timeout: 20_000,
      env: { ...process.env, PATH: `${FIXTURE_DIR}:${process.env.PATH}`, FAKE_CODEX_SCENARIO: "none" },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/systemMessage/); // inline verdict (v0.7.0 behavior preserved)
    expect(fs.existsSync(path.join(cwd, ".codex-pair/state/debounce"))).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".codex-pair/state/pending"))).toBe(false);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Write the deferred-surface drain test**

```ts
  it("debounce: a queued pending verdict surfaces on the next edit hook", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cp-drain-"));
    fs.mkdirSync(path.join(cwd, ".codex-pair/state/pending"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".codex-pair/context.md"), "---\ndebounceMs: 15000\n---\n# ctx");
    const target = path.join(cwd, "y.ts");
    fs.writeFileSync(target, "export const b = 2;\n");
    // Pre-seed a pending verdict (drainPending reads any *.json in pending/,
    // so the filename need not match the file hash).
    fs.writeFileSync(
      path.join(cwd, ".codex-pair/state/pending", "seed.json"),
      JSON.stringify({ file: target, message: "[codex-pair] reviewed y.ts — 1H/0M/0L" }),
    );
    const payload = JSON.stringify({
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: target },
      session_id: "s",
    });
    // PATH-isolated: we only care that the DRAIN emits; the worker it spawns can't reach codex.
    const result = spawnSync("node", [HOOK_PATH], {
      input: payload, cwd, encoding: "utf-8", timeout: 10_000,
      env: { ...process.env, PATH: path.dirname(process.execPath) },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/reviewed y\.ts — 1H\/0M\/0L/);
    // Pending was cleared (surfaced exactly once).
    expect(fs.readdirSync(path.join(cwd, ".codex-pair/state/pending")).filter((f) => f.endsWith(".json"))).toEqual([]);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
```

- [ ] **Step 3: Run both tests**

Run: `yarn workspace @ask-llm/plugin run test -- src/__tests__/codex-pair-watch.test.ts -t "debounce"`
Expected: PASS — regression anchor + drain test green.

- [ ] **Step 4: Run the FULL plugin suite + lint (no regressions)**

Run: `yarn workspace @ask-llm/plugin run test`
Expected: PASS — all pre-existing tests still green (the prior ~216 + the new ones).

Run: `yarn lint`
Expected: Biome + tsc clean (no unused imports now that Task 3 wired them).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts
git commit -m "test(codex-pair): e2e burst-debounce + debounceMs:0 regression anchor (#96)"
```

---

## Task 8: Live smoke test + docs

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/BUGS.md`, `packages/claude-plugin/skills/codex-pair/SKILL.md`

- [ ] **Step 1: Live smoke test (real Codex, manual gate)**

Build, then drive a real burst against a scratch repo with a `.codex-pair/context.md` marker:

```bash
yarn build
```

In a scratch dir with the plugin's hooks wired (or via temp marker + manual hook invocation), verify three things:
- **Burst coalescing:** 3 rapid edits to one file within the 15s window, then a 4th edit after a pause → `.codex-pair/log.jsonl` shows **exactly one** `concerns|none` review for the burst (not 3), and the verdict surfaces on the **4th** edit (PostToolUse drain).
- **Trailing surface (red-team gap):** a **single** edit, then NO further edit, then a simulated `UserPromptSubmit` → the verdict surfaces as `additionalContext` on the next prompt (Task 6). This is the case that was previously lost.
- **Regression:** with `debounceMs: 0`, an edit reviews **synchronously** and surfaces inline (v0.7.0 behavior).

Record the results (counts, timing) — this is the gate from the S639 TDD + live-smoke discipline. If any fails, STOP and debug before docs.

- [ ] **Step 2: Add the ADR (supersedes ADR-111's "deferred" status)**

Prepend to `docs/DECISIONS.md` (above ADR-110) a new ADR, e.g.:

```markdown
## ADR-112: codex-pair Edit-Debounce — Detached Delayed-Worker (Supersedes ADR-111's Deferral)

**Context.** #96 Bug 2 / Idea 1: collapse rapid same-file edits into one review of the settled state. ADR-111 deferred this, noting a debounce needs a process outliving a single edit. The broker (`codex app-server`) is Codex's own process and off-by-default, so it cannot host the timer for the default path.

**Decision.** A **detached delayed-worker**, no daemon. Each edit spawns a detached sleeper carrying its `generation`; on wake it reviews only if it is the latest generation (trailing-edge) or the burst exceeded a 60s cap. The worker re-invokes the hook in `CODEX_PAIR_FORCE_SYNC=1` mode to reuse the entire review pipeline, captures the emitted verdict, and queues it in a per-file pending store. Verdicts surface on the next PostToolUse edit drain **or** on a `UserPromptSubmit` drain at the start of the next user turn (the latter closes the single-edit-then-stop gap surfaced in the plan red-team). The existing per-file inflight lock is the atomic claim against concurrent workers. ON by default (15s settle / 60s cap); `debounceMs:0` restores the v0.7.0 synchronous behavior.

**Consequences.** Closes #96. Surfacing is deferred (the worker has no stdout to Claude) but reliably reaches Claude via the PostToolUse or UserPromptSubmit drain — a trailing verdict with no following edit now surfaces on the next prompt rather than being lost. `UserPromptSubmit` was chosen over `Stop` (fires before the ~15s review completes) and avoids ADR-048's removed-Stop-hook baggage. ADR-111's "belongs in the broker" conclusion is narrowed: it belongs in *a* process outliving the edit, which the detached worker provides without a daemon.
```

- [ ] **Step 3: Update ROADMAP + BUGS + SKILL**

- `docs/ROADMAP.md`: add a 2026-06-03 entry recording the debounce shipment closing #96.
- `docs/BUGS.md`: mark #96 Bug 2 resolved by ADR-112.
- `packages/claude-plugin/skills/codex-pair/SKILL.md`: document `debounceMs` (default 15000, `0` disables) and `debounceMaxMs` (default 60000), and that reviews now surface on the *next* edit when debounce is on.

- [ ] **Step 4: Commit**

```bash
git add docs/DECISIONS.md docs/ROADMAP.md docs/BUGS.md \
        packages/claude-plugin/skills/codex-pair/SKILL.md
git commit -m "docs(codex-pair): ADR-112 edit-debounce + roadmap/bugs/skill (#96)"
```

- [ ] **Step 5: Push + open PR**

```bash
git push -u origin feat/codex-pair-edit-debounce
gh pr create --title "feat(codex-pair): edit-debounce — single review of settled state (#96)" \
  --body "Closes #96. Detached delayed-worker debounce per design 2026-06-03 / ADR-112."
```

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task:
- Detached worker + generation supersede → Task 1 (`decideReview`) + Task 4 (worker).
- Drain (next edit + trailing) → Task 1 (`drainPending`) + Task 3 (PostToolUse drain branch) + Task 6 (UserPromptSubmit trailing drain) + Task 7 (E2E drain test).
- ON by default 15s/60s + `debounceMs:0` escape hatch → Task 2 (config) + Task 7 (regression anchor).
- Per-file JSON stores + atomic writes + TTL sweep → Task 1.
- SessionEnd cancel (un-gated) → Task 5.
- Inflight-lock as claim / no double-review → Task 4 (worker holds no lock; forced-sync hook owns it).
- Error handling (worker-spawn fallback, silent-on-error) → Task 3 Step 4 (fall-through) + Task 4 (`main().catch`) + Task 6 (`main().catch`).
- Testing (unit + fixture + live smoke) → Tasks 1, 4, 6, 7, 8.

**2. Placeholder scan** — no TBD/TODO; every code + test step shows full content; commands have expected output.

**3. Type/name consistency** — `decideReview`, `bumpEditRecord`, `readEditRecord`, `markReviewed`, `writePending`, `drainPending`, `clearAllDebounceState`, `sweepStaleDebounce` are used with identical signatures across Tasks 1/3/4/5. Env keys `CP_MARKER_DIR/CP_FILE/CP_TOOL/CP_GENERATION/CP_SETTLE_MS/CP_MAX_MS/CP_SESSION_ID` match between `spawnDebounceWorker` (Task 3) and the worker (Task 4). `CODEX_PAIR_FORCE_SYNC` matches between hook gate (Task 3) and worker re-invocation (Task 4).

**Known assumption to validate during execution:** Claude Code surfaces a PostToolUse hook's `systemMessage` only from the live hook process (confirmed via `emitSystemMessage` at `codex-pair-watch.mjs:187`) — the deferred-surface mechanism depends on this and on the hook accepting a single stdout JSON line per invocation (the drain emits exactly once).
