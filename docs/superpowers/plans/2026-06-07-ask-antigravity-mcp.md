# ask-antigravity-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new experimental `ask-antigravity-mcp` provider package that lets Claude get a subscription-backed second opinion from Google's Antigravity CLI (`agy`), wired into the `ask-llm-mcp` orchestrator.

**Architecture:** `agy`'s headless `-p` mode does not print to stdout (gemini-cli #27466) and has no JSON output or capturable session id, so the executor uses **Approach B**: a "response source" chain `[stdout-json, stdout-plain, transcript-scrape]` (first non-null wins) that self-heals onto stdout when upstream is fixed. All fragile transcript-file reading is isolated in `transcriptReader.ts`. Calls are serialized by an in-process mutex (correctness: concurrent `agy` runs race on shared state files). The package mirrors `packages/codex-mcp` and registers in the orchestrator gated on `isCommandAvailable('agy')`.

**Tech Stack:** TypeScript (ES2022, Node16 ESM), Yarn workspaces, `@modelcontextprotocol/sdk`, Zod v4, Vitest, Biome. Shared code via `@ask-llm/shared` (`executeCommand`, `resolveTimeoutMs`, `registerTools`, `Logger`, `askResponseSchema`).

**Spec:** `docs/superpowers/specs/2026-06-07-ask-antigravity-mcp-design.md` (ADR-114).

---

## File Structure

**Create (new package `packages/antigravity-mcp/`):**
- `package.json` — npm `ask-antigravity-mcp`, `./executor` + `./register` exports, bin, `@ask-llm/shared` dep
- `tsconfig.json` — extends base, references `../shared`
- `README.md` — experimental note
- `src/constants.ts` — CLI flags, env vars, paths, error/status messages, read-only preamble
- `src/utils/transcriptReader.ts` — isolated transcript file scraping (`readLatestResponse`)
- `src/utils/antigravityExecutor.ts` — buildArgs, response-source chain, mutex, error classification
- `src/tools/ask-antigravity.tool.ts` — the core tool
- `src/tools/simple-tools.ts` — `ping`
- `src/tools/index.ts` — registry push
- `src/index.ts` — MCP server
- `src/cli.ts` — bin entry
- `src/utils/__tests__/transcriptReader.test.ts`
- `src/utils/__tests__/antigravityExecutor.test.ts`
- `src/__tests__/smoke.test.ts`

**Modify:**
- `packages/shared/src/askResponse.ts` — add `"antigravity"` to both provider enums
- `packages/llm-mcp/src/constants.ts` — add `antigravity` provider + install hint
- `packages/llm-mcp/src/index.ts:191` — extend the provider cast
- `packages/llm-mcp/package.json` — add `ask-antigravity-mcp` workspace dep
- `tsconfig.json` (root) — add `packages/antigravity-mcp` reference

---

## Task 1: Scaffold the package

**Files:**
- Create: `packages/antigravity-mcp/package.json`
- Create: `packages/antigravity-mcp/tsconfig.json`
- Create: `packages/antigravity-mcp/README.md`
- Modify: `tsconfig.json` (root) — add reference

- [ ] **Step 1: Create `packages/antigravity-mcp/package.json`**

```json
{
  "name": "ask-antigravity-mcp",
  "version": "0.0.1",
  "mcpName": "io.github.Lykhoyda/ask-antigravity",
  "description": "EXPERIMENTAL MCP server for Google's Antigravity CLI (agy) — subscription-backed second opinions",
  "type": "module",
  "main": "dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./executor": {
      "types": "./dist/utils/antigravityExecutor.d.ts",
      "default": "./dist/utils/antigravityExecutor.js"
    },
    "./register": "./dist/tools/index.js"
  },
  "bin": "dist/cli.js",
  "scripts": {
    "build": "tsc -b",
    "start": "node dist/cli.js",
    "dev": "tsc -b && node dist/cli.js",
    "test": "vitest run",
    "lint": "biome check src/ && tsc --noEmit",
    "prepack": "node ../../scripts/prepack-bundle.mjs shared",
    "postpack": "node ../../scripts/postpack-restore.mjs shared"
  },
  "keywords": ["mcp", "mcp-server", "modelcontextprotocol", "antigravity", "agy", "google", "gemini", "claude", "ai", "ai-collaboration", "second-opinion"],
  "author": "Lykhoyda",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/Lykhoyda/ask-llm.git",
    "directory": "packages/antigravity-mcp"
  },
  "bugs": { "url": "https://github.com/Lykhoyda/ask-llm/issues" },
  "homepage": "https://github.com/Lykhoyda/ask-llm#readme",
  "engines": { "node": ">=20.0.0" },
  "files": ["dist/", "README.md", "LICENSE"],
  "dependencies": {
    "@ask-llm/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.27.1",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.4",
    "@types/node": "^22.19.13",
    "typescript": "^5.0.0",
    "vitest": "^4.0.18"
  },
  "publishConfig": { "access": "public" },
  "bundledDependencies": ["@ask-llm/shared"]
}
```

- [ ] **Step 2: Create `packages/antigravity-mcp/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/**/__tests__"],
  "references": [
    { "path": "../shared" }
  ]
}
```

- [ ] **Step 3: Create `packages/antigravity-mcp/README.md`**

