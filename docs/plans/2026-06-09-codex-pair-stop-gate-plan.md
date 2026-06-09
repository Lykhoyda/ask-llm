# codex-pair Stop-gate (MVP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in `Stop` hook that blocks the agent from ending a turn while unaddressed HIGH codex-pair findings remain, deferrable via `/codex-pair-ack`.

**Architecture:** Pure, I/O-injected gate logic in `scripts/lib/stop-gate.mjs` (unit-tested without spawning anything); a thin `scripts/codex-pair-stop-gate.mjs` hook that wires stdin → marker/frontmatter → log/acks/git → block-or-allow, fail-open on every error; ack state via new `state.mjs` helpers; a `/codex-pair-ack` skill. Reconciles the append-only `log.jsonl` against present reality (file existence, git-cleanliness, indeterminate-latest). See design: `docs/plans/2026-06-09-codex-pair-stop-gate-design.md`.

**Tech Stack:** Node ESM `.mjs` hook scripts (zero workspace imports — marketplace git-subdir install has no `node_modules`; import only from sibling `./lib/*.mjs`), vitest (`packages/claude-plugin`), markdown skills.

**Conventions (verified):**
- `scripts/lib/state.mjs` exports: `PAIR_ROOT_DIR`, `CONTEXT_FILENAME`, `LOG_FILENAME`, `pairRoot(markerDir)`, `contextPath(markerDir)`, `logPath(markerDir)`, `stateRoot(markerDir)`, `hashConcernBody(body)`.
- `findMarkerUp(startDir)` is **duplicated inline** per hook (not exported) — copy it from `scripts/codex-pair-prompt-drain.mjs`.
- Log line shape: `{ timestamp, tool, file (absolute), verdict, counts:{high,med,low}, concerns:{high:[],med:[],low:[]} }`. Real-review verdicts: `concerns|none|cached`. Indeterminate: `skipped|error|retried|broker_fallback`.
- Tests live in `packages/claude-plugin/src/__tests__/*.test.ts` and import scripts via `../../scripts/lib/<x>.mjs`.
- Run tests: `yarn workspace @ask-llm/plugin run test <pattern>`.

---

## File structure

| File | Responsibility |
|------|----------------|
| `packages/claude-plugin/scripts/lib/stop-gate.mjs` *(create)* | Pure gate logic: parse log → latest per file; parse git porcelain; reconcile (A/B/C/E) → blocking list; format block message. No I/O. |
| `packages/claude-plugin/scripts/lib/state.mjs` *(modify)* | Add `acksPath`, `readAcks`, `addAck`. |
| `packages/claude-plugin/scripts/codex-pair-stop-gate.mjs` *(create)* | The Stop hook: stdin → marker → `blockOn` → gather log/acks/git → call gate logic → block JSON or exit 0. Fail-open everywhere. |
| `packages/claude-plugin/hooks/hooks.json` *(modify)* | Register the `Stop` hook. |
| `packages/claude-plugin/skills/codex-pair-ack/SKILL.md` *(create)* | `/codex-pair-ack <hash> "<reason>"`. |
| `packages/claude-plugin/src/__tests__/stop-gate.test.ts` *(create)* | Unit tests for `lib/stop-gate.mjs` + `state.mjs` ack helpers. |
| `packages/claude-plugin/src/__tests__/manifest.test.ts` *(modify)* | Assert `Stop` hook present + script exists. |
| `packages/claude-plugin/src/__tests__/skills-and-agents.test.ts` *(modify)* | Add `codex-pair-ack` to expected skills. |
| `docs/DECISIONS.md`, `docs/ROADMAP.md`, `apps/docs/plugin/hooks.md`, `packages/claude-plugin/README.md` *(modify)* | ADR-118 + roadmap + user docs. |
| `.changeset/*.md` *(create)* | `@ask-llm/plugin` is `private` → **no changeset** (verify). |

---

## Task 1: `selectLatestEntries` — parse log.jsonl, keep latest per file

