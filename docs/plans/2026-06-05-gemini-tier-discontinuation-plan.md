# Gemini Tier-Discontinuation Guidance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Gemini CLI's backend stops serving a user's tier on 2026-06-18, translate the resulting raw 401/403/quota error into a prepended, hedged, actionable message — without changing the Flash-fallback control flow.

**Architecture:** A date-gated, class-based terminal-error enricher. A pure module classifies a *raw* gemini error (`workspaceTrust | quota | tierAccess | operational | unknown`) and a pure formatter prepends a tier-discontinuation note when `now ≥ UTC cutoff` and the class is `quota`/`tierAccess`. The executor's catch block calls the formatter at its two terminal throw sites (classifying the raw Flash error at `:584`, the raw error at `:587`); the narrow `QUOTA_PATTERNS` Flash-fallback trigger is untouched.

**Tech Stack:** TypeScript (ES2022/Node16 ESM), Vitest (`ask-gemini-mcp` workspace), Biome. Pure functions for testability; `vi.mock("@ask-llm/shared")` for executor catch-flow tests.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/gemini-mcp/src/constants.ts` | **modify** | Add `TIER_ACCESS_PATTERNS`, `OPERATIONAL_PATTERNS`, `GEMINI_TIER_CUTOFF_DEFAULT`, `TIER_NOTE_MARKER`, `ERROR_MESSAGES.TIER_DISCONTINUED`. |
| `packages/gemini-mcp/src/utils/tierGuidance.ts` | **create** | Pure module: `classifyGeminiCliError`, `resolveTierCutoff`, `formatTierNote`. No executor deps. |
| `packages/gemini-mcp/src/__tests__/tier-guidance.test.ts` | **create** | Unit tests for the pure module (no mocks). |
| `packages/gemini-mcp/src/utils/geminiExecutor.ts` | **modify** | Import the three helpers; enrich at `:584` and `:587`. No fallback-flow change. |
| `packages/gemini-mcp/src/__tests__/tier-executor.test.ts` | **create** | Executor catch-flow tests via `vi.mock("@ask-llm/shared")` → `executeCommand`. |
| `README.md`, `apps/docs/providers/gemini.md`, `packages/gemini-mcp/CHANGELOG.md` | **modify** | Cutoff banner + caveats. |
| `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/BUGS.md` | **modify** | ADR-113, roadmap entry, Flash-404 side-finding. |

**Test command:** `yarn workspace ask-gemini-mcp run test -- src/__tests__/<file>` (Vitest passthrough). Full suite: `yarn workspace ask-gemini-mcp run test`. Lint: `yarn lint`.

---

## Task 1: Constants (patterns, cutoff, message, marker)

**Files:**
- Modify: `packages/gemini-mcp/src/constants.ts` (after `WORKSPACE_TRUST_PATTERNS`, `:5`, and inside `ERROR_MESSAGES`, `:7-15`)
- Test: `packages/gemini-mcp/src/__tests__/tier-guidance.test.ts` (structural assertions; created here, reused in Task 2)

- [ ] **Step 1: Write the failing structural test**

Create `packages/gemini-mcp/src/__tests__/tier-guidance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ERROR_MESSAGES,
  GEMINI_TIER_CUTOFF_DEFAULT,
  OPERATIONAL_PATTERNS,
  TIER_ACCESS_PATTERNS,
  TIER_NOTE_MARKER,
} from "../constants.js";