```markdown
# ask-antigravity-mcp (EXPERIMENTAL)

MCP server for Google's Antigravity CLI (`agy`). Lets Claude get a
subscription-backed second opinion / code review from Antigravity.

> **Experimental.** `agy`'s headless `-p` mode does not reliably print to stdout
> (gemini-cli #27466) and exposes no JSON output or session id. This server reads
> `agy`'s internal transcript files as a fallback, so it is sensitive to changes
> in `agy`'s on-disk layout. One-shot only: no model selection, no multi-turn.

## Prerequisites
- `agy` installed and on PATH, and logged in once (run `agy` interactively).

## Config
- `ASK_ANTIGRAVITY_TIMEOUT_MS` — process timeout (default 300000 = 5m).
- `ASK_ANTIGRAVITY_SANDBOX` — set `0` to drop `--sandbox` if it blocks context reads.
```

- [ ] **Step 4: Add the package to the root `tsconfig.json` references**

Modify `tsconfig.json` (root) — add the new reference to the `references` array:

```json
{
  "files": [],
  "references": [
    { "path": "packages/shared" },
    { "path": "packages/gemini-mcp" },
    { "path": "packages/claude-plugin" },
    { "path": "packages/codex-mcp" },
    { "path": "packages/ollama-mcp" },
    { "path": "packages/antigravity-mcp" },
    { "path": "packages/llm-mcp" }
  ]
}
```

- [ ] **Step 5: Install workspace + verify it resolves**

Run: `yarn install`
Expected: completes; `ask-antigravity-mcp` is recognized as a workspace (no errors).

- [ ] **Step 6: Commit**

```bash
git add packages/antigravity-mcp/package.json packages/antigravity-mcp/tsconfig.json packages/antigravity-mcp/README.md tsconfig.json
git commit -m "feat(antigravity): scaffold ask-antigravity-mcp package

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Constants

**Files:**
- Create: `packages/antigravity-mcp/src/constants.ts`

- [ ] **Step 1: Create `packages/antigravity-mcp/src/constants.ts`**

```ts
export const ERROR_MESSAGES = {
  NO_PROMPT_PROVIDED:
    "Please provide a prompt for analysis. Ask a question or describe the code you want a second opinion on.",
  NO_OUTPUT:
    "Antigravity (agy) ran but produced no readable response. Most likely you are not logged in (run `agy` once interactively to authenticate), or agy's transcript output path/schema changed (this experimental provider may need an update). agy's headless `-p` mode is known to not print to stdout (gemini-cli #27466), so ask-antigravity-mcp reads agy's transcript files instead.",
  RATE_LIMITED:
    "Antigravity (agy) hit a subscription rate limit. Google AI Pro/Ultra quotas refresh roughly every 5 hours — wait and retry, or use ask-codex / ask-gemini in the meantime.",
  TOOL_NOT_FOUND: "not found in registry",
} as const;

export const STATUS_MESSAGES = {
  ANTIGRAVITY_RESPONSE: "Antigravity response:",
} as const;

// Prepended to every prompt. ask-antigravity is a read-only "second opinion"
// tool, but agy is an agent that can act. We run with --dangerously-skip-permissions
// (required to avoid headless approval-prompt hangs) + --sandbox, and additionally
// instruct the model not to modify anything. See spec §6.
export const READ_ONLY_PREAMBLE =
  "You are giving a second opinion / code review. Read and reason only. Do NOT modify, create, or delete files, and do NOT run commands — just analyze and respond.";

export const CLI = {
  COMMANDS: {
    AGY: "agy",
  },
  FLAGS: {
    PRINT: "-p",
    ADD_DIR: "--add-dir",
    PRINT_TIMEOUT: "--print-timeout",
    SKIP_PERMISSIONS: "--dangerously-skip-permissions",
    SANDBOX: "--sandbox",
  },
} as const;

export const ANTIGRAVITY = {
  TIMEOUT_ENV_VAR: "ASK_ANTIGRAVITY_TIMEOUT_MS",
  // agy's --print-timeout defaults to 5m; mirror that as our process timeout.
  DEFAULT_TIMEOUT_MS: 300_000,
  SANDBOX_ENV_VAR: "ASK_ANTIGRAVITY_SANDBOX",
  // Lowercased substrings; isRateLimitError() lowercases the message first.
  RATE_LIMIT_SIGNALS: ["rate limit", "rate_limit", "resource_exhausted", "quota", "429", "too many requests"],
} as const;
```

- [ ] **Step 2: Verify it type-checks**

Run: `yarn workspace ask-antigravity-mcp run lint`
Expected: PASS (Biome clean; `tsc --noEmit` no errors). Note: this builds `@ask-llm/shared` first via project refs.

- [ ] **Step 3: Commit**

```bash
git add packages/antigravity-mcp/src/constants.ts
git commit -m "feat(antigravity): add constants (CLI flags, env vars, messages)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: transcriptReader (TDD)

