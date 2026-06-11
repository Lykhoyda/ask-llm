# codex-pair Auto-Pause Implementation Plan (#176)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the Codex provider is dead (quota exhausted, or 3 consecutive failures of any kind), the codex-pair hook pauses itself once with a clear message instead of error-spamming every edit.

**Architecture:** All codex spawns funnel through `runCodexWithFallback()` + `main()`'s catch in `scripts/codex-pair-watch.mjs` (the debounce worker re-invokes the same script in forced-sync mode). Policy lands at that choke point; durable state helpers land in `scripts/lib/state.mjs` next to the existing pause sentinel; the pure reset-hint parser lands in `scripts/lib/parser.mjs` (the hook file cannot be unit-imported — it executes `main()` on import). Manual resume only — no expiry logic anywhere.

**Tech Stack:** Node ESM `.mjs` hook scripts (zero workspace imports — marketplace `git-subdir` install has no `node_modules`), vitest tests in `packages/claude-plugin/src/__tests__/`, fake-codex PATH fixture with `FAKE_CODEX_SCENARIO` env dispatch.

**Spec:** `docs/plans/2026-06-11-codex-pair-auto-pause-design.md`

**Branch:** `feat/176-codex-pair-auto-pause` (already created; spec committed)

**Test command:** `yarn workspace @ask-llm/plugin run test <file>` (vitest positional filter). Full suite: `yarn workspace @ask-llm/plugin run test`. Lint: `yarn lint`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/claude-plugin/scripts/lib/state.mjs` | Modify | + `readPauseInfo`, `writeAutoPause`, failure counter (`readFailureCount`/`recordReviewFailure`/`clearReviewFailures`), `failuresPath`, `AUTOPAUSE_FAILURE_THRESHOLD` |
| `packages/claude-plugin/scripts/lib/parser.mjs` | Modify | + `parseResetHint` (pure string fn) |
| `packages/claude-plugin/scripts/codex-pair-watch.mjs` | Modify | QUOTA_SIGNALS extension, JSONL-error-aware rejection reason, `quotaExhausted` tagging, catch-path auto-pause wiring, pause-gate provenance, success-path counter clear |
| `packages/claude-plugin/src/__tests__/_fixtures/codex` | Modify | + `quota-plan` scenario (stderr banner + stdout JSONL error, the #176 reproduction) |
| `packages/claude-plugin/src/__tests__/auto-pause.test.ts` | Create | Unit tests for state helpers + `parseResetHint` |
| `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts` | Modify | Behavioral tests (quota auto-pause, backstop, silent skip); update existing `quota` test |
| `packages/claude-plugin/skills/codex-pair-resume/SKILL.md` | Modify | Auto-pause provenance note |
| `packages/claude-plugin/skills/codex-pair-pause/SKILL.md` | Modify | Mention hook can auto-pause |
| `packages/claude-plugin/skills/codex-pair/SKILL.md` | Modify | Dashboard shows pause provenance |
| `docs/DECISIONS.md` | Modify | ADR-120 |
| `docs/ROADMAP.md` | Modify | Mark #176 done |
| `.changeset/<generated>.md` | Create | `@ask-llm/plugin` minor |

---

### Task 1: Auto-pause state helpers in `lib/state.mjs`

**Files:**
- Modify: `packages/claude-plugin/scripts/lib/state.mjs`
- Create: `packages/claude-plugin/src/__tests__/auto-pause.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/claude-plugin/src/__tests__/auto-pause.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @ask-llm/plugin run test auto-pause.test.ts`
Expected: FAIL — `readPauseInfo` etc. are not exported from state.mjs (SyntaxError on import).

- [ ] **Step 3: Implement the helpers in `scripts/lib/state.mjs`**

Add after the existing `isPaused` function (the `── Pause sentinel ──` section). `renameSync` is already imported at the top of the file; no new imports needed.

```js
// ── Auto-pause (#176 / ADR-120) ───────────────────────────────────────────
// The hook can pause ITSELF: on provider quota exhaustion, or after
// AUTOPAUSE_FAILURE_THRESHOLD consecutive review failures of any kind.
// Same sentinel file as the manual /codex-pair-pause skill — an EMPTY file
// is a manual pause; a JSON body is an auto-pause with provenance. Resume
// is always manual (/codex-pair-resume or rm); there is no expiry logic.

export const FAILURES_FILENAME = "failures.json";
export const AUTOPAUSE_FAILURE_THRESHOLD = 3;
export const failuresPath = (markerDir) => join(stateRoot(markerDir), FAILURES_FILENAME);

// Returns null (not paused), { manual: true } (empty or unrecognized body),
// or the parsed auto-pause JSON ({ v, kind, reason, resetHint?, at }).
// Unrecognized bodies are treated as manual — the conservative read: an
// unknown pause never auto-expires and never gets overwritten.
export function readPauseInfo(markerDir) {
  let raw;
  try {
    raw = readFileSync(pausePath(markerDir), "utf8");
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { manual: true };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && (parsed.kind === "quota" || parsed.kind === "failures")) {
      return parsed;
    }
  } catch {
    // fall through to manual
  }
  return { manual: true };
}

