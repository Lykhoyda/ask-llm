import { describe, expect, it } from "vitest";
import { selectLatestEntries, parseGitPorcelain } from "../../scripts/lib/stop-gate.mjs";

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