**Files:**
- Create: `packages/antigravity-mcp/src/utils/transcriptReader.ts`
- Test: `packages/antigravity-mcp/src/utils/__tests__/transcriptReader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/antigravity-mcp/src/utils/__tests__/transcriptReader.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readLatestResponse } from "../transcriptReader.js";

let baseDir: string;

function writeTranscript(convId: string, lines: object[]): string {
  const dir = join(baseDir, "brain", convId, ".system_generated", "logs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "transcript.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  return join(baseDir, "brain", convId);
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "agy-test-"));
});
afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("readLatestResponse", () => {
  it("returns the last MODEL/DONE/PLANNER_RESPONSE text", () => {
    writeTranscript("conv1", [
      { source: "MODEL", status: "RUNNING", type: "PLANNER_RESPONSE", text: "partial" },
      { source: "USER", status: "DONE", type: "USER_MESSAGE", text: "the question" },
      { source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "first answer" },
      { source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "final answer" },
    ]);
    expect(readLatestResponse(0, baseDir)).toBe("final answer");
  });

  it("returns null when the transcript dir is missing", () => {
    expect(readLatestResponse(0, baseDir)).toBeNull();
  });

  it("returns null when no DONE model entry exists (schema change)", () => {
    writeTranscript("conv1", [{ source: "MODEL", status: "RUNNING", type: "PLANNER_RESPONSE", text: "x" }]);
    expect(readLatestResponse(0, baseDir)).toBeNull();
  });

  it("returns null for a .db-only conversation dir (future agy format)", () => {
    const dir = join(baseDir, "brain", "conv1", ".system_generated", "logs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "transcript.db"), "binary");
    expect(readLatestResponse(0, baseDir)).toBeNull();
  });

  it("uses the id from cache/last_conversations.json when present", () => {
    writeTranscript("convA", [{ source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "A answer" }]);
    writeTranscript("convB", [{ source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "B answer" }]);
    mkdirSync(join(baseDir, "cache"), { recursive: true });
    writeFileSync(join(baseDir, "cache", "last_conversations.json"), JSON.stringify(["convB"]));
    expect(readLatestResponse(0, baseDir)).toBe("B answer");
  });

  it("falls back to the newest brain dir modified since the run", () => {
    const oldDir = writeTranscript("old", [
      { source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "old answer" },
    ]);
    const newDir = writeTranscript("new", [
      { source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "new answer" },
    ]);
    utimesSync(oldDir, new Date(1000), new Date(1000));
    utimesSync(newDir, new Date(5000), new Date(5000));
    expect(readLatestResponse(0, baseDir)).toBe("new answer");
  });

  it("ignores brain dirs older than sinceMs", () => {
    const oldDir = writeTranscript("old", [
      { source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "old answer" },
    ]);
    const newDir = writeTranscript("new", [
      { source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "new answer" },
    ]);
    utimesSync(oldDir, new Date(1000), new Date(1000));
    utimesSync(newDir, new Date(5000), new Date(5000));
    // sinceMs=3000 → "old" (mtime 1000) is excluded, "new" (mtime 5000) wins.
    expect(readLatestResponse(3000, baseDir)).toBe("new answer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace ask-antigravity-mcp run test`
Expected: FAIL — cannot resolve `../transcriptReader.js` (module not found).

- [ ] **Step 3: Write `packages/antigravity-mcp/src/utils/transcriptReader.ts`**

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Logger } from "@ask-llm/shared";

export function defaultBaseDir(): string {
  return join(homedir(), ".gemini", "antigravity-cli");
}

interface TranscriptEntry {
  source?: string;
  status?: string;
  type?: string;
  text?: string;
  content?: string;
  message?: string;
}

// last_conversations.json shape is undocumented. Tolerate: array of ids, array
// of {id}, or an object (keyed by id, or with lastId / conversations). Unknown → null.
function pickMostRecentId(parsed: unknown): string | null {
  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1; i >= 0; i--) {
      const el = parsed[i];
      if (typeof el === "string") return el;
      if (el && typeof el === "object" && typeof (el as { id?: unknown }).id === "string") {
        return (el as { id: string }).id;
      }
    }
    return null;
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.lastId === "string") return obj.lastId;
    if (Array.isArray(obj.conversations)) return pickMostRecentId(obj.conversations);
    const keys = Object.keys(obj);
    if (keys.length > 0) return keys[keys.length - 1];
  }
  return null;
}

// Resolve the conversation id of the run we just triggered: prefer agy's
// cache/last_conversations.json; else the newest brain/<id> modified at/after sinceMs.
function resolveConversationId(baseDir: string, sinceMs: number): string | null {
  try {
    const raw = readFileSync(join(baseDir, "cache", "last_conversations.json"), "utf8");
    const id = pickMostRecentId(JSON.parse(raw));
    if (id) return id;
  } catch {
    // fall through to brain-dir scan
  }
  try {
    const brainDir = join(baseDir, "brain");
    let newest: { id: string; mtimeMs: number } | null = null;
    for (const id of readdirSync(brainDir)) {
      let mtimeMs: number;
      try {
        mtimeMs = statSync(join(brainDir, id)).mtimeMs;
      } catch {
        continue;
      }
      // allow 1ms slack for filesystem mtime granularity
      if (mtimeMs + 1 < sinceMs) continue;
      if (!newest || mtimeMs > newest.mtimeMs) newest = { id, mtimeMs };
    }
    return newest?.id ?? null;
  } catch {
    return null;
  }
}

function extractText(entry: TranscriptEntry): string | null {
  const text = entry.text ?? entry.content ?? entry.message;
  return typeof text === "string" && text.length > 0 ? text : null;
}

// Read agy's transcript for the resolved conversation and return the last
// completed model response, or null if absent/unreadable. Never throws.
// NOTE: confirm source/status/type/text field names against a real agy transcript
// (spec §10.2). The chosen values match the community MCP bridge precedent.
export function readLatestResponse(sinceMs: number, baseDir: string = defaultBaseDir()): string | null {
  const convId = resolveConversationId(baseDir, sinceMs);
  if (!convId) {
    Logger.debug("antigravity: could not resolve a conversation id from cache or brain dir");
    return null;
  }
  const transcriptPath = join(baseDir, "brain", convId, ".system_generated", "logs", "transcript.jsonl");
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    Logger.debug(`antigravity: transcript not found at ${transcriptPath}`);
    return null;
  }
  let answer: string | null = null;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(trimmed) as TranscriptEntry;
    } catch {
      continue;
    }
    if (entry.source === "MODEL" && entry.status === "DONE" && entry.type === "PLANNER_RESPONSE") {
      const text = extractText(entry);
      if (text) answer = text; // keep the LAST matching entry
    }
  }
  if (!answer) {
    Logger.debug("antigravity: transcript present but no MODEL/DONE/PLANNER_RESPONSE entry found (schema change?)");
  }
  return answer;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace ask-antigravity-mcp run test`
Expected: PASS (7 tests in transcriptReader.test.ts).

- [ ] **Step 5: Commit**

```bash
git add packages/antigravity-mcp/src/utils/transcriptReader.ts packages/antigravity-mcp/src/utils/__tests__/transcriptReader.test.ts
git commit -m "feat(antigravity): transcript reader with defensive id resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: antigravityExecutor (TDD)