// Write the auto-pause sentinel. `flag: "wx"` makes this atomic-exclusive:
// an existing pause (manual OR auto, including a concurrent hook racing us)
// is never overwritten — we return false and the caller skips its
// notification, which is what makes "notify once" hold under concurrency.
export function writeAutoPause(markerDir, { kind, reason, resetHint }) {
  const body = JSON.stringify({
    v: 1,
    kind,
    reason: clampReason(reason),
    ...(resetHint ? { resetHint } : {}),
    at: new Date().toISOString(),
  });
  try {
    mkdirSync(stateRoot(markerDir), { recursive: true });
    writeFileSync(pausePath(markerDir), body, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

// ── Consecutive-failure counter (#176 backstop) ──────────────────────────
// Global per project (markerDir), spans files and sessions. Incremented on
// every non-quota review failure; cleared on every successful live review.
// Tolerant reads (missing/corrupt → 0); atomic tmp+rename writes.

export function readFailureCount(markerDir) {
  try {
    const parsed = JSON.parse(readFileSync(failuresPath(markerDir), "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.consecutive === "number" && parsed.consecutive > 0) {
      return Math.floor(parsed.consecutive);
    }
  } catch {
    // missing/corrupt → 0
  }
  return 0;
}

export function recordReviewFailure(markerDir, reason) {
  const consecutive = readFailureCount(markerDir) + 1;
  const payload = {
    v: 1,
    consecutive,
    lastAt: new Date().toISOString(),
    lastReason: clampReason(typeof reason === "string" ? reason : String(reason)),
  };
  try {
    mkdirSync(stateRoot(markerDir), { recursive: true });
    const p = failuresPath(markerDir);
    const tmp = `${p}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(payload));
    renameSync(tmp, p);
  } catch {
    // best-effort — counter loss degrades to "pause later", never breaks the hook
  }
  return consecutive;
}

export function clearReviewFailures(markerDir) {
  try {
    unlinkSync(failuresPath(markerDir));
  } catch {
    // already clear
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @ask-llm/plugin run test auto-pause.test.ts`
Expected: PASS (all tests in both describes).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/lib/state.mjs packages/claude-plugin/src/__tests__/auto-pause.test.ts
git commit -m "feat(codex-pair): auto-pause state helpers — sentinel provenance + failure counter (#176)"
```

---

### Task 2: `parseResetHint` in `lib/parser.mjs`

**Files:**
- Modify: `packages/claude-plugin/scripts/lib/parser.mjs`
- Modify: `packages/claude-plugin/src/__tests__/auto-pause.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/claude-plugin/src/__tests__/auto-pause.test.ts` (add `parseResetHint` to a NEW import from parser.mjs at the top of the file):

```ts
import { parseResetHint } from "../../scripts/lib/parser.mjs";
```

```ts
describe("lib/parser.mjs — parseResetHint (#176)", () => {
  it.each([
    ["You've hit your usage limit. Try again in 3 hours 25 minutes.", "3 hours 25 minutes"],
    ["Rate limited, try again at 14:30 UTC", "14:30 UTC"],
    ["quota exceeded; resets at 2026-06-12T00:00:00Z", "2026-06-12T00:00:00Z"],
    ["please try again after 2 hours", "2 hours"],
  ])("extracts the hint from %j", (input, expected) => {
    expect(parseResetHint(input)).toBe(expected);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @ask-llm/plugin run test auto-pause.test.ts`
Expected: FAIL — `parseResetHint` not exported.

- [ ] **Step 3: Implement in `scripts/lib/parser.mjs`**

Add at the end of the file:

```js
// ── Reset-hint extraction (#176 / ADR-120) ────────────────────────────────
// Best-effort, DISPLAY-ONLY parse of "when does the quota reset" from a
// provider error message. Never used for timestamp math — resume is manual;
// the hint just makes the one-time auto-pause notice actionable.
const RESET_HINT_PATTERNS = [
  /try again (?:in|at|after)\s+([^.()\n]+)/i,
  /resets?\s+(?:in|at|after)\s+([^.()\n]+)/i,
];
const RESET_HINT_MAX_CHARS = 80;

export function parseResetHint(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  for (const re of RESET_HINT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const hint = m[1].trim().replace(/[,;].*$/, "").trim();
      if (hint.length > 0 && hint.length <= RESET_HINT_MAX_CHARS) return hint;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn workspace @ask-llm/plugin run test auto-pause.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/lib/parser.mjs packages/claude-plugin/src/__tests__/auto-pause.test.ts
git commit -m "feat(codex-pair): parseResetHint — display-only quota reset extraction (#176)"
```

---

### Task 3: Error classification — real reason instead of the stdin banner

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-watch.mjs` (QUOTA_SIGNALS + spawnCodex close handler)
- Modify: `packages/claude-plugin/src/__tests__/_fixtures/codex` (new `quota-plan` scenario)
- Modify: `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts`

- [ ] **Step 1: Add the `quota-plan` scenario to the fake-codex fixture**

In `packages/claude-plugin/src/__tests__/_fixtures/codex`, add a case after the existing `"quota"` case. This is the exact #176 reproduction: banner on stderr, real error as a stdout JSONL `error` event, non-zero exit:

```js
    case "quota-plan":
      // #176 reproduction: ChatGPT-plan quota error. The stderr carries only
      // the stdin banner; the REAL error is a JSONL error event on stdout.
      // Pre-fix, the hook surfaced "Reading prompt from stdin..." as the
      // failure reason. Both model invocations fail identically, so this
      // also exercises full quota exhaustion (primary + fallback).
      process.stderr.write("Reading prompt from stdin...\n");
      emitJsonl({ type: "thread.started", thread_id: "fake-thread-quota-plan" });
      emitJsonl({
        type: "error",
        message: "You've hit your usage limit. Try again in 3 hours 25 minutes.",
      });
      process.exit(1);
      break;
```

- [ ] **Step 2: Write the failing behavioral test**

In `codex-pair-watch.test.ts`, inside the fake-codex describe block (after the existing `quota` test). NOTE: this test asserts the CLASSIFICATION fix only (real reason, not banner). Auto-pause assertions come in Task 4 — at this point in the plan the hook still emits a plain error:

```ts
  it("fake-codex 'quota-plan' → failure reason is the JSONL error, NOT the stdin banner (#176)", () => {
    setupMarker(tempDir, "# ctx");
    const filePath = path.join(tempDir, "src.ts");
    fs.writeFileSync(filePath, "export const x = 1;");
    const payload = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: filePath },
    });
    const result = runHookWithFakeCodex(payload, tempDir, "quota-plan");
    expect(result.status).toBe(0);
    const lines = fs
      .readFileSync(path.join(tempDir, ".codex-pair/log.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const entry = lines.find((l) => typeof l.reason === "string" && /usage limit/i.test(l.reason));
    expect(entry).toBeTruthy();
    // The banner must never be the surfaced reason again.
    const bannerEntry = lines.find(
      (l) => typeof l.reason === "string" && /^Reading prompt from stdin/.test(l.reason.trim()),
    );
    expect(bannerEntry).toBeFalsy();
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-watch.test.ts -t "quota-plan"`
Expected: FAIL — log reason is `Reading prompt from stdin...` (stderr), not the JSONL error message.

- [ ] **Step 4: Implement the classification fix in `codex-pair-watch.mjs`**

4a. Extend `QUOTA_SIGNALS` (line ~106). Use `"usage limit"` not `"you've hit..."` — apostrophes vary (typographic `’` vs ASCII `'`); the lowercase substring match must not depend on them:

```js
const QUOTA_SIGNALS = [
  "rate_limit_exceeded",
  "quota_exceeded",
  "429",
  "insufficient_quota",
  // ChatGPT-plan phrasings (#176) — API-style signals above never match these.
  "usage limit",
  "rate limit",
];
```

4b. Add two helpers above `spawnCodex`:

```js
// Pull `{"type":"error"}` event messages out of codex --json stdout. On a
// non-zero exit the real failure reason is usually HERE, while stderr holds
// only the "Reading prompt from stdin..." banner (#176).
function extractJsonlErrorEvents(stdout) {
  const messages = [];
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.type === "error") {
      messages.push(typeof parsed.message === "string" ? parsed.message : JSON.stringify(parsed));
    }
  }
  return messages;
}

// Last non-empty stderr lines (≤3), capped at 500 bytes. The informative
// part of codex stderr is the TAIL — the quota line, when present, follows
// the stdin banner.
function stderrTail(stderr) {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return "";
  const tail = lines.slice(-3).join(" | ");
  return tail.length > 500 ? tail.slice(-500) : tail;
}
```

4c. Replace the non-zero-exit rejection in `spawnCodex`'s close handler:

```js
      } else {
        rejectCall(taggedError(stderr.trim() || `codex exit ${code}`, "error"));
      }
```

with:

```js
      } else {
        // Prefer the JSONL error event (the real reason) over the stderr
        // tail (often just the stdin banner) — #176.
        const errorEvents = extractJsonlErrorEvents(stdout);
        const reason =
          errorEvents.length > 0
            ? errorEvents[errorEvents.length - 1]
            : stderrTail(stderr) || `codex exit ${code}`;
        rejectCall(taggedError(reason, "error"));
      }
```

- [ ] **Step 5: Run tests to verify they pass (including untouched neighbors)**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-watch.test.ts`
Expected: PASS. The existing `exit-nonzero` test still passes (its reason comes from stderr — no JSONL events in that scenario); the existing `quota` test still passes (its stderr quota line is the tail; `rate_limit_exceeded` still matches).

- [ ] **Step 6: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-watch.mjs packages/claude-plugin/src/__tests__/_fixtures/codex packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts
git commit -m "fix(codex-pair): surface the real codex error, not the stdin banner; classify plan-quota phrasings (#176)"
```

---

### Task 4: Quota exhaustion → auto-pause

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-watch.mjs` (`runCodexWithFallback` tagging + `main()` catch wiring + imports)
- Modify: `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts` (new tests + UPDATE the existing `quota` test)

- [ ] **Step 1: Write the failing behavioral tests**

In `codex-pair-watch.test.ts`, fake-codex describe block:

```ts
  it("quota exhaustion (both models) → auto-pause: sentinel + one-time notice with reset hint (#176)", () => {
    setupMarker(tempDir, "# ctx");
    const filePath = path.join(tempDir, "src.ts");
    fs.writeFileSync(filePath, "export const x = 1;");
    const payload = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: filePath },
    });
    const result = runHookWithFakeCodex(payload, tempDir, "quota-plan");
    expect(result.status).toBe(0);

    // Sentinel written with quota provenance.
    const sentinelPath = path.join(tempDir, ".codex-pair/state/paused");
    expect(fs.existsSync(sentinelPath)).toBe(true);
    const sentinel = JSON.parse(fs.readFileSync(sentinelPath, "utf-8"));
    expect(sentinel.kind).toBe("quota");
    expect(sentinel.resetHint).toBe("3 hours 25 minutes");

    // One-time notice replaces the per-edit error message.
    const hookOutput = JSON.parse(result.stdout.trim());
    expect(hookOutput.systemMessage).toMatch(/auto-paused: provider quota exhausted/);
    expect(hookOutput.systemMessage).toMatch(/resets ~3 hours 25 minutes/);
    expect(hookOutput.systemMessage).toMatch(/\/codex-pair-resume/);
    expect(hookOutput.systemMessage).not.toMatch(/review failed/);

    // Log entry carries autoPaused provenance.
    const lines = fs
      .readFileSync(path.join(tempDir, ".codex-pair/log.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.autoPaused === "quota")).toBe(true);
  });

  it("after auto-pause, the next edit is a SILENT log-only skip stating provenance (#176)", () => {
    setupMarker(tempDir, "# ctx");
    const filePath = path.join(tempDir, "src.ts");
    fs.writeFileSync(filePath, "export const x = 1;");
    const payload = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: filePath },
    });
    runHookWithFakeCodex(payload, tempDir, "quota-plan"); // pauses
    // Different content → different cache key; proves the skip is the pause
    // gate, not the content-hash cache.
    fs.writeFileSync(filePath, "export const x = 2;");
    const second = runHookWithFakeCodex(payload, tempDir, "quota-plan");
    expect(second.status).toBe(0);
    expect(second.stdout.trim()).toBe(""); // NO systemMessage — silent
    const lines = fs
      .readFileSync(path.join(tempDir, ".codex-pair/log.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const skip = lines.filter((l) => l.verdict === "skipped").pop();
    expect(skip).toBeTruthy();
    expect(skip.reason).toMatch(/auto-paused \(quota/);
    expect(skip.reason).toMatch(/codex-pair-resume/);
  });
```

UPDATE the existing `quota` test (`fake-codex 'quota' scenario → falls back to FALLBACK_MODEL, log captures fellBack:true`) — both models exhausting on quota is now the auto-pause case, by design. Replace its body's assertions:

```ts
  it("fake-codex 'quota' scenario → both models exhaust → auto-pause (was: bare error) (#176)", () => {
    setupMarker(tempDir, "# ctx");
    const filePath = path.join(tempDir, "src.ts");
    fs.writeFileSync(filePath, "export const x = 1;");
    const payload = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: filePath },
    });
    const result = runHookWithFakeCodex(payload, tempDir, "quota");
    expect(result.status).toBe(0);
    const lines = fs
      .readFileSync(path.join(tempDir, ".codex-pair/log.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    // The quota reason still lands in the log…
    const errEntry = lines.find((l) => typeof l.reason === "string" && /rate_limit_exceeded|quota/i.test(l.reason));
    expect(errEntry).toBeTruthy();
    // …but the outcome is an auto-pause, not error spam.
    expect(fs.existsSync(path.join(tempDir, ".codex-pair/state/paused"))).toBe(true);
    const hookOutput = JSON.parse(result.stdout.trim());
    expect(hookOutput.systemMessage).toMatch(/auto-paused: provider quota exhausted/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-watch.test.ts -t "auto-pause"`
Expected: FAIL — no sentinel is written; systemMessage still says `review failed`.

- [ ] **Step 3: Implement quota tagging + catch wiring in `codex-pair-watch.mjs`**

3a. Extend the state.mjs import block at the top of the file (alphabetical ordering within the braces, matching biome):

```js
import {
  appendLog,
  AUTOPAUSE_FAILURE_THRESHOLD,
  clearReviewFailures,
  computeCacheKey,
  CONTEXT_FILENAME,
  contextPath,
  getBlockingFromShard,
  getCachedConcerns,
  hashConcernBody,
  ignorePath,
  includePath,
  INFLIGHT_TTL_MIN_MS,
  isPaused,
  logPath,
  PAIR_ROOT_DIR,
  readPauseInfo,
  recordReviewFailure,
  releaseInflightLock,
  setCachedConcerns,
  tryAcquireInflightLock,
  updateRepetitions,
} from "./lib/state.mjs";
```

And add `parseResetHint` to the parser.mjs import:

```js
import {
  buildVerdictMessage,
  DEFAULT_SURFACE_THRESHOLD,
  formatDuration,
  parseConcerns,
  parseResetHint,
  VALID_THRESHOLDS,
  VERDICT_PREFIXES,
} from "./lib/parser.mjs";
```

(`AUTOPAUSE_FAILURE_THRESHOLD`, `clearReviewFailures`, `recordReviewFailure` are used in Task 5 — importing them now keeps this import block stable across the two commits; biome does not flag unused named imports in .mjs by default, but if `yarn lint` complains, defer those three names to Task 5.)

3b. In `runCodexWithFallback`, tag full exhaustion. Replace the existing catch block:

```js
  } catch (err) {
    if (isQuotaError(err) && model !== fallbackModel) {
      const response = await spawnCodexWithRetry({
        prompt,
        model: fallbackModel,
        timeoutMs,
        markerDir,
      });
      return { response, fellBack: true };
    }
    throw err;
  }
```

with:

```js
  } catch (err) {
    if (isQuotaError(err) && model !== fallbackModel) {
      try {
        const response = await spawnCodexWithRetry({
          prompt,
          model: fallbackModel,
          timeoutMs,
          markerDir,
        });
        return { response, fellBack: true };
      } catch (fallbackErr) {
        // BOTH models failed. If the fallback also hit quota, the provider
        // is exhausted — tag it so main()'s catch auto-pauses (#176).
        if (isQuotaError(fallbackErr) && fallbackErr && typeof fallbackErr === "object") {
          fallbackErr.quotaExhausted = true;
        }
        throw fallbackErr;
      }
    }
    // model === fallbackModel: there is no ladder left — quota here IS exhaustion.
    if (isQuotaError(err) && err && typeof err === "object") {
      err.quotaExhausted = true;
    }
    throw err;
  }
```

3c. In `main()`'s catch around `runCodexWithFallback` (currently logs + emits the error message), insert the quota branch FIRST. Replace the catch body:

```js
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const verdict = verdictFromError(err);
    const prefix = VERDICT_PREFIXES[verdict] ?? VERDICT_PREFIXES.error;
    const durationMs = Date.now() - startedAt;
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict,
      reason,
      durationMs,
    });
    await emitSystemMessage(
      `codex-pair ${prefix}: ${filePath} — review failed: ${reason} (${formatDuration(durationMs)})`,
    );
    process.exit(0);
  }
```

with:

```js
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const verdict = verdictFromError(err);
    const prefix = VERDICT_PREFIXES[verdict] ?? VERDICT_PREFIXES.error;
    const durationMs = Date.now() - startedAt;

    // #176 / ADR-120: provider quota exhausted (both models) → pause
    // ourselves ONCE instead of erroring on every subsequent edit. The
    // sentinel write is wx-exclusive; false means another hook (or the
    // user) already paused — log, but stay silent.
    if (err && typeof err === "object" && err.quotaExhausted) {
      const resetHint = parseResetHint(reason);
      const paused = writeAutoPause(markerDir, { kind: "quota", reason, resetHint });
      await appendLog(markerDir, {
        timestamp: new Date().toISOString(),
        tool: toolName,
        file: filePath,
        verdict,
        reason,
        durationMs,
        ...(paused ? { autoPaused: "quota" } : {}),
      });
      if (paused) {
        const resetClause = resetHint ? ` (resets ~${resetHint})` : "";
        await emitSystemMessage(
          `codex-pair auto-paused: provider quota exhausted${resetClause}. Resume with /codex-pair-resume.`,
        );
      }
      process.exit(0);
    }

    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict,
      reason,
      durationMs,
    });
    await emitSystemMessage(
      `codex-pair ${prefix}: ${filePath} — review failed: ${reason} (${formatDuration(durationMs)})`,
    );
    process.exit(0);
  }
```

(Also add `writeAutoPause` to the state.mjs import block in 3a.)

3d. Upgrade the pause gate to state provenance. Replace:

```js
  if (isPaused(markerDir)) {
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict: "skipped",
      reason: "paused via /codex-pair-pause (rm .codex-pair/state/paused to resume)",
    });
    process.exit(0);
  }
```

with:

```js
  const pauseInfo = readPauseInfo(markerDir);
  if (pauseInfo) {
    const pauseReason = pauseInfo.manual
      ? "paused via /codex-pair-pause (rm .codex-pair/state/paused to resume)"
      : `auto-paused (${pauseInfo.kind}${pauseInfo.resetHint ? `, resets ~${pauseInfo.resetHint}` : ""}) — resume with /codex-pair-resume`;
    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict: "skipped",
      reason: pauseReason,
    });
    process.exit(0);
  }
```

`isPaused` stays exported from state.mjs (other consumers + the pause/resume skills' docs reference the same sentinel), but the hook now reads provenance in one pass. If `isPaused` is no longer referenced in watch.mjs after this change, REMOVE it from the watch.mjs import list (it is — check structural test at codex-pair-watch.test.ts which greps libState for the sentinel constants, not the hook's import of `isPaused`; run the suite to confirm).

- [ ] **Step 4: Run the full watch test file**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-watch.test.ts`
Expected: PASS — including the two new tests, the rewritten `quota` test, and all pre-existing tests (the pause-gate test asserting the manual skip reason still matches, because `{manual:true}` reproduces the old string).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-watch.mjs packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts
git commit -m "feat(codex-pair): auto-pause on provider quota exhaustion (#176)"
```

---

### Task 5: Consecutive-failure backstop

**Files:**
- Modify: `packages/claude-plugin/scripts/codex-pair-watch.mjs`
- Modify: `packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts`

- [ ] **Step 1: Write the failing behavioral tests**

In the fake-codex describe block. IMPORTANT: write DIFFERENT file content before each run — identical content would hit the content-hash cache (10-min TTL) after any success, or coalesce on log noise; distinct content isolates each run as a live spawn:

```ts
  it("backstop: 3 consecutive non-quota failures → auto-pause; 1–2 get an escalation suffix (#176)", () => {
    setupMarker(tempDir, "# ctx");
    const filePath = path.join(tempDir, "src.ts");
    const payload = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: filePath },
    });
    const sentinelPath = path.join(tempDir, ".codex-pair/state/paused");

    fs.writeFileSync(filePath, "export const x = 1;");
    const first = runHookWithFakeCodex(payload, tempDir, "exit-nonzero");
    expect(JSON.parse(first.stdout.trim()).systemMessage).toMatch(/failure 1\/3 before auto-pause/);
    expect(fs.existsSync(sentinelPath)).toBe(false);

    fs.writeFileSync(filePath, "export const x = 2;");
    const second = runHookWithFakeCodex(payload, tempDir, "exit-nonzero");
    expect(JSON.parse(second.stdout.trim()).systemMessage).toMatch(/failure 2\/3 before auto-pause/);
    expect(fs.existsSync(sentinelPath)).toBe(false);

    fs.writeFileSync(filePath, "export const x = 3;");
    const third = runHookWithFakeCodex(payload, tempDir, "exit-nonzero");
    expect(JSON.parse(third.stdout.trim()).systemMessage).toMatch(
      /auto-paused after 3 consecutive review failures/,
    );
    expect(fs.existsSync(sentinelPath)).toBe(true);
    const sentinel = JSON.parse(fs.readFileSync(sentinelPath, "utf-8"));
    expect(sentinel.kind).toBe("failures");

    // 4th edit: silent log-only skip.
    fs.writeFileSync(filePath, "export const x = 4;");
    const fourth = runHookWithFakeCodex(payload, tempDir, "exit-nonzero");
    expect(fourth.stdout.trim()).toBe("");
  });

  it("backstop counter resets on a successful live review (#176)", () => {
    setupMarker(tempDir, "# ctx");
    const filePath = path.join(tempDir, "src.ts");
    const payload = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: filePath },
    });
    const failuresFile = path.join(tempDir, ".codex-pair/state/failures.json");

    fs.writeFileSync(filePath, "export const a = 1;");
    runHookWithFakeCodex(payload, tempDir, "exit-nonzero");
    fs.writeFileSync(filePath, "export const a = 2;");
    runHookWithFakeCodex(payload, tempDir, "exit-nonzero");
    expect(JSON.parse(fs.readFileSync(failuresFile, "utf-8")).consecutive).toBe(2);

    // Success clears the streak…
    fs.writeFileSync(filePath, "export const a = 3;");
    runHookWithFakeCodex(payload, tempDir, "none");
    expect(fs.existsSync(failuresFile)).toBe(false);

    // …so two MORE failures still don't pause.
    fs.writeFileSync(filePath, "export const a = 4;");
    runHookWithFakeCodex(payload, tempDir, "exit-nonzero");
    fs.writeFileSync(filePath, "export const a = 5;");
    const fifth = runHookWithFakeCodex(payload, tempDir, "exit-nonzero");
    expect(JSON.parse(fifth.stdout.trim()).systemMessage).toMatch(/failure 2\/3 before auto-pause/);
    expect(fs.existsSync(path.join(tempDir, ".codex-pair/state/paused"))).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-watch.test.ts -t "backstop"`
Expected: FAIL — no failure suffix in messages, no sentinel after 3 failures.

- [ ] **Step 3: Wire the counter in `main()`**

3a. In the catch block from Task 4 step 3c, replace the non-quota tail (everything after the quota branch's `process.exit(0)`):

```js
    // #176 backstop: any other failure increments the consecutive counter.
    // At AUTOPAUSE_FAILURE_THRESHOLD, pause — a broken provider must not
    // error-spam an entire session. Counter clears on the next success.
    const failureCount = recordReviewFailure(markerDir, reason);
    if (failureCount >= AUTOPAUSE_FAILURE_THRESHOLD) {
      const paused = writeAutoPause(markerDir, { kind: "failures", reason });
      await appendLog(markerDir, {
        timestamp: new Date().toISOString(),
        tool: toolName,
        file: filePath,
        verdict,
        reason,
        durationMs,
        ...(paused ? { autoPaused: "failures" } : {}),
      });
      if (paused) {
        await emitSystemMessage(
          `codex-pair auto-paused after ${AUTOPAUSE_FAILURE_THRESHOLD} consecutive review failures (last: ${reason}). Resume with /codex-pair-resume.`,
        );
      }
      process.exit(0);
    }

    await appendLog(markerDir, {
      timestamp: new Date().toISOString(),
      tool: toolName,
      file: filePath,
      verdict,
      reason,
      durationMs,
    });
    await emitSystemMessage(
      `codex-pair ${prefix}: ${filePath} — review failed: ${reason} (${formatDuration(durationMs)}) (failure ${failureCount}/${AUTOPAUSE_FAILURE_THRESHOLD} before auto-pause)`,
    );
    process.exit(0);
