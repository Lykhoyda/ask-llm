import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __test__,
  appendAndSaveSession,
  buildPriorMessages,
  createSessionId,
  loadSession,
  type SessionRecord,
  saveSession,
} from "../sessions.js";

const { SESSION_DIR, MAX_MESSAGES_PER_SESSION, isSafeSessionId } = __test__;

function clearSessionDir(): void {
  if (!fs.existsSync(SESSION_DIR)) return;
  for (const f of fs.readdirSync(SESSION_DIR)) {
    const p = path.join(SESSION_DIR, f);
    try {
      // unlinkSync reliably removes files AND symlinks (incl. broken ones);
      // rmSync handles the directory case used by the blocked-path write test.
      if (fs.lstatSync(p).isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
    } catch {}
  }
}

beforeEach(() => clearSessionDir());
afterEach(() => clearSessionDir());

describe("createSessionId", () => {
  it("returns a UUID-shaped string", () => {
    const id = createSessionId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("produces unique ids", () => {
    const a = createSessionId();
    const b = createSessionId();
    expect(a).not.toBe(b);
  });
});

describe("isSafeSessionId", () => {
  it("accepts UUIDs", () => {
    expect(isSafeSessionId(createSessionId())).toBe(true);
  });

  it("accepts alphanumeric thread names", () => {
    expect(isSafeSessionId("conversation-abc123_v2")).toBe(true);
  });

  it("rejects path-traversal attempts", () => {
    expect(isSafeSessionId("../../etc/passwd")).toBe(false);
    expect(isSafeSessionId("foo/bar")).toBe(false);
    expect(isSafeSessionId("foo bar")).toBe(false);
  });

  it("rejects too-short or too-long ids", () => {
    expect(isSafeSessionId("short")).toBe(false);
    expect(isSafeSessionId("a".repeat(200))).toBe(false);
  });
});

describe("saveSession + loadSession", () => {
  it("round-trips a session record", () => {
    const id = createSessionId();
    const record: SessionRecord = {
      id,
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    saveSession(record);
    const loaded = loadSession(id);
    expect(loaded).toBeTruthy();
    expect(loaded?.id).toBe(id);
    expect(loaded?.messages).toHaveLength(2);
    expect(loaded?.model).toBe("qwen2.5-coder:7b");
  });

  it("returns null for missing session", () => {
    expect(loadSession(createSessionId())).toBeNull();
  });

  it("returns null for unsafe session id", () => {
    expect(loadSession("../../etc/passwd")).toBeNull();
  });

  it("trims messages above MAX_MESSAGES_PER_SESSION, keeping recent", () => {
    const id = createSessionId();
    const messages = Array.from({ length: MAX_MESSAGES_PER_SESSION + 10 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `msg-${i}`,
    }));
    saveSession({
      id,
      provider: "ollama",
      model: "test",
      messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const loaded = loadSession(id);
    expect(loaded?.messages).toHaveLength(MAX_MESSAGES_PER_SESSION);
    expect(loaded?.messages[0].content).toBe("msg-10");
  });

  it("refuses to save with unsafe id", () => {
    expect(() =>
      saveSession({
        id: "../../bad",
        provider: "ollama",
        model: "x",
        messages: [],
        createdAt: 0,
        updatedAt: 0,
      }),
    ).toThrow(/unsafe id/);
  });

  it("expires sessions older than TTL", () => {
    const id = createSessionId();
    const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
    saveSession({
      id,
      provider: "ollama",
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      createdAt: tenDaysAgo,
      updatedAt: tenDaysAgo,
    });
    const file = path.join(SESSION_DIR, `${id}.json`);
    fs.utimesSync(file, tenDaysAgo / 1000, tenDaysAgo / 1000);
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw) as SessionRecord;
    data.updatedAt = tenDaysAgo;
    fs.writeFileSync(file, JSON.stringify(data));
    expect(loadSession(id)).toBeNull();
  });
});

describe("appendAndSaveSession", () => {
  it("creates a new session when no id is given", () => {
    const result = appendAndSaveSession(undefined, "ollama", "qwen2.5-coder:7b", "hi", "hello");
    expect(result.created).toBe(true);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("appends to an existing session", () => {
    const first = appendAndSaveSession(undefined, "ollama", "qwen2.5-coder:7b", "what is 2+2", "4");
    const second = appendAndSaveSession(first.id, "ollama", "qwen2.5-coder:7b", "and 3+3?", "6");
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.messages).toHaveLength(4);
    expect(second.messages[2].content).toBe("and 3+3?");
    expect(second.messages[3].content).toBe("6");
  });

  it("creates a fresh session when given an unknown id", () => {
    const fakeId = createSessionId();
    const result = appendAndSaveSession(fakeId, "ollama", "test", "hi", "hello");
    expect(result.created).toBe(true);
    expect(result.id).toBe(fakeId);
    expect(result.messages).toHaveLength(2);
  });
});

describe("buildPriorMessages", () => {
  it("returns empty array when no sessionId given", () => {
    expect(buildPriorMessages(undefined)).toEqual([]);
  });

  it("returns empty array for unknown session", () => {
    expect(buildPriorMessages(createSessionId())).toEqual([]);
  });

  it("returns the messages of a saved session", () => {
    const result = appendAndSaveSession(undefined, "ollama", "test", "first", "reply");
    const prior = buildPriorMessages(result.id);
    expect(prior).toHaveLength(2);
    expect(prior[0].content).toBe("first");
  });
});

describe("file permissions (ADR-063 — security hardening)", () => {
  const isWin = process.platform === "win32";

  it.skipIf(isWin)("creates the session directory with mode 0o700 (owner-only)", () => {
    appendAndSaveSession(undefined, "ollama", "test", "u", "a");
    const stat = fs.lstatSync(SESSION_DIR);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(__test__.SESSION_DIR_MODE);
  });

  it.skipIf(isWin)("creates session files with mode 0o600 (owner-only)", () => {
    const result = appendAndSaveSession(undefined, "ollama", "test", "u", "a");
    const file = path.join(SESSION_DIR, `${result.id}.json`);
    const stat = fs.lstatSync(file);
    expect(stat.mode & 0o777).toBe(__test__.SESSION_FILE_MODE);
  });

  it.skipIf(isWin)("tightens an existing world-readable session dir on next save", () => {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o755 });
    fs.chmodSync(SESSION_DIR, 0o755);
    expect(fs.lstatSync(SESSION_DIR).mode & 0o777).toBe(0o755);

    appendAndSaveSession(undefined, "ollama", "test", "u", "a");
    expect(fs.lstatSync(SESSION_DIR).mode & 0o777).toBe(__test__.SESSION_DIR_MODE);
  });

  it("uses atomic write — no leftover .tmp files after a successful save", () => {
    appendAndSaveSession(undefined, "ollama", "test", "u", "a");
    const tmpFiles = fs.readdirSync(SESSION_DIR).filter((f) => f.includes(".tmp."));
    expect(tmpFiles).toEqual([]);
  });
});

describe("saveSession write-failure signalling (no silent success)", () => {
  it("returns false when the write fails (destination path blocked by a directory)", () => {
    // Force a real rename() failure: occupy the destination path with a
    // non-empty directory so the atomic temp->final rename cannot complete.
    const id = createSessionId();
    const blocked = path.join(SESSION_DIR, `${id}.json`);
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(blocked, "child"), "x");

    const ok = saveSession({
      id,
      provider: "ollama",
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(ok).toBe(false);
  });

  it("returns true on a successful save", () => {
    const ok = saveSession({
      id: createSessionId(),
      provider: "ollama",
      model: "x",
      messages: [{ role: "user", content: "hi" }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(ok).toBe(true);
  });

  it("appendAndSaveSession reports persisted:false when the write fails", () => {
    const id = createSessionId();
    const blocked = path.join(SESSION_DIR, `${id}.json`);
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(blocked, "child"), "x");

    const result = appendAndSaveSession(id, "ollama", "x", "u", "a");
    expect(result.persisted).toBe(false);
  });

  it("appendAndSaveSession reports persisted:true on a successful save", () => {
    const result = appendAndSaveSession(undefined, "ollama", "x", "u", "a");
    expect(result.persisted).toBe(true);
  });
});

describe("enforceSessionLimit TOCTOU resilience", () => {
  const isWin = process.platform === "win32";

  it.skipIf(isWin)("still enforces the cap when one listed file cannot be stat'd", () => {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    const overflow = __test__.MAX_SESSION_FILES + 3;
    for (let i = 0; i < overflow; i++) {
      fs.writeFileSync(
        path.join(SESSION_DIR, `real${String(i).padStart(4, "0")}.json`),
        JSON.stringify({ id: "x", messages: [], updatedAt: Date.now() }),
      );
    }
    // Broken symlink → statSync throws ENOENT, mimicking a concurrent removal
    // between readdir() and stat().
    fs.symlinkSync(path.join(SESSION_DIR, "missing-target"), path.join(SESSION_DIR, "ghost.json"));

    __test__.enforceSessionLimit();

    const realRemaining = fs.readdirSync(SESSION_DIR).filter((f) => f.startsWith("real") && f.endsWith(".json"));
    expect(realRemaining.length).toBeLessThanOrEqual(__test__.MAX_SESSION_FILES);
  });
});