**Files:**
- Create: `packages/antigravity-mcp/src/utils/antigravityExecutor.ts`
- Test: `packages/antigravity-mcp/src/utils/__tests__/antigravityExecutor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/antigravity-mcp/src/utils/__tests__/antigravityExecutor.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY, CLI, ERROR_MESSAGES, READ_ONLY_PREAMBLE } from "../../constants.js";

vi.mock("@ask-llm/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ask-llm/shared")>();
  return {
    ...actual,
    executeCommand: vi.fn(),
    Logger: { warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  };
});

vi.mock("../transcriptReader.js", () => ({
  readLatestResponse: vi.fn(),
}));

import { executeCommand } from "@ask-llm/shared";
import { buildArgs, executeAntigravityCLI } from "../antigravityExecutor.js";
import { readLatestResponse } from "../transcriptReader.js";

const mockExec = vi.mocked(executeCommand);
const mockReadLatest = vi.mocked(readLatestResponse);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[ANTIGRAVITY.SANDBOX_ENV_VAR];
  mockExec.mockResolvedValue("");
  mockReadLatest.mockReturnValue(null);
});

describe("buildArgs", () => {
  it("builds -p, prompt, print-timeout, skip-permissions, sandbox", () => {
    const args = buildArgs("hello", undefined, 295, true);
    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      "hello",
      CLI.FLAGS.PRINT_TIMEOUT,
      "295s",
      CLI.FLAGS.SKIP_PERMISSIONS,
      CLI.FLAGS.SANDBOX,
    ]);
  });

  it("omits sandbox when disabled and repeats --add-dir per includeDir", () => {
    const args = buildArgs("hello", ["/a", "/b"], 100, false);
    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      "hello",
      CLI.FLAGS.ADD_DIR,
      "/a",
      CLI.FLAGS.ADD_DIR,
      "/b",
      CLI.FLAGS.PRINT_TIMEOUT,
      "100s",
      CLI.FLAGS.SKIP_PERMISSIONS,
    ]);
  });
});

describe("executeAntigravityCLI response sources", () => {
  it("uses plain stdout when agy prints (future-proof path)", async () => {
    mockExec.mockResolvedValue("direct answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("direct answer");
    expect(mockReadLatest).not.toHaveBeenCalled();
  });

  it("uses JSON stdout .response when present", async () => {
    mockExec.mockResolvedValue('{"response":"json answer"}');
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("json answer");
    expect(mockReadLatest).not.toHaveBeenCalled();
  });

  it("falls back to transcript scrape when stdout is empty (today's bug)", async () => {
    mockExec.mockResolvedValue("");
    mockReadLatest.mockReturnValue("scraped answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.response).toBe("scraped answer");
    expect(mockReadLatest).toHaveBeenCalledOnce();
    expect(typeof mockReadLatest.mock.calls[0][0]).toBe("number");
  });

  it("throws NO_OUTPUT when stdout is empty and no transcript is found", async () => {
    mockExec.mockResolvedValue("");
    mockReadLatest.mockReturnValue(null);
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.NO_OUTPUT);
  });

  it("returns no sessionId and no usage", async () => {
    mockExec.mockResolvedValue("answer");
    const result = await executeAntigravityCLI({ prompt: "q" });
    expect(result.sessionId).toBeUndefined();
    expect(result.usage).toBeUndefined();
  });
});

describe("executeAntigravityCLI argument wiring", () => {
  it("prepends the read-only preamble to the prompt", async () => {
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "review this" });
    const [, args] = mockExec.mock.calls[0];
    expect(args[0]).toBe(CLI.FLAGS.PRINT);
    expect(args[1]).toContain(READ_ONLY_PREAMBLE);
    expect(args[1]).toContain("review this");
  });

  it("passes includeDirs through as --add-dir", async () => {
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q", includeDirs: ["/pkg/a"] });
    const [, args] = mockExec.mock.calls[0];
    expect(args).toContain(CLI.FLAGS.ADD_DIR);
    expect(args).toContain("/pkg/a");
  });

  it("drops --sandbox when ASK_ANTIGRAVITY_SANDBOX=0", async () => {
    process.env[ANTIGRAVITY.SANDBOX_ENV_VAR] = "0";
    mockExec.mockResolvedValue("answer");
    await executeAntigravityCLI({ prompt: "q" });
    const [, args] = mockExec.mock.calls[0];
    expect(args).not.toContain(CLI.FLAGS.SANDBOX);
  });
});

describe("executeAntigravityCLI error handling", () => {
  it("translates rate-limit errors to the actionable message", async () => {
    mockExec.mockRejectedValue(new Error("RESOURCE_EXHAUSTED: quota"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.RATE_LIMITED);
  });

  it("rethrows non-rate-limit errors unchanged", async () => {
    mockExec.mockRejectedValue(new Error("agy CLI not found on PATH"));
    await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow("agy CLI not found on PATH");
  });
});

describe("executeAntigravityCLI concurrency", () => {
  it("serializes concurrent calls via the mutex", async () => {
    let resolveFirst!: (v: string) => void;
    const first = new Promise<string>((r) => {
      resolveFirst = r;
    });
    mockExec.mockReturnValueOnce(first).mockResolvedValueOnce("second");
    const p1 = executeAntigravityCLI({ prompt: "a" });
    const p2 = executeAntigravityCLI({ prompt: "b" });
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExec).toHaveBeenCalledTimes(1); // second call queued behind the mutex
    resolveFirst("first");
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.response).toBe("first");
    expect(r2.response).toBe("second");
    expect(mockExec).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace ask-antigravity-mcp run test`