describe("tier-discontinuation constants", () => {
  it("cutoff default is an explicit UTC instant", () => {
    expect(GEMINI_TIER_CUTOFF_DEFAULT).toBe("2026-06-18T00:00:00Z");
    expect(Number.isNaN(new Date(GEMINI_TIER_CUTOFF_DEFAULT).getTime())).toBe(false);
  });

  it("tier-access patterns prioritize 403 / PERMISSION_DENIED", () => {
    expect(TIER_ACCESS_PATTERNS).toContain("403");
    expect(TIER_ACCESS_PATTERNS).toContain("PERMISSION_DENIED");
  });

  it("operational patterns include timeout signals", () => {
    expect(OPERATIONAL_PATTERNS).toContain("timed out");
  });

  it("the discontinuation message contains the marker, the cutoff date, and the agy caveat", () => {
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toContain(TIER_NOTE_MARKER);
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toContain("2026-06-18");
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toMatch(/does NOT yet support|not yet support/i);
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toMatch(/ask-codex|ask-ollama/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace ask-gemini-mcp run test -- src/__tests__/tier-guidance.test.ts`
Expected: FAIL — `GEMINI_TIER_CUTOFF_DEFAULT`/`TIER_ACCESS_PATTERNS`/… are not exported.

- [ ] **Step 3: Add the constants**

In `packages/gemini-mcp/src/constants.ts`, add after the `WORKSPACE_TRUST_PATTERNS` line (`:5`):

```ts
// #140: Gemini CLI free/Pro/Ultra backend cutoff (2026-06-18). Error classes
// used by the date-gated tier-discontinuation enricher. tierAccess = "your
// account/tier can't use this" (the post-cutoff signature); quota stays the
// narrow Flash-fallback trigger. Loose terms (subscription/Standard/…) are
// matched word-boundary in classifyGeminiCliError and only drive the advisory
// note, never the fallback.
export const TIER_ACCESS_PATTERNS = [
  "403",
  "PERMISSION_DENIED",
  "401",
  "UNAUTHENTICATED",
  "forbidden",
  "unauthorized",
  "not authorized",
  "access denied",
  "does not have access",
  "not permitted",
  "subscription",
  "Code Assist",
  "Standard",
  "Enterprise",
  "billing",
  "not available",
] as const;

export const OPERATIONAL_PATTERNS = [
  "timed out",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "Unexpected token",
  "is not valid JSON",
] as const;

// Explicit UTC instant — NOT new Date("2026-06-18"), which is UTC-midnight and
// can fire June 17 in negative-offset timezones. Override via ASK_GEMINI_TIER_CUTOFF.
export const GEMINI_TIER_CUTOFF_DEFAULT = "2026-06-18T00:00:00Z";

// Stable header used as the prepend marker (idempotency) and the user-facing lead.
export const TIER_NOTE_MARKER = "Gemini CLI tier change (2026-06-18)";
```

Then add to the `ERROR_MESSAGES` object (after `WORKSPACE_TRUST_REQUIRED`, before the closing `}`):

```ts
  TIER_DISCONTINUED:
    "⚠️ Gemini CLI tier change (2026-06-18): Google stopped serving Gemini CLI requests for free, Google AI Pro, and Ultra accounts on 2026-06-18; only Gemini Code Assist Standard/Enterprise seats remain supported. If you are on a free/Pro/Ultra account, the error below is LIKELY caused by that change (it can also be a genuine auth, billing, or quota error). Options: (a) upgrade to Gemini Code Assist Standard/Enterprise; (b) switch providers — use ask-codex or ask-ollama; (c) Google's successor is the separate Antigravity CLI (`agy`), which ask-gemini-mcp does NOT yet support — run `agy` directly or use one of the above. The npm package still installs and launches, so reinstalling will not help. See https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace ask-gemini-mcp run test -- src/__tests__/tier-guidance.test.ts`
Expected: PASS — 4 constant tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/gemini-mcp/src/constants.ts packages/gemini-mcp/src/__tests__/tier-guidance.test.ts
git commit -m "feat(gemini): tier-discontinuation constants + patterns (#140)"
```

---

## Task 2: Pure `tierGuidance.ts` module (classifier + cutoff + formatter)

**Files:**
- Create: `packages/gemini-mcp/src/utils/tierGuidance.ts`
- Test: `packages/gemini-mcp/src/__tests__/tier-guidance.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `packages/gemini-mcp/src/__tests__/tier-guidance.test.ts`:

```ts
import {
  classifyGeminiCliError,
  formatTierNote,
  resolveTierCutoff,
} from "../utils/tierGuidance.js";

const POST = new Date("2027-01-01T00:00:00Z"); // after cutoff
const PRE = new Date("2026-01-01T00:00:00Z"); // before cutoff
const CUTOFF = new Date(GEMINI_TIER_CUTOFF_DEFAULT);

describe("classifyGeminiCliError", () => {
  it("classifies workspace-trust", () => {
    expect(classifyGeminiCliError("FatalUntrustedWorkspaceError: nope")).toBe("workspaceTrust");
  });
  it("classifies quota (RESOURCE_EXHAUSTED)", () => {
    expect(classifyGeminiCliError("status RESOURCE_EXHAUSTED")).toBe("quota");
  });
  it("classifies tierAccess for 403 / PERMISSION_DENIED", () => {
    expect(classifyGeminiCliError("code 403 forbidden")).toBe("tierAccess");
    expect(classifyGeminiCliError("PERMISSION_DENIED: not allowed")).toBe("tierAccess");
  });
  it("classifies operational for timeouts/parse", () => {
    expect(classifyGeminiCliError("Command timed out after 800000ms")).toBe("operational");
  });
  it("does not false-match loose terms inside other words (word boundary)", () => {
    // "frontier" must not match the "tier"-class via a stray substring
    expect(classifyGeminiCliError("explored the frontier of parsing")).toBe("unknown");
  });
});

describe("resolveTierCutoff", () => {
  const KEY = "ASK_GEMINI_TIER_CUTOFF";
  afterEach(() => {
    delete process.env[KEY];
  });
  it("defaults to the UTC constant", () => {
    expect(resolveTierCutoff().toISOString()).toBe(new Date(GEMINI_TIER_CUTOFF_DEFAULT).toISOString());
  });
  it("honors a valid override", () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    expect(resolveTierCutoff().toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });
  it("falls back to default on an invalid override", () => {
    process.env[KEY] = "not-a-date";
    expect(resolveTierCutoff().toISOString()).toBe(new Date(GEMINI_TIER_CUTOFF_DEFAULT).toISOString());
  });
});

describe("formatTierNote", () => {
  it("pre-cutoff: returns the message unchanged even for tierAccess/quota", () => {
    expect(formatTierNote("403 forbidden", "tierAccess", PRE, CUTOFF)).toBe("403 forbidden");
    expect(formatTierNote("RESOURCE_EXHAUSTED", "quota", PRE, CUTOFF)).toBe("RESOURCE_EXHAUSTED");
  });
  it("post-cutoff + tierAccess: PREPENDS the note", () => {
    const out = formatTierNote("403 forbidden", "tierAccess", POST, CUTOFF);
    expect(out.startsWith("⚠️")).toBe(true);
    expect(out).toContain(TIER_NOTE_MARKER);
    expect(out).toContain("403 forbidden"); // raw error preserved below
    expect(out.indexOf(TIER_NOTE_MARKER)).toBeLessThan(out.indexOf("403 forbidden"));
  });
  it("post-cutoff + quota: PREPENDS the note", () => {
    expect(formatTierNote("RESOURCE_EXHAUSTED", "quota", POST, CUTOFF)).toContain(TIER_NOTE_MARKER);
  });
  it("post-cutoff + operational: unchanged (no note)", () => {
    expect(formatTierNote("Command timed out", "operational", POST, CUTOFF)).toBe("Command timed out");
  });
  it("is idempotent (no double prepend)", () => {
    const once = formatTierNote("403", "tierAccess", POST, CUTOFF);
    const twice = formatTierNote(once, "tierAccess", POST, CUTOFF);
    expect(twice).toBe(once);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace ask-gemini-mcp run test -- src/__tests__/tier-guidance.test.ts`
Expected: FAIL — `Cannot find module '../utils/tierGuidance.js'`.

- [ ] **Step 3: Write the module**

Create `packages/gemini-mcp/src/utils/tierGuidance.ts`:

```ts
// Date-gated tier-discontinuation guidance for the 2026-06-18 Gemini CLI
// free/Pro/Ultra cutoff (#140, design 2026-06-05). Pure + total: no executor
// deps, no I/O beyond reading ASK_GEMINI_TIER_CUTOFF. The classifier runs on a
// RAW single error string; the formatter is gated on date + class and prepends
// the note. See ERROR_MESSAGES.TIER_DISCONTINUED.

import {
  ERROR_MESSAGES,
  GEMINI_TIER_CUTOFF_DEFAULT,
  OPERATIONAL_PATTERNS,
  QUOTA_PATTERNS,
  TIER_ACCESS_PATTERNS,
  TIER_NOTE_MARKER,
  WORKSPACE_TRUST_PATTERNS,
} from "../constants.js";

export type GeminiErrorClass = "workspaceTrust" | "quota" | "tierAccess" | "operational" | "unknown";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word-boundary, case-insensitive match — so loose terms ("tier", "plan",
// "401") don't match mid-word ("frontier", "1401").
function matchesAny(message: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => new RegExp(`\\b${escapeRegex(p)}\\b`, "i").test(message));
}

// Classify a RAW single error string. Order: most-specific first. quota stays
// the narrow Flash-fallback class; tierAccess is the post-cutoff signature.
export function classifyGeminiCliError(raw: string): GeminiErrorClass {
  if (!raw) return "unknown";
  if (matchesAny(raw, WORKSPACE_TRUST_PATTERNS)) return "workspaceTrust";
  if (matchesAny(raw, QUOTA_PATTERNS)) return "quota";
  if (matchesAny(raw, TIER_ACCESS_PATTERNS)) return "tierAccess";
  if (matchesAny(raw, OPERATIONAL_PATTERNS)) return "operational";
  return "unknown";
}

// Resolve the cutoff: ASK_GEMINI_TIER_CUTOFF override (invalid → default).
export function resolveTierCutoff(): Date {
  const raw = process.env.ASK_GEMINI_TIER_CUTOFF;
  const candidate = raw ? new Date(raw) : new Date(GEMINI_TIER_CUTOFF_DEFAULT);
  return Number.isNaN(candidate.getTime()) ? new Date(GEMINI_TIER_CUTOFF_DEFAULT) : candidate;
}

// Pure formatter. Prepends the tier note iff now ≥ cutoff AND the class is
// quota/tierAccess AND the marker isn't already present. Otherwise unchanged.
export function formatTierNote(
  message: string,
  classification: GeminiErrorClass,
  now: Date,
  cutoff: Date,
): string {
  if (now.getTime() < cutoff.getTime()) return message;
  if (classification !== "quota" && classification !== "tierAccess") return message;
  if (message.includes(TIER_NOTE_MARKER)) return message;
  return `${ERROR_MESSAGES.TIER_DISCONTINUED}\n\n--- technical details ---\n${message}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace ask-gemini-mcp run test -- src/__tests__/tier-guidance.test.ts`
Expected: PASS — all classifier/cutoff/formatter tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/gemini-mcp/src/utils/tierGuidance.ts packages/gemini-mcp/src/__tests__/tier-guidance.test.ts
git commit -m "feat(gemini): pure tier-guidance classifier + formatter (#140)"
```

---

## Task 3: Wire enrichment into the executor catch block

**Files:**
- Modify: `packages/gemini-mcp/src/utils/geminiExecutor.ts` (imports; `:584` fallback-fail throw; `:587` else throw)
- Test: `packages/gemini-mcp/src/__tests__/tier-executor.test.ts` (create)

- [ ] **Step 1: Write the failing executor tests**

Create `packages/gemini-mcp/src/__tests__/tier-executor.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock only executeCommand from the shared package; keep everything else real.
vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return { ...actual, executeCommand: vi.fn() };
});

import { executeCommand } from "@ask-llm/shared";
import { TIER_NOTE_MARKER } from "../constants.js";
import { executeGeminiCLI } from "../utils/geminiExecutor.js";

const mockExec = vi.mocked(executeCommand);
const KEY = "ASK_GEMINI_TIER_CUTOFF";

function quotaError() {
  return new Error("ApiError: status RESOURCE_EXHAUSTED — quota exhausted");
}
function authError() {
  return new Error("GaxiosError: 403 PERMISSION_DENIED — caller does not have permission");
}
function timeoutError() {
  return new Error("Command timed out after 800000ms");
}

describe("executeGeminiCLI tier enrichment (#140)", () => {
  beforeEach(() => {
    mockExec.mockReset();
  });
  afterEach(() => {
    delete process.env[KEY];
  });

  it("pre-cutoff quota still triggers the Flash fallback (unchanged)", async () => {
    process.env[KEY] = "2099-01-01T00:00:00Z"; // pre-cutoff
    mockExec.mockRejectedValueOnce(quotaError()); // Pro
    mockExec.mockRejectedValueOnce(quotaError()); // Flash
    await expect(executeGeminiCLI({ prompt: "hi" })).rejects.toThrow(/fallback also failed/);
    expect(mockExec).toHaveBeenCalledTimes(2); // Pro + Flash
  });

  it("post-cutoff: Pro quota + Flash quota → note appears once, after Flash retry", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z"; // post-cutoff
    mockExec.mockRejectedValueOnce(quotaError()); // Pro
    mockExec.mockRejectedValueOnce(quotaError()); // Flash
    await expect(executeGeminiCLI({ prompt: "hi" })).rejects.toThrow(new RegExp(TIER_NOTE_MARKER));
    expect(mockExec).toHaveBeenCalledTimes(2);
    // idempotent — marker present exactly once
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message.split(TIER_NOTE_MARKER).length - 1).toBe(1);
  });

  it("post-cutoff: Pro quota + Flash TIMEOUT → no note (operational Flash failure)", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    mockExec.mockRejectedValueOnce(quotaError()); // Pro
    mockExec.mockRejectedValueOnce(timeoutError()); // Flash
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message).not.toContain(TIER_NOTE_MARKER);
  });

  it("post-cutoff: raw auth (403) → note AND no Flash fallback invoked", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    mockExec.mockRejectedValueOnce(authError()); // Pro (auth, not quota)
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message).toContain(TIER_NOTE_MARKER);
    expect(mockExec).toHaveBeenCalledTimes(1); // NO Flash retry for auth
  });

  it("post-cutoff: raw timeout → no note", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    mockExec.mockRejectedValueOnce(timeoutError()); // Pro
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message).not.toContain(TIER_NOTE_MARKER);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it("workspace-trust error is unchanged even post-cutoff (no note, no Flash retry)", async () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    mockExec.mockRejectedValueOnce(
      new Error("FatalUntrustedWorkspaceError: not running in a trusted directory"),
    );
    const err = await executeGeminiCLI({ prompt: "hi" }).catch((e) => e as Error);
    expect(err.message).toMatch(/workspace-trust/i); // ERROR_MESSAGES.WORKSPACE_TRUST_REQUIRED
    expect(err.message).not.toContain(TIER_NOTE_MARKER);
    expect(mockExec).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace ask-gemini-mcp run test -- src/__tests__/tier-executor.test.ts`
Expected: FAIL — the post-cutoff cases don't find `TIER_NOTE_MARKER` (enrichment not wired yet); the auth case still calls Flash or lacks the note.

- [ ] **Step 3: Add the import**

In `packages/gemini-mcp/src/utils/geminiExecutor.ts`, add to the imports (near the other `./` util imports):

```ts
import { classifyGeminiCliError, formatTierNote, resolveTierCutoff } from "./tierGuidance.js";
```

- [ ] **Step 4: Enrich the `:584` fallback-failure throw**

Replace the fallback `catch (fallbackError)` block body (currently `:582-585`):

```ts
      } catch (fallbackError) {
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(`${MODELS.PRO} quota exceeded, ${MODELS.FLASH} fallback also failed: ${fallbackErrorMessage}`);
      }
```

with:

```ts
      } catch (fallbackError) {
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        // Pro is quota by construction here; discriminate on the Flash failure
        // class so a transient Flash timeout doesn't masquerade as tier death.
        const composed = `${MODELS.PRO} quota exceeded, ${MODELS.FLASH} fallback also failed: ${fallbackErrorMessage}`;
        const flashClass = classifyGeminiCliError(fallbackErrorMessage);
        throw new Error(formatTierNote(composed, flashClass, new Date(), resolveTierCutoff()));
      }
```

- [ ] **Step 5: Enrich the `:587` else throw**

Replace the trailing `else { throw error; }` of the outer catch (currently `:586-588`):

```ts
    } else {
      throw error;
    }
```

with:

```ts
    } else {
      // Non-quota, non-trust errors (incl. raw 401/403 auth) land here with no
      // Flash retry. Enrich only when the date+class gate adds a note; otherwise
      // re-throw the original error untouched.
      const enriched = formatTierNote(
        errorMessage,
        classifyGeminiCliError(errorMessage),
        new Date(),
        resolveTierCutoff(),
      );
      if (enriched !== errorMessage) throw new Error(enriched);
      throw error;
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `yarn workspace ask-gemini-mcp run test -- src/__tests__/tier-executor.test.ts`
Expected: PASS — all 5 executor cases green (note once; Flash-timeout → no note; auth → note + no Flash retry; etc.).

- [ ] **Step 7: Run the full gemini-mcp suite (no regressions)**

Run: `yarn workspace ask-gemini-mcp run test`
Expected: PASS — new tests green, existing non-SMOKE tests unaffected (SMOKE tests skip without `SMOKE_TEST`).

- [ ] **Step 8: Commit**

```bash
git add packages/gemini-mcp/src/utils/geminiExecutor.ts packages/gemini-mcp/src/__tests__/tier-executor.test.ts
git commit -m "feat(gemini): date-gated tier-discontinuation enrichment in executor catch (#140)"
```

---

## Task 4: Docs (README + provider doc + CHANGELOG)

**Files:**
- Modify: `README.md`, `apps/docs/providers/gemini.md`, `packages/gemini-mcp/CHANGELOG.md`

- [ ] **Step 1: README banner**

Add a short callout to `README.md` near the Gemini install/usage section:

```markdown
> **⚠️ Gemini CLI tier change (2026-06-18):** Google stopped serving Gemini CLI requests for free, Pro, and Ultra accounts on 2026-06-18 — only **Gemini Code Assist Standard/Enterprise** seats keep working. `ask-gemini-mcp` still installs and launches (the failure is account/backend access, so reinstalling won't help); on a non-enterprise account it surfaces guidance instead of a raw error. Google's successor, **Antigravity CLI (`agy`)**, is a separate tool this MCP server does **not** support yet. Free/Pro users can switch to [`ask-codex`](packages/codex-mcp) or [`ask-ollama`](packages/ollama-mcp). [Announcement](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/).
```

- [ ] **Step 2: Provider doc**

Add the same substance (expanded) to `apps/docs/providers/gemini.md` under a `## 2026-06-18 tier change` heading: the cutoff, enterprise-only continuation, the `ASK_GEMINI_TIER_CUTOFF` override (for testing), and that Antigravity is a separate migration path, not a drop-in.

- [ ] **Step 3: CHANGELOG**

Add to `packages/gemini-mcp/CHANGELOG.md` (top, under a new patch version heading):

```markdown
### Patch

- Surface actionable, date-gated guidance when Gemini CLI's backend stops
  serving free/Pro/Ultra accounts (2026-06-18 cutoff, #140). Classifies the
  raw auth/quota error and prepends a tier-discontinuation notice; the
  Flash-fallback control flow is unchanged. Override the cutoff for testing
  via `ASK_GEMINI_TIER_CUTOFF`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md apps/docs/providers/gemini.md packages/gemini-mcp/CHANGELOG.md
git commit -m "docs(gemini): 2026-06-18 tier-change banner + provider doc + changelog (#140)"
```

---

## Task 5: Verify, record, ship

**Files:**
- Modify: `docs/DECISIONS.md`, `docs/ROADMAP.md`, `docs/BUGS.md`

- [ ] **Step 1: Full gate (build + lint + test)**

Run: `yarn build && yarn lint && yarn workspace ask-gemini-mcp run test`
Expected: build clean; Biome + tsc clean; tests green. If Biome flags import order, run `npx @biomejs/biome check --write packages/gemini-mcp/src/` and re-run.

- [ ] **Step 2: Verification — tests are the gate; env override is the documented lever**

A live cutoff test is impossible (we can't make Google return a 403 on demand), so the **authoritative verification is the executor catch-flow suite from Task 3**, which simulates each error class deterministically via `vi.mock`. Re-confirm it:

Run: `yarn workspace ask-gemini-mcp run test -- src/__tests__/tier-executor.test.ts`
Expected: PASS (all 6 cases, incl. auth→note+no-Flash and Flash-timeout→no-note).

Document the manual lever in the same step (do **not** assert a specific live result — the live error class is uncontrollable): post-cutoff, set `ASK_GEMINI_TIER_CUTOFF` to a past instant to force gating on, then any auth/quota-class gemini failure prepends the notice. Note for the record that during this session the live CLI returned Pro `429 RESOURCE_EXHAUSTED` → Flash `404` (`unknown` class) → composed error with **no** note — i.e. the live env exercises the "Flash failed operationally → no note" branch, which is correct behavior, not a regression.

- [ ] **Step 3: ADR-113**

Prepend to `docs/DECISIONS.md`:

```markdown
## ADR-113: Gemini Tier-Discontinuation Guidance — Date-Gated, Class-Based Enricher (#140 P0)

- **Date:** 2026-06-05
- **Status:** Accepted (branch `feat/gemini-tier-discontinuation`, #140 P0).
- **Context:** Gemini CLI stops serving free/Pro/Ultra accounts on 2026-06-18 (verified: Google Developers Blog); enterprise exempt; the successor is a separate closed-source `agy` binary. `ask-gemini-mcp` wraps the `gemini` subprocess, so the dominant post-cutoff failure is a runtime auth/quota error. The exact error string is unknown until 2026-06-19.
- **Decision:** A date-gated, class-based terminal-error enricher. A pure `classifyGeminiCliError` (raw error → workspaceTrust|quota|tierAccess|operational|unknown) + a pure `formatTierNote` that prepends a hedged notice when `now ≥ 2026-06-18T00:00:00Z` (UTC, `ASK_GEMINI_TIER_CUTOFF`-overridable) and the class is quota/tierAccess. Wired at the executor's two terminal throws (Flash-error class at the fallback-fail site; raw-error class at the else site). The narrow `QUOTA_PATTERNS` Flash-fallback trigger is untouched, so auth errors enrich with no wasted Flash call and enterprise quota→Flash is preserved. Note is prepended (not appended) and idempotent. P1 (Antigravity `agy` provider, CI pin) + P2 deferred.
- **Consequences:** Closes #140 P0. Dual external review (Codex + Gemini, both "ship with changes") shaped the design: classify raw errors not the composed fallback string (avoids a "quota" false-positive); prioritize 403/PERMISSION_DENIED; prepend for visibility; explicit `agy`-not-supported wording. Loose tier terms (subscription/Standard/…) can over-match a genuine enterprise error post-cutoff, mitigated by date-gating + hedged "likely caused by" wording. Verified by pure-unit + executor catch-flow (`vi.mock`) tests; no live cutoff test is possible (env override is the manual gate).
```

- [ ] **Step 4: ROADMAP + BUGS (side-finding)**

- `docs/ROADMAP.md`: add a 2026-06-05 entry for #140 P0 (date-gated tier guidance; P1/P2 deferred).
- `docs/BUGS.md`: add the **Flash-404 side-finding** under Open — `gemini-3.5-flash` (the configured `MODELS.FLASH`) returned `404 ModelNotFoundError` on gemini-cli 0.44.1 during the 2026-06-05 session, while `CLAUDE.md` documents `gemini-3-flash-preview`; **needs verification (may be account/tier-specific) before treating as a fallback-model misconfiguration**, tracked separately from #140.

- [ ] **Step 5: Commit + push + PR**

```bash
git add docs/DECISIONS.md docs/ROADMAP.md docs/BUGS.md
git commit -m "docs: ADR-113 + roadmap/bugs for gemini tier-discontinuation (#140)"
git push -u origin feat/gemini-tier-discontinuation
gh pr create --title "feat(gemini): date-gated tier-discontinuation guidance (#140 P0)" \
  --body "Closes #140 (P0). Date-gated, class-based terminal-error enricher for the 2026-06-18 Gemini CLI free/Pro/Ultra cutoff. Dual-reviewed (Codex + Gemini). Design: docs/plans/2026-06-05-gemini-tier-discontinuation-design.md; ADR-113."
```

---

## Self-Review

**1. Spec coverage:**
- Date-gated heuristic → Task 1 (cutoff const) + Task 2 (`resolveTierCutoff`, `formatTierNote` gate).
- Keep Flash fallback; narrow trigger → Task 3 leaves `isQuotaError` untouched; auth → no Flash (Task 3 test asserts call count 1).
- Classify-from-format on raw errors → Task 2 (`classifyGeminiCliError`) + Task 3 (`:584` uses Flash-error class, `:587` raw).
- Prepend + idempotent → Task 2 (`formatTierNote` prepends, marker check) + tests.
- Hedged + `agy`-not-supported + UTC + env override → Task 1 (message), Task 2 (cutoff), tests.
- Broadened 403/PERMISSION_DENIED patterns, word-boundary → Task 1 + Task 2 (word-boundary test).
- Executor integration tests → Task 3 has 6 concrete cases: workspace-trust unchanged (no note, no Flash), pre-cutoff quota Flash-fallback, post Pro-quota+Flash-quota note-once, post Pro-quota+Flash-timeout no-note, post raw-auth note+no-Flash, post raw-timeout no-note. Plus env override (used throughout) and invalid env (Task 2 unit). Docs caveats → Task 4.
- Out-of-scope (Antigravity provider, CI pin, degraded-probe, sponsorship, Flash-404) → fenced; Flash-404 → Task 5 BUGS.

**2. Placeholder scan:** No TBD/TODO; every code + test step is complete; commands have expected output.

**3. Type/name consistency:** `classifyGeminiCliError`, `resolveTierCutoff`, `formatTierNote`, `GeminiErrorClass` ('workspaceTrust'|'quota'|'tierAccess'|'operational'|'unknown'), `TIER_NOTE_MARKER`, `GEMINI_TIER_CUTOFF_DEFAULT`, `TIER_ACCESS_PATTERNS`, `OPERATIONAL_PATTERNS`, `ERROR_MESSAGES.TIER_DISCONTINUED`, env key `ASK_GEMINI_TIER_CUTOFF` are used identically across Tasks 1–3 and the tests.

**Known assumption to verify during execution:** that `vi.mock("@ask-llm/shared", { ...actual, executeCommand })` correctly intercepts the executor's `executeCommand` import under this monorepo's Vitest/ESM resolution. If the spread-actual mock misbehaves (e.g. `importOriginal` typing), fall back to `vi.mock("@ask-llm/shared")` + re-export real symbols explicitly. Confirm at Task 3 Step 2 (the RED run must fail for the *right* reason — missing note — not a mock-resolution error).
