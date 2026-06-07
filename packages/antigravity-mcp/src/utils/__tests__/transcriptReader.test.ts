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

  it("falls through to the newest brain dir when the cache file is a bare keyed object", () => {
    const oldDir = writeTranscript("old", [
      { source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "old answer" },
    ]);
    const newDir = writeTranscript("new", [
      { source: "MODEL", status: "DONE", type: "PLANNER_RESPONSE", text: "new answer" },
    ]);
    utimesSync(oldDir, new Date(1000), new Date(1000));
    utimesSync(newDir, new Date(5000), new Date(5000));
    mkdirSync(join(baseDir, "cache"), { recursive: true });
    // last key is "old" — proves we do NOT trust object-key order; mtime scan picks "new".
    writeFileSync(
      join(baseDir, "cache", "last_conversations.json"),
      JSON.stringify({ new: { ts: 2 }, old: { ts: 1 } }),
    );
    expect(readLatestResponse(0, baseDir)).toBe("new answer");
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