Expected: FAIL — cannot resolve `../antigravityExecutor.js`.

- [ ] **Step 3: Write `packages/antigravity-mcp/src/utils/antigravityExecutor.ts`**

```ts
import { EXECUTION, executeCommand, Logger, resolveTimeoutMs } from "@ask-llm/shared";
import { ANTIGRAVITY, CLI, ERROR_MESSAGES, READ_ONLY_PREAMBLE } from "../constants.js";
import { readLatestResponse } from "./transcriptReader.js";

export interface AntigravityExecutorOptions {
  prompt: string;
  includeDirs?: string[];
  // Accepted for structural compatibility with the orchestrator's ExecutorFn but
  // intentionally ignored: agy -p can't switch models (hangs) or resume by id.
  model?: string;
  sessionId?: string;
  onProgress?: (newOutput: string) => void;
}

export interface AntigravityExecutorResult {
  response: string;
  sessionId: undefined;
  usage: undefined;
}

// Serialize all agy invocations in-process. Concurrent `agy -p` runs race on the
// shared cache/last_conversations.json and the newest-brain-dir heuristic, which
// would cross-wire responses. This is a correctness lock, not perf tuning (spec §6).
let mutexChain: Promise<unknown> = Promise.resolve();
function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutexChain.then(fn, fn);
  mutexChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function buildArgs(
  prompt: string,
  includeDirs: string[] | undefined,
  timeoutSec: number,
  sandbox: boolean,
): string[] {
  const args: string[] = [CLI.FLAGS.PRINT, prompt];
  if (includeDirs?.length) {
    for (const dir of includeDirs) args.push(CLI.FLAGS.ADD_DIR, dir);
  }
  args.push(CLI.FLAGS.PRINT_TIMEOUT, `${timeoutSec}s`);
  args.push(CLI.FLAGS.SKIP_PERMISSIONS);
  if (sandbox) args.push(CLI.FLAGS.SANDBOX);
  return args;
}

// Ordered response sources — first non-null wins. The stdout paths are
// future-proofing for when upstream fixes the empty-stdout bug (#27466) or adds
// JSON output; today they return null and the transcript scraper supplies the answer.
function fromStdoutJson(raw: string): string | null {
  const t = raw.trim();
  if (!t.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(t) as { response?: unknown };
    return typeof parsed.response === "string" && parsed.response.length > 0 ? parsed.response : null;
  } catch {
    return null;
  }
}

function fromStdoutPlain(raw: string): string | null {
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return ANTIGRAVITY.RATE_LIMIT_SIGNALS.some((s) => lower.includes(s));
}

export async function executeAntigravityCLI(
  options: AntigravityExecutorOptions,
): Promise<AntigravityExecutorResult> {
  const sandbox = process.env[ANTIGRAVITY.SANDBOX_ENV_VAR] !== "0";
  const timeoutMs = resolveTimeoutMs(ANTIGRAVITY.TIMEOUT_ENV_VAR, ANTIGRAVITY.DEFAULT_TIMEOUT_MS);
  // Tell agy to wait slightly less than our hard process timeout so agy's own
  // --print-timeout fires first with a cleaner message when the model is slow.
  const agyTimeoutSec = Math.max(1, Math.round(timeoutMs / 1000) - 5);

  const fullPrompt = `${READ_ONLY_PREAMBLE}\n\n${options.prompt}`;
  if (fullPrompt.length > EXECUTION.STDIN_THRESHOLD_BYTES) {
    // v1 passes the prompt as a -p argument; very large prompts risk the ARG_MAX
    // ceiling. stdin/temp-file handling is a documented open item (spec §10.1).
    Logger.warn(
      `antigravity: prompt is ${fullPrompt.length} bytes (> ${EXECUTION.STDIN_THRESHOLD_BYTES}); agy -p passes it as an argv arg, which may hit ARG_MAX. See spec §10.1.`,
    );
  }

  const args = buildArgs(fullPrompt, options.includeDirs, agyTimeoutSec, sandbox);

  return withMutex(async () => {
    const startedAt = Date.now();
    let raw: string;
    try {
      raw = await executeCommand(CLI.COMMANDS.AGY, args, options.onProgress, undefined, undefined, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isRateLimitError(message)) throw new Error(ERROR_MESSAGES.RATE_LIMITED);
      throw error; // not-found / spawn errors are already actionable via sanitizeErrorForLLM
    }

    const sources: Array<() => string | null> = [
      () => fromStdoutJson(raw),
      () => fromStdoutPlain(raw),
      () => readLatestResponse(startedAt),
    ];
    for (const source of sources) {
      const response = source();
      if (response !== null) {
        return { response, sessionId: undefined, usage: undefined };
      }
    }
    // agy exited cleanly but produced no readable answer anywhere.
    throw new Error(ERROR_MESSAGES.NO_OUTPUT);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace ask-antigravity-mcp run test`
Expected: PASS (all transcriptReader + antigravityExecutor tests).

- [ ] **Step 5: Commit**