```

3b. Clear the streak on success. Immediately AFTER the try/catch around `runCodexWithFallback` (i.e., right before `const concerns = parseConcerns(response);`):

```js
  // Live review succeeded — any failure streak is over (#176 backstop).
  clearReviewFailures(markerDir);
```

(The cache-hit path earlier in `main()` deliberately does NOT clear the counter — a cache hit proves nothing about current provider health.)

- [ ] **Step 4: Run the full watch test file**

Run: `yarn workspace @ask-llm/plugin run test codex-pair-watch.test.ts`
Expected: PASS. Pre-existing single-failure tests (`exit-nonzero`, `error-event`, `parse-failed`, `timeout`) still pass — their assertions use `toMatch` on prefixes/reasons, and the new ` (failure 1/3 before auto-pause)` suffix doesn't disturb those regexes. If any asserts an EXACT full message, update it to account for the suffix.

- [ ] **Step 5: Add structural invariants**

In the structural describe (`scripts/codex-pair-watch.mjs — structural invariants`), add:

```ts
  it("auto-pauses on quota exhaustion and consecutive failures (#176 / ADR-120)", () => {
    expect(script).toMatch(/quotaExhausted/);
    expect(script).toMatch(/writeAutoPause/);
    expect(script).toMatch(/AUTOPAUSE_FAILURE_THRESHOLD/);
    expect(script).toMatch(/clearReviewFailures/);
    expect(libState).toMatch(/flag:\s*"wx"/); // no-clobber sentinel write
  });