**Files:**
- Create: `packages/claude-plugin/scripts/lib/stop-gate.mjs`
- Test: `packages/claude-plugin/src/__tests__/stop-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { selectLatestEntries } from "../../scripts/lib/stop-gate.mjs";

describe("selectLatestEntries", () => {
  it("keeps the last entry per file and tolerates blank/garbage lines", () => {
    const log = [
      '{"file":"/r/a.ts","verdict":"concerns","concerns":{"high":["H1"]}}',
      "",
      "not json",
      '{"file":"/r/a.ts","verdict":"none","concerns":{"high":[]}}',
      '{"file":"/r/b.ts","verdict":"concerns","concerns":{"high":["H2"]}}',
    ].join("\n");
    const map = selectLatestEntries(log);
    expect(map.get("/r/a.ts").verdict).toBe("none");
    expect(map.get("/r/b.ts").concerns.high).toEqual(["H2"]);
    expect(map.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: FAIL — `selectLatestEntries is not a function` / module not found.

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/lib/stop-gate.mjs
// Pure, I/O-free gate logic for the codex-pair Stop hook (#142, ADR-118).
// No workspace imports — the hook ships without node_modules.

// Parse log.jsonl text → Map<file, latestEntry>. Last write per file wins
// (the log is append-only; the final entry is the file's latest review).
export function selectLatestEntries(logText) {
  const latest = new Map();
  for (const line of logText.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let entry;
    try {
      entry = JSON.parse(t);
    } catch {
      continue;
    }
    if (entry && typeof entry.file === "string") latest.set(entry.file, entry);
  }
  return latest;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/lib/stop-gate.mjs packages/claude-plugin/src/__tests__/stop-gate.test.ts
git commit -m "feat(codex-pair): selectLatestEntries for stop-gate log parsing (#142)"
```

---

## Task 2: `parseGitPorcelain` — modified/untracked paths → absolute Set

**Files:**
- Modify: `packages/claude-plugin/scripts/lib/stop-gate.mjs`
- Test: `packages/claude-plugin/src/__tests__/stop-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseGitPorcelain } from "../../scripts/lib/stop-gate.mjs";

describe("parseGitPorcelain", () => {
  it("maps porcelain entries to absolute paths (modified, untracked, renamed)", () => {
    const out = [
      " M src/a.ts",
      "?? src/new.ts",
      "R  old.ts -> src/b.ts",
      "",
    ].join("\n");
    const set = parseGitPorcelain(out, "/repo");
    expect(set.has("/repo/src/a.ts")).toBe(true);
    expect(set.has("/repo/src/new.ts")).toBe(true);
    expect(set.has("/repo/src/b.ts")).toBe(true); // rename → new path is the dirty one
    expect(set.has("/repo/old.ts")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: FAIL — `parseGitPorcelain is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
import { isAbsolute, join } from "node:path";

// Parse `git status --porcelain` (v1) into a Set of ABSOLUTE paths that are
// modified or untracked relative to HEAD. repoRoot = `git rev-parse
// --show-toplevel`. Rename lines ("R  old -> new") contribute the NEW path
// (that's the file present on disk). The first 3 chars are the XY status +
// space; the path starts at index 3.
export function parseGitPorcelain(stdout, repoRoot) {
  const dirty = new Set();
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    let path = line.slice(3);
    const arrow = path.indexOf(" -> ");
    if (arrow !== -1) path = path.slice(arrow + 4);
    path = path.replace(/^"|"$/g, ""); // git quotes paths with special chars
    dirty.add(isAbsolute(path) ? path : join(repoRoot, path));
  }
  return dirty;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/lib/stop-gate.mjs packages/claude-plugin/src/__tests__/stop-gate.test.ts
git commit -m "feat(codex-pair): parseGitPorcelain for stop-gate revert filter (#142)"
```

---

## Task 3: `collectBlockingHighs` — the reconciliation (A/B/C/E)

**Files:**
- Modify: `packages/claude-plugin/scripts/lib/stop-gate.mjs`
- Test: `packages/claude-plugin/src/__tests__/stop-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { collectBlockingHighs } from "../../scripts/lib/stop-gate.mjs";

// helper: build a Map<file, entry>
const m = (obj) => new Map(Object.entries(obj));