```bash
git add packages/antigravity-mcp/src/utils/antigravityExecutor.ts packages/antigravity-mcp/src/utils/__tests__/antigravityExecutor.test.ts
git commit -m "feat(antigravity): executor with stdout-first/transcript-fallback chain + mutex

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Extend shared provider enum

**Files:**
- Modify: `packages/shared/src/askResponse.ts`

This is required before the tool/orchestrator can emit `provider: "antigravity"` against `askResponseSchema` (a strict enum).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/__tests__/askResponse.antigravity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { askResponseSchema } from "../askResponse.js";

describe("askResponseSchema antigravity provider", () => {
  it("accepts provider 'antigravity'", () => {
    const parsed = askResponseSchema.safeParse({
      provider: "antigravity",
      response: "ok",
      model: "antigravity",
    });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn workspace @ask-llm/shared run test`
Expected: FAIL — `provider` enum rejects `"antigravity"`.

- [ ] **Step 3: Edit `packages/shared/src/askResponse.ts`**

Change both enum lines (lines 4 and 15) from `["gemini", "codex", "ollama"]` to include `"antigravity"`:

```ts
const usageStatsSchema = z.object({
  provider: z.enum(["gemini", "codex", "ollama", "antigravity"]),
```

```ts
export const askResponseSchema = z.object({
  provider: z.enum(["gemini", "codex", "ollama", "antigravity"]),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn workspace @ask-llm/shared run test`
Expected: PASS. (If any existing shared test asserts the exact 3-value enum, update it to the 4-value set.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/askResponse.ts packages/shared/src/__tests__/askResponse.antigravity.test.ts
git commit -m "feat(shared): add antigravity to askResponse provider enum

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Tools (ask-antigravity + ping + registry)

**Files:**
- Create: `packages/antigravity-mcp/src/tools/ask-antigravity.tool.ts`
- Create: `packages/antigravity-mcp/src/tools/simple-tools.ts`
- Create: `packages/antigravity-mcp/src/tools/index.ts`

- [ ] **Step 1: Create `packages/antigravity-mcp/src/tools/ask-antigravity.tool.ts`**

```ts
import { type AskResponse, askResponseSchema, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";
import { ERROR_MESSAGES, STATUS_MESSAGES } from "../constants.js";
import { executeAntigravityCLI } from "../utils/antigravityExecutor.js";

const askAntigravityArgsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .max(100000)
    .describe("The question, code review request, or analysis task to send to Antigravity (agy)"),
  includeDirs: z
    .array(z.string())
    .optional()
    .describe(
      "Additional directories agy may access alongside the working directory (maps to agy `--add-dir`, repeatable). Useful in monorepos where relevant context spans sibling packages.",
    ),
});

export const askAntigravityTool: UnifiedTool = {
  name: "ask-antigravity",
  description:
    "Send a prompt to Google's Antigravity CLI (agy) for a subscription-backed second opinion, code review, or analysis. EXPERIMENTAL: agy's headless mode does not print to stdout, so this reads agy's transcript files; one-shot only (no model selection, no multi-turn). Requires `agy` installed and logged in once. Returns human-readable text plus a structured response.",
  zodSchema: askAntigravityArgsSchema,
  outputSchema: askResponseSchema,
  annotations: {
    title: "Ask Antigravity (experimental)",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  prompt: {
    description: "Execute Antigravity CLI (agy) to get a second opinion for code review and analysis.",
  },
  category: "utility",
  execute: async (args, onProgress) => {
    const { prompt, includeDirs } = args;
    if (!prompt?.trim()) {
      throw new Error(ERROR_MESSAGES.NO_PROMPT_PROVIDED);
    }
    const result = await executeAntigravityCLI({
      prompt: prompt as string,
      includeDirs: includeDirs as string[] | undefined,
      onProgress,
    });
    const text = `${STATUS_MESSAGES.ANTIGRAVITY_RESPONSE}\n${result.response}`;
    const structured: AskResponse = {
      provider: "antigravity",
      response: result.response,
      model: "antigravity",
      sessionId: undefined,
      usage: undefined,
    };
    return { text, structuredContent: structured as unknown as Record<string, unknown> };
  },
};
```

- [ ] **Step 2: Create `packages/antigravity-mcp/src/tools/simple-tools.ts`**

```ts
import { executeCommand, type UnifiedTool } from "@ask-llm/shared";
import { z } from "zod";

const pingArgsSchema = z.object({
  message: z.string().optional().describe("A message to echo back to test the connection"),
});

export const pingTool: UnifiedTool = {
  name: "ping",
  description: "Test connectivity with the Antigravity MCP server and check whether agy is installed",
  zodSchema: pingArgsSchema,
  annotations: {
    title: "Ping",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  prompt: {
    description: "Verify the Antigravity MCP server is working and agy is reachable",
  },
  category: "simple",
  execute: async (args, onProgress) => {
    const message = (args.message as string) || "Pong from Antigravity MCP Server!";
    try {
      const version = await executeCommand("agy", ["--version"], onProgress);
      return `${message} (agy detected: ${version.trim()})`;
    } catch {
      return `${message} (warning: agy not found on PATH — install Antigravity CLI and run \`agy\` once to log in)`;
    }
  },
};
```

- [ ] **Step 3: Create `packages/antigravity-mcp/src/tools/index.ts`**

```ts
import { toolRegistry } from "@ask-llm/shared";
import { askAntigravityTool } from "./ask-antigravity.tool.js";
import { pingTool } from "./simple-tools.js";

toolRegistry.push(askAntigravityTool, pingTool);