```

Run: `yarn workspace @ask-llm/plugin run test codex-pair-watch.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the FULL plugin suite + lint**

Run: `yarn workspace @ask-llm/plugin run test && yarn lint`
Expected: all tests pass (debounce-worker, prompt-drain, stop-gate suites are untouched but exercise overlapping code paths); lint clean. If lint flags unused imports from Task 4 step 3a, they are all used now.

- [ ] **Step 7: Commit**

```bash
git add packages/claude-plugin/scripts/codex-pair-watch.mjs packages/claude-plugin/src/__tests__/codex-pair-watch.test.ts
git commit -m "feat(codex-pair): backstop auto-pause after 3 consecutive review failures (#176)"
```

---

### Task 6: Skill doc updates

**Files:**
- Modify: `packages/claude-plugin/skills/codex-pair-resume/SKILL.md`
- Modify: `packages/claude-plugin/skills/codex-pair-pause/SKILL.md`
- Modify: `packages/claude-plugin/skills/codex-pair/SKILL.md`

- [ ] **Step 1: Update `codex-pair-resume/SKILL.md`**

In the Instructions section, replace step 2's existence check with provenance-aware wording:

```markdown
2. Check whether the pause sentinel exists at `<marker-dir>/.codex-pair/state/paused`:
   - If it does not exist, tell the user: "codex-pair was not paused — no `.codex-pair/state/paused` sentinel found. No change."
   - If it exists and is non-empty, it is an auto-pause written by the hook itself
     (quota exhaustion or repeated failures — see #176). `cat` it and show the user
     the `kind`, `reason`, and `resetHint` fields before removing, so they know
     whether the provider has likely recovered.
   - Remove it:
     ```bash
     rm <marker-dir>/.codex-pair/state/paused
     ```
```

