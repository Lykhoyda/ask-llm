import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EditChunk } from "../changeMode/changeModeChunker.js";
import { __test__, cacheChunks, getChunks } from "../chunkCache.js";

const { CACHE_DIR, MAX_CACHE_FILES, enforceFileLimits } = __test__;
const isWin = process.platform === "win32";

// Cache element shape is opaque to the cache (it only checks Array.isArray),
// so a minimal placeholder is sufficient to verify round-tripping.
const sampleChunks = [{ id: 1, content: "edit-block" }] as unknown as EditChunk[];

function clearCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) return;
  for (const f of fs.readdirSync(CACHE_DIR)) {
    try {
      fs.unlinkSync(path.join(CACHE_DIR, f));
    } catch {}
  }
}

beforeEach(() => clearCacheDir());
afterEach(() => clearCacheDir());

describe("cacheChunks / getChunks round-trip", () => {
  it("caches chunks and reads them back by key", () => {
    const key = cacheChunks("prompt text", sampleChunks);
    expect(getChunks(key)).toEqual(sampleChunks);
  });

  it("returns null for an unknown key", () => {
    expect(getChunks("deadbeef")).toBeNull();
  });
});

describe("getChunks resilience to concurrent partial writes", () => {
  it("returns null for a truncated (invalid-JSON) file WITHOUT deleting it", () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const key = "abcd1234";
    const file = path.join(CACHE_DIR, `${key}.json`);
    // Mimic another process mid-write: a valid prefix that JSON.parse rejects.
    fs.writeFileSync(file, '{"chunks":[{"id":1}],"timestamp":123');

    expect(getChunks(key)).toBeNull();
    // A parse failure may be a transient partial read of an in-flight write by
    // another MCP process sharing this /tmp dir. The reader must NOT unlink it
    // — doing so destroys the writer's data.
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe("enforceFileLimits TOCTOU resilience", () => {
  it.skipIf(isWin)("still enforces the cap when one listed file cannot be stat'd", () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const overflow = MAX_CACHE_FILES + 3;
    for (let i = 0; i < overflow; i++) {
      fs.writeFileSync(
        path.join(CACHE_DIR, `real${String(i).padStart(3, "0")}.json`),
        JSON.stringify({ chunks: [], timestamp: Date.now(), promptHash: "x" }),
      );
    }
    // Broken symlink → statSync throws ENOENT, mimicking a sibling file removed
    // by a concurrent process between readdir() and stat().
    fs.symlinkSync(path.join(CACHE_DIR, "missing-target"), path.join(CACHE_DIR, "ghost.json"));

    enforceFileLimits();

    const realRemaining = fs.readdirSync(CACHE_DIR).filter((f) => f.startsWith("real") && f.endsWith(".json"));
    expect(realRemaining.length).toBeLessThanOrEqual(MAX_CACHE_FILES);
  });
});