export { executeTool, getPromptMessage, toolRegistry } from "@ask-llm/shared";
```

- [ ] **Step 4: Verify it type-checks**

Run: `yarn workspace ask-antigravity-mcp run lint`
Expected: PASS (depends on Task 5's shared enum — build shared first if needed via `yarn workspace @ask-llm/shared run build`).

- [ ] **Step 5: Commit**

```bash
git add packages/antigravity-mcp/src/tools/
git commit -m "feat(antigravity): ask-antigravity + ping tools

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: MCP server + CLI + smoke test

**Files:**
- Create: `packages/antigravity-mcp/src/index.ts`
- Create: `packages/antigravity-mcp/src/cli.ts`
- Test: `packages/antigravity-mcp/src/__tests__/smoke.test.ts`

- [ ] **Step 1: Create `packages/antigravity-mcp/src/index.ts`**

```ts
import { createRequire } from "node:module";
import {
  createSessionUsage,
  createUsageStatsTool,
  Logger,
  registerSessionUsageResource,
  registerTools,
} from "@ask-llm/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { executeTool, getPromptMessage, toolRegistry } from "./tools/index.js";

function readPackageJson(): { name: string; version: string } {
  try {
    const require = createRequire(import.meta.url);
    return require("../package.json") as { name: string; version: string };
  } catch {
    return { name: "ask-antigravity-mcp", version: "0.0.0" };
  }
}

const { name, version } = readPackageJson();

const PROGRESS_MESSAGES = (op: string) => [
  `${op} - Antigravity is analyzing your request...`,
  `${op} - Processing and generating insights...`,
  `${op} - Reading agy's response transcript...`,
  `${op} - Large analysis in progress (this is normal for big requests)...`,
  `${op} - Still working... Antigravity takes time for quality results...`,
];

const server = new McpServer({ name, version });
const sessionUsage = createSessionUsage();
toolRegistry.push(createUsageStatsTool(sessionUsage));

registerTools({
  server,
  tools: toolRegistry,
  executeTool,
  getPromptMessage,
  progressMessages: PROGRESS_MESSAGES,
  sessionUsage,
});
registerSessionUsageResource(server, sessionUsage);

export async function startServer() {
  Logger.debug("init ask-antigravity-mcp");
  Logger.checkNodeVersion();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.debug("ask-antigravity-mcp listening on stdio");
}
```

- [ ] **Step 2: Create `packages/antigravity-mcp/src/cli.ts`**

```ts
#!/usr/bin/env node

import { Logger } from "@ask-llm/shared";
import { startServer } from "./index.js";

startServer().catch((error) => {
  Logger.error("Fatal error:", error);
  process.exit(1);
});
```

- [ ] **Step 3: Write the smoke test**

Create `packages/antigravity-mcp/src/__tests__/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toolRegistry } from "../tools/index.js";

describe("ask-antigravity-mcp smoke", () => {
  it("registers ask-antigravity and ping tools", () => {
    const names = toolRegistry.map((t) => t.name);
    expect(names).toContain("ask-antigravity");
    expect(names).toContain("ping");
  });

  it("ask-antigravity declares an outputSchema and includeDirs input", () => {
    const tool = toolRegistry.find((t) => t.name === "ask-antigravity");
    expect(tool?.outputSchema).toBeDefined();
  });
});
```

- [ ] **Step 4: Run tests + build**

Run: `yarn workspace ask-antigravity-mcp run test`
Expected: PASS (smoke + executor + transcriptReader).

Run: `yarn workspace ask-antigravity-mcp run build`
Expected: PASS — emits `dist/` including `dist/cli.js`, `dist/index.js`, `dist/utils/antigravityExecutor.js`.

- [ ] **Step 5: Commit**

```bash
git add packages/antigravity-mcp/src/index.ts packages/antigravity-mcp/src/cli.ts packages/antigravity-mcp/src/__tests__/smoke.test.ts
git commit -m "feat(antigravity): MCP server entry, CLI bin, smoke test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Orchestrator integration (ask-llm-mcp)

**Files:**
- Modify: `packages/llm-mcp/src/constants.ts`
- Modify: `packages/llm-mcp/src/index.ts:191`
- Modify: `packages/llm-mcp/package.json`
- Test: `packages/llm-mcp/src/__tests__/availability.test.ts` (add case)

- [ ] **Step 1: Add the provider to `packages/llm-mcp/src/constants.ts`**

In the `PROVIDERS` object, add after the `ollama` entry:

```ts
  antigravity: {
    name: "Antigravity",
    command: "agy",
    executorModule: "ask-antigravity-mcp/executor",
    executorFn: "executeAntigravityCLI",
    defaultModel: "antigravity",
  },
```

In `INSTALL_HINTS`, add:

```ts
  antigravity: "Install Google Antigravity (agy) from https://antigravity.google, then run `agy` once to log in",
```

- [ ] **Step 2: Extend the provider cast in `packages/llm-mcp/src/index.ts`**

At line 191, change:

```ts
          provider: provider as "gemini" | "codex" | "ollama",
```

to:

```ts
          provider: provider as "gemini" | "codex" | "ollama" | "antigravity",
```

- [ ] **Step 3: Add the workspace dependency in `packages/llm-mcp/package.json`**

In `dependencies`, add (keep alphabetical with the other `ask-*` deps):

```json
    "ask-antigravity-mcp": "workspace:*",
```

Do NOT add it to `bundledDependencies` or the `prepack`/`postpack` script args yet — llm-mcp is not being republished in this experimental cycle. (Tracked as a publish-time follow-up: add `antigravity-mcp` to the `prepack-bundle.mjs`/`postpack-restore.mjs` args and `bundledDependencies` before any npm release of llm-mcp.)