- [ ] **Step 2: Update `codex-pair-pause/SKILL.md`**

Add one sentence to the intro paragraph (after "Resume with `/codex-pair-resume`."):

```markdown
The hook may also pause itself automatically — on provider quota exhaustion or after
3 consecutive review failures — writing the same sentinel with a JSON body that
records why (`kind`, `reason`, `resetHint`). Manual and automatic pauses are resumed
the same way.
```

- [ ] **Step 3: Update `codex-pair/SKILL.md` (dashboard)**

Find the section that reports paused state (search for `state/paused` in the file) and extend it: when the sentinel exists AND is non-empty, parse the JSON and report `Auto-paused (<kind>) since <at>: <reason>` plus `Resets ~<resetHint>` when present, instead of just "paused". Keep the manual-pause wording unchanged for empty sentinels. (This skill file is instructions-to-Claude prose — match its existing imperative style.)

- [ ] **Step 4: Run the skills structural test**

Run: `yarn workspace @ask-llm/plugin run test skills-and-agents.test.ts`
Expected: PASS (frontmatter schema unchanged; only body prose edited).

- [ ] **Step 5: Commit**

```bash
git add packages/claude-plugin/skills/codex-pair-resume/SKILL.md packages/claude-plugin/skills/codex-pair-pause/SKILL.md packages/claude-plugin/skills/codex-pair/SKILL.md
git commit -m "docs(codex-pair): document auto-pause provenance in pause/resume/dashboard skills (#176)"
```