describe("collectBlockingHighs", () => {
  const base = { markerDir: "/r", existsFn: () => true, gitDirty: null };

  it("blocks on a HIGH in the latest real entry", () => {
    const entries = m({ "/r/a.ts": { file: "/r/a.ts", verdict: "concerns", concerns: { high: ["H1"] } } });
    const out = collectBlockingHighs({ ...base, entries, acks: {} });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ file: "/r/a.ts", text: "H1" });
    expect(typeof out[0].hash).toBe("string");
  });

  it("[A] drops files that do not exist on disk", () => {
    const entries = m({ "/r/gone.ts": { file: "/r/gone.ts", verdict: "concerns", concerns: { high: ["H"] } } });
    const out = collectBlockingHighs({ ...base, entries, acks: {}, existsFn: () => false });
    expect(out).toHaveLength(0);
  });

  it("[C] indeterminate latest entry → fail-open (no fallback to stale HIGH)", () => {
    const entries = m({ "/r/a.ts": { file: "/r/a.ts", verdict: "error", concerns: { high: [] } } });
    const out = collectBlockingHighs({ ...base, entries, acks: {} });
    expect(out).toHaveLength(0);
  });

  it("[B] drops files clean vs HEAD when gitDirty is provided", () => {
    const entries = m({ "/r/a.ts": { file: "/r/a.ts", verdict: "concerns", concerns: { high: ["H"] } } });
    const clean = collectBlockingHighs({ ...base, entries, acks: {}, gitDirty: new Set() });
    expect(clean).toHaveLength(0);
    const dirty = collectBlockingHighs({ ...base, entries, acks: {}, gitDirty: new Set(["/r/a.ts"]) });
    expect(dirty).toHaveLength(1);
  });

  it("[E] acks are file-scoped — same text on two files acks independently", () => {
    const entries = m({
      "/r/a.ts": { file: "/r/a.ts", verdict: "concerns", concerns: { high: ["dup"] } },
      "/r/b.ts": { file: "/r/b.ts", verdict: "concerns", concerns: { high: ["dup"] } },
    });
    const all = collectBlockingHighs({ ...base, entries, acks: {} });
    expect(all).toHaveLength(2);
    const ackA = all.find((b) => b.file === "/r/a.ts").hash;
    const out = collectBlockingHighs({ ...base, entries, acks: { [ackA]: { reason: "x" } } });
    expect(out).toHaveLength(1);
    expect(out[0].file).toBe("/r/b.ts"); // b still blocks
  });

  it("a clean `none` latest entry blocks nothing (auto-clear on fix)", () => {
    const entries = m({ "/r/a.ts": { file: "/r/a.ts", verdict: "none", concerns: { high: [] } } });
    expect(collectBlockingHighs({ ...base, entries, acks: {} })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: FAIL — `collectBlockingHighs is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
import { relative } from "node:path";
import { hashConcernBody } from "./state.mjs";

const INDETERMINATE = new Set(["skipped", "error", "retried", "broker_fallback"]);

// Reconcile latest-per-file entries against present reality, returning the
// unacked HIGH findings that should block turn-end.
//   entries   Map<file, latestEntry>      (from selectLatestEntries)
//   acks      { [hash]: {reason, ts} }     (from readAcks)
//   existsFn  (absFile) => boolean         (injected fs.existsSync)
//   gitDirty  Set<absPath> | null          (null = no git filter)
//   markerDir project root for relPath ack identity
export function collectBlockingHighs({ entries, acks, existsFn, gitDirty, markerDir }) {
  const blocking = [];
  for (const [file, entry] of entries) {
    if (!existsFn(file)) continue; // [A] deleted/renamed
    if (INDETERMINATE.has(entry.verdict)) continue; // [C] indeterminate latest → fail-open
    if (gitDirty && !gitDirty.has(file)) continue; // [B] clean vs HEAD
    const highs = entry.concerns?.high ?? [];
    for (const text of highs) {
      const hash = hashConcernBody(`${relative(markerDir, file)}:${text}`); // [E] file-scoped
      if (!acks[hash]) blocking.push({ file, text, hash });
    }
  }
  return blocking;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: PASS (all 6 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/lib/stop-gate.mjs packages/claude-plugin/src/__tests__/stop-gate.test.ts
git commit -m "feat(codex-pair): collectBlockingHighs reconciliation (A/B/C/E) (#142)"
```

---

## Task 4: `formatBlockMessage` — the block reason text

**Files:**
- Modify: `packages/claude-plugin/scripts/lib/stop-gate.mjs`
- Test: `packages/claude-plugin/src/__tests__/stop-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { formatBlockMessage } from "../../scripts/lib/stop-gate.mjs";

describe("formatBlockMessage", () => {
  it("lists each finding with a short hash, file, and ack instructions", () => {
    const msg = formatBlockMessage(
      [
        { file: "/r/src/auth.ts", text: "onSubmit awaits mutation without .unwrap()", hash: "a1b2c3d4e5" },
        { file: "/r/src/del.tsx", text: "replace() after swallowed catch", hash: "d4e5f6a7b8" },
      ],
      "/r",
    );
    expect(msg).toContain("2 unaddressed HIGH");
    expect(msg).toContain("[a1b2c3]"); // short hash (first 6)
    expect(msg).toContain("src/auth.ts"); // relative path
    expect(msg).toContain("/codex-pair-ack a1b2c3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: FAIL — `formatBlockMessage is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// Build the Stop-hook block reason. Short hashes (first 6) are the ack ids.
export function formatBlockMessage(blocking, markerDir) {
  const lines = blocking.map((b) => {
    const short = b.hash.slice(0, 6);
    const rel = relative(markerDir, b.file);
    return `  [${short}] ${rel}\n    ${b.text}`;
  });
  return (
    `🚫 codex-pair: ${blocking.length} unaddressed HIGH finding(s) (blockOn: HIGH). ` +
    `Fix them, or defer each with /codex-pair-ack.\n\n` +
    `${lines.join("\n")}\n\n` +
    `To defer (stale / pre-existing / out-of-scope):\n` +
    `  /codex-pair-ack ${blocking[0].hash.slice(0, 6)} "<reason>"\n` +
    `(If you fixed a finding by editing a DIFFERENT file, make a real edit to the ` +
    `flagged file so it gets re-reviewed — an identical re-touch hits the review cache.)`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/lib/stop-gate.mjs packages/claude-plugin/src/__tests__/stop-gate.test.ts
git commit -m "feat(codex-pair): formatBlockMessage for stop-gate (#142)"
```

---

## Task 5: `state.mjs` ack helpers — `acksPath`, `readAcks`, `addAck`

**Files:**
- Modify: `packages/claude-plugin/scripts/lib/state.mjs`
- Test: `packages/claude-plugin/src/__tests__/stop-gate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addAck, readAcks, acksPath } from "../../scripts/lib/state.mjs";

describe("acks state helpers", () => {
  it("addAck persists, readAcks reads back, missing file → {}", () => {
    const dir = mkdtempSync(join(tmpdir(), "ackstest-"));
    try {
      expect(readAcks(dir)).toEqual({});
      expect(acksPath(dir).endsWith(".codex-pair/state/acks.json")).toBe(true);
      addAck(dir, "abc123", { reason: "stale" });
      const acks = readAcks(dir);
      expect(acks.abc123.reason).toBe("stale");
      expect(typeof acks.abc123.ts).toBe("string");
      addAck(dir, "def456", { reason: "pre-existing" });
      expect(Object.keys(readAcks(dir))).toHaveLength(2); // additive, not overwrite
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: FAIL — `addAck is not a function`.

- [ ] **Step 3: Write minimal implementation** (append near the other path helpers in `state.mjs`; reuse the existing `stateRoot`, `STATE_DIR`, `mkdirSync`, `readFileSync`, `writeFileSync` imports already present in the file)

```js
export const ACKS_FILENAME = "acks.json";
export const acksPath = (markerDir) => join(stateRoot(markerDir), ACKS_FILENAME);

export function readAcks(markerDir) {
  try {
    return JSON.parse(readFileSync(acksPath(markerDir), "utf8"));
  } catch {
    return {}; // missing/corrupt → no acks
  }
}

// Append-merge a single ack. Best-effort; the slash command surfaces failures.
export function addAck(markerDir, hash, { reason }) {
  const acks = readAcks(markerDir);
  acks[hash] = { reason, ts: new Date().toISOString() };
  mkdirSync(stateRoot(markerDir), { recursive: true });
  writeFileSync(acksPath(markerDir), `${JSON.stringify(acks, null, 2)}\n`);
}
```

> If `state.mjs` does not already import `mkdirSync`/`readFileSync`/`writeFileSync` from `node:fs`, add them to the existing top-of-file import. Verify with `rg "from \"node:fs\"" packages/claude-plugin/scripts/lib/state.mjs`.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test stop-gate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/lib/state.mjs packages/claude-plugin/src/__tests__/stop-gate.test.ts
git commit -m "feat(codex-pair): acks.json state helpers (#142)"
```

---

## Task 6: The hook script `codex-pair-stop-gate.mjs`

**Files:**
- Create: `packages/claude-plugin/scripts/codex-pair-stop-gate.mjs`

This task wires the pure logic to real I/O. It is exercised end-to-end by the manifest test (Task 7) and manual smoke; the pure branches are already unit-covered. No new unit test (spawning a hook with stdin is integration-shaped and brittle; keep coverage in the pure lib).

- [ ] **Step 1: Write the hook**

```js
#!/usr/bin/env node
// codex-pair Stop-gate (#142, ADR-118). Blocks turn-end while unaddressed HIGH
// findings remain — opt-in via `blockOn: HIGH` in .codex-pair/context.md.
// MUST exit 0 on every path: a throw/non-zero here would wedge every turn-end.
// Fail-open and LOUD (warn to stderr) on any internal error.
//
// findMarkerUp is duplicated by design (zero-workspace-imports; see prompt-drain).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CONTEXT_FILENAME, PAIR_ROOT_DIR, contextPath, logPath } from "./lib/state.mjs";
import { readAcks } from "./lib/state.mjs";
import { collectBlockingHighs, formatBlockMessage, parseGitPorcelain, selectLatestEntries } from "./lib/stop-gate.mjs";

const MARKER_FILE = join(PAIR_ROOT_DIR, CONTEXT_FILENAME);

function findMarkerUp(startDir) {
  const home = homedir();
  let current = resolve(startDir);
  for (let depth = 0; depth < 20; depth++) {
    if (existsSync(join(current, MARKER_FILE))) return current;
    const parent = dirname(current);
    if (parent === current || current === home) return null;
    current = parent;
  }
  return null;
}

function readStdin() {
  return new Promise((r) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c.toString()));
    process.stdin.on("end", () => r(data));
    process.stdin.on("error", () => r(""));
  });
}

// Minimal frontmatter scalar read — only need `blockOn`. Avoids importing the
// full parser from watch.mjs (which isn't in ./lib). Looks for `blockOn: X`
// inside the leading `---` block.
function readBlockOn(markerDir) {
  let text;
  try {
    text = readFileSync(contextPath(markerDir), "utf8");
  } catch {
    return null;
  }
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^\s*blockOn:\s*(\S+)\s*$/m);
  return m ? m[1].trim() : null;
}

function gitDirtySet(markerDir) {
  try {
    const repoRoot = execFileSync("git", ["-C", markerDir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const porcelain = execFileSync("git", ["-C", markerDir, "status", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseGitPorcelain(porcelain, repoRoot);
  } catch {
    return null; // not a repo / git missing → skip the [B] filter
  }
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
  // Avoid infinite loops: if Claude is already responding to a prior block, allow.
  if (payload?.stop_hook_active) process.exit(0);

  const markerDir = findMarkerUp(process.cwd());
  if (!markerDir) process.exit(0); // codex-pair not enabled here
  if (readBlockOn(markerDir) !== "HIGH") process.exit(0); // opt-in gate

  let logText = "";
  try {
    logText = readFileSync(logPath(markerDir), "utf8");
  } catch {
    process.exit(0); // no log yet → nothing to gate
  }

  const blocking = collectBlockingHighs({
    entries: selectLatestEntries(logText),
    acks: readAcks(markerDir),
    existsFn: existsSync,
    gitDirty: gitDirtySet(markerDir),
    markerDir,
  });

  if (blocking.length === 0) process.exit(0);

  const out = JSON.stringify({ decision: "block", reason: formatBlockMessage(blocking, markerDir) });
  process.stdout.write(`${out}\n`, () => process.exit(0));
}

main().catch((err) => {
  // Fail-open & LOUD — never block a turn on the gate's own bug.
  process.stderr.write(`[codex-pair] WARNING: stop-gate failed (${err?.message ?? err}). Allowing turn end — HIGH findings may remain.\n`);
  process.exit(0);
});
```

- [ ] **Step 2: Sanity-run the hook with a synthetic payload (allow path)**

Run:
```bash
echo '{"hook_event_name":"Stop"}' | node packages/claude-plugin/scripts/codex-pair-stop-gate.mjs; echo "exit=$?"
```
Expected: no output, `exit=0` (no marker in CWD → allow).

- [ ] **Step 3: Sanity-run the block path with a temp marker + log**

Run:
```bash
T=$(mktemp -d); mkdir -p "$T/.codex-pair/state"
printf -- '---\nblockOn: HIGH\n---\n' > "$T/.codex-pair/context.md"
touch "$T/real.ts"
printf '%s\n' '{"file":"'"$T"'/real.ts","verdict":"concerns","concerns":{"high":["awaits without .unwrap()"]}}' > "$T/.codex-pair/log.jsonl"
( cd "$T" && git init -q && git add -A )   # make real.ts "dirty"/tracked so the [B] filter keeps it
echo '{"hook_event_name":"Stop"}' | ( cd "$T" && node "$OLDPWD/packages/claude-plugin/scripts/codex-pair-stop-gate.mjs" ); echo "exit=$?"
rm -rf "$T"
```
Expected: prints `{"decision":"block","reason":"🚫 codex-pair: 1 unaddressed HIGH ..."}`, `exit=0`.

- [ ] **Step 4: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-stop-gate.mjs
git commit -m "feat(codex-pair): Stop-gate hook script — opt-in HIGH gate, fail-open (#142)"
```

---

## Task 7: Register the `Stop` hook + manifest test

**Files:**
- Modify: `packages/claude-plugin/hooks/hooks.json`
- Modify: `packages/claude-plugin/src/__tests__/manifest.test.ts`

- [ ] **Step 1: Write the failing test** (add inside the existing `hooks.json` describe block in `manifest.test.ts`)

```ts
it("registers the Stop hook → codex-pair-stop-gate.mjs", () => {
  expect(hooks.Stop).toBeDefined();
  const cmd = hooks.Stop[0].hooks[0].command;
  expect(cmd).toContain("${CLAUDE_PLUGIN_ROOT}");
  expect(cmd).toContain("codex-pair-stop-gate.mjs");
});

it("the stop-gate script exists on disk", () => {
  expect(existsSync(join(pluginRoot, "scripts", "codex-pair-stop-gate.mjs"))).toBe(true);
});
```

> Match the variable names already used in `manifest.test.ts` (e.g. the parsed `hooks` object, `pluginRoot`, the `existsSync`/`join` imports). If the file asserts "Stop hook is NOT present" (ADR-048 leftover), **replace** that assertion with the two above.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test manifest`
Expected: FAIL — `hooks.Stop` is undefined.

- [ ] **Step 3: Add the `Stop` block to `hooks.json`** (insert as a sibling of `PostToolUse`)

```json
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/codex-pair-stop-gate.mjs"
          }
        ]
      }
    ],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test manifest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/hooks/hooks.json packages/claude-plugin/src/__tests__/manifest.test.ts
git commit -m "feat(codex-pair): register Stop-gate hook in hooks.json (#142)"
```

---

## Task 8: `/codex-pair-ack` skill + skills test

**Files:**
- Create: `packages/claude-plugin/skills/codex-pair-ack/SKILL.md`
- Modify: `packages/claude-plugin/src/__tests__/skills-and-agents.test.ts`

- [ ] **Step 1: Write the failing test** (add `"codex-pair-ack"` to the expected-skills list in `skills-and-agents.test.ts`)

```ts
// In the array/`it.each` of expected skill directory names, add:
"codex-pair-ack",
```

> Find the existing `expectedSkills` (or equivalent) list and append the entry, matching the file's current structure.

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test skills-and-agents`
Expected: FAIL — missing `skills/codex-pair-ack/SKILL.md`.

- [ ] **Step 3: Create the skill** (modeled on `skills/codex-pair-pause/SKILL.md`)

```markdown
---
name: codex-pair-ack
description: Acknowledge (defer) a specific codex-pair HIGH finding so the Stop-gate stops blocking on it. Use when the gate blocks turn-end on a finding you've decided is stale, pre-existing, or out-of-scope. Writes the finding's hash + your reason to .codex-pair/state/acks.json. Usage: /codex-pair-ack <hash> "<reason>".
user_invocable: true
---

# Acknowledge a codex-pair finding

Defers a HIGH finding the Stop-gate is blocking on, by recording its hash and a reason in `.codex-pair/state/acks.json`. The gate then skips that exact finding (file-scoped) until its text changes.

## When to use

- The Stop-gate blocked turn-end and listed a finding you've judged stale / pre-existing / out-of-scope.
- You are NOT silencing it blindly — the `reason` is a recorded, auditable justification.

## Instructions

1. Parse the arguments: the first token is the `<hash>` (the short id shown in brackets by the gate, e.g. `a1b2c3`), the rest (quoted) is the `<reason>`. If either is missing, tell the user the usage: `/codex-pair-ack <hash> "<reason>"`.

2. Locate the marker by walking up from the cwd for `.codex-pair/context.md`. If none, tell the user codex-pair is not enabled here.

3. The gate prints **short** hashes (first 6 chars). The ack store keys on the **full** hash. Resolve the full hash by scanning `.codex-pair/state/` is unnecessary — instead, append the ack keyed by the short hash is WRONG. Resolve it: read `.codex-pair/log.jsonl`, recompute `hashConcernBody(relPath + ":" + text)` for each latest HIGH (same as the gate), and find the full hash whose first 6 chars match `<hash>`. Then run:

   \`\`\`bash
   node -e '
     const { addAck } = require("${CLAUDE_PLUGIN_ROOT}/scripts/lib/state.mjs");
     addAck(process.argv[1], process.argv[2], { reason: process.argv[3] });
   ' "<markerDir>" "<fullHash>" "<reason>"
   \`\`\`

   (state.mjs is ESM — invoke via a small `--input-type=module` node call or an inline import; match the pattern used by `/codex-pair-pause`.)

4. Confirm to the user: "Acknowledged `<hash>` — <reason>. The Stop-gate will skip this finding."
```

> NOTE for the implementer: the short→full hash resolution adds friction. If `codex-pair-pause` shows a simpler ESM-invocation idiom, mirror it. Consider (follow-up, not MVP) having the gate print full hashes to drop the resolution step — flag this to the user during review.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/plugin run test skills-and-agents`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/skills/codex-pair-ack/SKILL.md packages/claude-plugin/src/__tests__/skills-and-agents.test.ts
git commit -m "feat(codex-pair): /codex-pair-ack skill (#142)"
```

---

## Task 9: Docs + full verification

**Files:**
- Modify: `docs/DECISIONS.md` (ADR-118), `docs/ROADMAP.md`, `apps/docs/plugin/hooks.md`, `packages/claude-plugin/README.md`

- [ ] **Step 1: Add ADR-118** to the top of `docs/DECISIONS.md` (Context/Decision/Consequences) summarizing: opt-in `blockOn: HIGH` Stop-gate, log-derived + reconciled (A/B/C/E), file-scoped acks, fail-open, why-not-ADR-048. Reference the design doc.

- [ ] **Step 2: Add a ROADMAP.md entry** (top of the dated list) for the stop-gate, branch `feat/codex-pair-stop-gate`, ADR-118, closes #142.

- [ ] **Step 3: Update user docs** — `apps/docs/plugin/hooks.md` (document the new Stop hook + `blockOn` opt-in + `/codex-pair-ack`) and `packages/claude-plugin/README.md` (hooks table row). Keep concise.

- [ ] **Step 4: Confirm no changeset needed** — `@ask-llm/plugin` is `private`. Verify: `rg '"private"' packages/claude-plugin/package.json`. If private, skip the changeset.

- [ ] **Step 5: Full verification**

Run: `yarn workspace @ask-llm/plugin run test`
Expected: all plugin tests pass (existing + new stop-gate, manifest, skills).

Run: `yarn lint`
Expected: clean (Biome + tsc).

Run: `yarn build`
Expected: green (incl. docs build).

- [ ] **Step 6: Commit**

```bash
git add docs/DECISIONS.md docs/ROADMAP.md apps/docs/plugin/hooks.md packages/claude-plugin/README.md
git commit -m "docs(codex-pair): ADR-118 + user docs for Stop-gate (#142)"
```

---

## Out of scope (do NOT build here)

Per the spec §9: `open.json` ledger, edit-significance gating, debounce, MED/LOW gating, default-ON posture, concern-text normalization (F), `--no-cache` ack-clear (D). The short→full hash resolution friction in `/codex-pair-ack` is a known rough edge — note it for a follow-up (gate could emit full hashes).