- [ ] **Step 4: Write the failing test**

Open `packages/llm-mcp/src/__tests__/availability.test.ts`. Add this test inside the existing top-level `describe` (import `PROVIDERS` from `../constants.js` if not already imported):

```ts
  it("registers antigravity as an agy-backed provider", () => {
    expect(PROVIDERS.antigravity).toBeDefined();
    expect(PROVIDERS.antigravity.command).toBe("agy");
    expect(PROVIDERS.antigravity.executorModule).toBe("ask-antigravity-mcp/executor");
    expect(PROVIDERS.antigravity.executorFn).toBe("executeAntigravityCLI");
  });
```

- [ ] **Step 5: Run test to verify it fails, then passes**

Run: `yarn workspace ask-llm-mcp run test`
Expected: the new test passes after Step 1. ALSO check `multiLlm.test.ts` and `availability.test.ts` for any assertion that hard-codes the provider set as exactly `["gemini","codex","ollama"]` (e.g., a length check or `toEqual`). If found, add `"antigravity"` to that expectation. Re-run until green.

- [ ] **Step 6: Verify the orchestrator type-checks**

Run: `yarn workspace ask-llm-mcp run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/llm-mcp/src/constants.ts packages/llm-mcp/src/index.ts packages/llm-mcp/package.json packages/llm-mcp/src/__tests__/availability.test.ts
git commit -m "feat(llm-mcp): register experimental antigravity (agy) provider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Full-workspace verification

**Files:** none (verification + final commit if anything changed)

- [ ] **Step 1: Build the whole workspace**

Run: `yarn build`
Expected: all packages build in dependency order with no errors (shared → … → antigravity-mcp → llm-mcp → plugin → docs).

- [ ] **Step 2: Run the whole test suite**

Run: `yarn test`
Expected: all workspaces green, including the new `ask-antigravity-mcp` tests and the extended shared/llm-mcp tests.

- [ ] **Step 3: Lint the whole workspace**

Run: `yarn lint`
Expected: Biome + `tsc --noEmit` clean across all packages.

- [ ] **Step 4: Manual confirmation that orchestrator gracefully skips agy when absent**

Run: `node packages/llm-mcp/dist/cli.js </dev/null` then immediately Ctrl-C (or pipe a single MCP `initialize` if convenient).
Expected: startup log lists providers; because `agy` is not installed on this machine, Antigravity is reported as "not found" with the install hint, and the server still starts with the other providers. This confirms availability-gating works (no crash from the missing binary).

- [ ] **Step 5: Final commit (only if Step 1–3 required fixes)**

```bash
git add -A
git commit -m "chore(antigravity): workspace build/test/lint green

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- §3 Approach B (stdout-first, transcript-fallback) → Task 4 (`sources` chain). ✔
- §4 package layout mirroring codex-mcp → Tasks 1, 6, 7. ✔
- §4 orchestrator entry gated on `isCommandAvailable('agy')` → Task 8 (no `availabilityModule`, so `detectProviders` uses `isCommandAvailable`). ✔
- §5 isolated `transcriptReader` → Task 3. ✔
- §5 mutex serialization → Task 4 (`withMutex` + concurrency test). ✔
- §6 error handling (NO_OUTPUT, RATE_LIMITED, not-found passthrough) → Tasks 2, 4. ✔
- §6 safety (`--dangerously-skip-permissions` + `--sandbox` + read-only preamble) → Tasks 2, 4 (buildArgs + preamble tests). ✔
- §7 config (`ASK_ANTIGRAVITY_TIMEOUT_MS`, `ASK_ANTIGRAVITY_SANDBOX`) → Tasks 2, 4. ✔
- §7 `includeDirs` → `--add-dir` → Tasks 4, 6. ✔
- §8 testing (fixtures, mocked executor, .db case, JSON-stdout future test) → Tasks 3, 4, 7. ✔
- §9 self-heal + schema-changed detection → Task 4 (stdout sources) + Task 3 (.db test + debug log). ✔
- §11 out-of-scope (no model/sessions/changeMode/plugin) → enforced by tool schema (Task 6) + ignored executor fields (Task 4). ✔
- §10 open items (stdin, transcript schema, sandbox-vs-add-dir, ping check) → carried as in-code comments/log warnings (Tasks 2–4) + ping behavior (Task 6) + Step 4 manual check (Task 9). These remain confirm-against-real-agy items, explicitly flagged, not silently assumed.

**2. Placeholder scan:** No "TBD"/"add error handling"/"similar to" — every code step has complete code, every run step has a command + expected result. The Task 8 Step 5 conditional ("if a test hard-codes the provider set") is a concrete, bounded verification instruction with the exact files named, not an open-ended placeholder.

**3. Type consistency:** `readLatestResponse(sinceMs, baseDir?)` is defined in Task 3 and called identically in Task 4. `executeAntigravityCLI(options)` and `buildArgs(prompt, includeDirs, timeoutSec, sandbox)` match between Task 4's implementation and its tests. `AntigravityExecutorResult { response; sessionId: undefined; usage: undefined }` is structurally compatible with the orchestrator's `ExecutorFn` return (Task 8). Constant names (`CLI.FLAGS.*`, `ANTIGRAVITY.*`, `ERROR_MESSAGES.*`, `READ_ONLY_PREAMBLE`) are defined in Task 2 and referenced consistently in Tasks 4/6 and the tests.

## Execution

After this plan is approved, implement with **superpowers:subagent-driven-development** (fresh subagent per task, review between) or **superpowers:executing-plans** (inline, batch with checkpoints).