---

### Task 7: Project docs + changeset

**Files:**
- Modify: `docs/DECISIONS.md` (ADR-120)
- Modify: `docs/ROADMAP.md`
- Create: `.changeset/<descriptive-name>.md`

- [ ] **Step 1: Write ADR-120 in `docs/DECISIONS.md`**

Append, following the existing ADR format in the file (read the last entry, ADR-119, and match its heading/section style):

```markdown
## ADR-120: codex-pair auto-pauses itself on provider failure (#176)

**Context.** Once Codex quota was exhausted, the PostToolUse hook failed on every
edit for the rest of the session with an unhelpful reason ("Reading prompt from
stdin..." — the stderr banner; the real error is a stdout JSONL `error` event the
non-zero-exit path discarded). QUOTA_SIGNALS only matched API-style errors, so
ChatGPT-plan quota messages ("You've hit your usage limit") bypassed even the
existing model fallback. The plugin had a pause mechanism but never invoked it.

**Decision.**
1. Non-zero-exit rejection reason = last stdout JSONL error event, falling back to
   the stderr tail, then `codex exit <code>`.
2. QUOTA_SIGNALS += "usage limit", "rate limit" (apostrophe-free substrings —
   typographic vs ASCII apostrophes must not matter).
3. Both-models-quota → `err.quotaExhausted = true` → hook writes the pause sentinel
   itself and notifies ONCE (with a display-only reset hint parsed from the error).
4. Backstop: 3 consecutive non-quota failures (global per project, any kind) →
   same auto-pause. Counter (`state/failures.json`) clears on any successful live
   review; cache hits don't touch it.
5. Sentinel reuse: same `state/paused` file as /codex-pair-pause. Empty = manual,
   JSON body = auto (kind/reason/resetHint/at). Written `flag:"wx"` — an existing
   pause is never clobbered, which also makes notify-once hold under concurrency.
6. **Resume is always manual** (/codex-pair-resume or rm). No expiry logic — the
   user may have their own reasons to stay paused; the reset hint is informational.

**Alternatives rejected.** Dedicated `state/quota-paused` sentinel (two files to
reason about); auto-resume on parsed reset time (clobbers user intent); widening
the VERDICT_PREFIXES taxonomy with a `quota` verdict (closed set consumed by log
tooling); new `lib/auto-pause.mjs` module (duplicates state.mjs's pause ownership).

**Spec:** docs/plans/2026-06-11-codex-pair-auto-pause-design.md
```

- [ ] **Step 2: Update `docs/ROADMAP.md`**

Read the file first; add/mark the #176 line in whatever section tracks in-flight work, matching existing entry style (e.g., under a "Done" or current-release section): `#176 codex-pair auto-pause on provider quota exhaustion — shipped (ADR-120)`.

- [ ] **Step 3: Create the changeset**

Create `.changeset/codex-pair-auto-pause.md`:

```markdown
---
"@ask-llm/plugin": minor
---

codex-pair now pauses itself when the provider is dead instead of erroring on every edit (#176). Quota exhaustion (both models) auto-pauses with a one-time notice including the parsed reset hint; 3 consecutive failures of any kind trigger the same backstop. Failure reasons now surface the real codex error (stdout JSONL error event) instead of the "Reading prompt from stdin..." stderr banner, and ChatGPT-plan quota phrasings ("You've hit your usage limit") are now classified for the existing model fallback. Resume stays manual: /codex-pair-resume.
```

- [ ] **Step 4: Full verification**

Run: `yarn build && yarn test && yarn lint`
Expected: build clean across workspaces, full monorepo suite passes, lint clean.

- [ ] **Step 5: Commit**

```bash
git add docs/DECISIONS.md docs/ROADMAP.md .changeset/codex-pair-auto-pause.md
git commit -m "docs: ADR-120 + roadmap + changeset for codex-pair auto-pause (#176)"
```

---

### Task 8: PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/176-codex-pair-auto-pause
gh pr create --title "feat(codex-pair): auto-pause on provider quota exhaustion (#176)" --body "$(cat <<'EOF'
Closes #176.

## What
- Failure reasons now surface the real codex error (stdout JSONL `error` event) instead of the `Reading prompt from stdin...` stderr banner.
- `QUOTA_SIGNALS` now matches ChatGPT-plan phrasings ("usage limit", "rate limit") — repairs the existing gpt-5.5 → mini fallback for plan quota errors.
- Both-models quota exhaustion → the hook pauses itself once (`state/paused` with JSON provenance, `wx` no-clobber) and notifies once, with a display-only reset hint.
- Backstop: 3 consecutive non-quota failures → same auto-pause. Counter clears on success.
- Resume is always manual (`/codex-pair-resume`); a manual pause is never overwritten.

## Design / decisions
- Spec: `docs/plans/2026-06-11-codex-pair-auto-pause-design.md`
- ADR-120 in `docs/DECISIONS.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Babysit the PR per repo rules**

Wait for CI checks to pass; read review comments and unresolved threads; address actionable findings and resolve threads before merging (user's global rule: never merge without reviewing feedback).

---

## Self-Review Notes

- **Spec coverage:** classification (§1) → Task 3; quota auto-pause (§2) → Task 4; backstop (§3) → Tasks 1+5; sentinel format (§4) → Tasks 1+4(3d)+6; tests (spec Testing section) → Tasks 1–5; docs/release → Tasks 6–7. Out-of-scope items have no tasks, as specified.
- **Known intentional test change:** the pre-existing `quota` behavioral test is rewritten in Task 4 (both-models-exhausted is now auto-pause by design, not bare error).
- **Cache interference:** sequential-run tests vary file content per run — a content-hash cache hit would otherwise short-circuit before the spawn and silently skip counter/pause paths.
- **Type consistency check:** `writeAutoPause(markerDir, {kind, reason, resetHint})` returns boolean (Tasks 1, 4, 5); `recordReviewFailure(markerDir, reason)` returns number (Tasks 1, 5); `readPauseInfo(markerDir)` returns `null | {manual:true} | {v,kind,reason,resetHint?,at}` (Tasks 1, 4); `parseResetHint(text)` returns `string | null` (Tasks 2, 4). Names match across all tasks.
