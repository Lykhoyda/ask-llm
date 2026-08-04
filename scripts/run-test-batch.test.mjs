import { describe, expect, it } from "vitest";
import { assignTestFiles, parseBatch, vitestCommand } from "./run-test-batch.mjs";

describe("test batch assignment", () => {
  it("covers every sorted file exactly once across five batches", () => {
    const files = ["z.test.ts", "a.test.ts", "nested/c.test.ts", "b.test.ts"];
    const batches = Array.from({ length: 5 }, (_, offset) =>
      assignTestFiles(files, { index: offset + 1, count: 5 }),
    );

    expect(batches.flat()).toHaveLength(files.length);
    expect(new Set(batches.flat())).toEqual(new Set(files));
    expect(batches.flatMap((batch, index) => batch.map((file) => [index, file]))).toEqual([
      [0, "a.test.ts"],
      [1, "b.test.ts"],
      [2, "nested/c.test.ts"],
      [3, "z.test.ts"],
    ]);
  });

  it("is stable regardless of discovery order", () => {
    const batch = { index: 2, count: 3 };
    expect(assignTestFiles(["c", "a", "b", "d"], batch)).toEqual(
      assignTestFiles(["d", "b", "a", "c"], batch),
    );
  });

  it("supports empty and smaller-than-batch-count suites", () => {
    expect(assignTestFiles([], { index: 5, count: 5 })).toEqual([]);
    expect(assignTestFiles(["b", "a"], { index: 1, count: 5 })).toEqual(["a"]);
    expect(assignTestFiles(["b", "a"], { index: 3, count: 5 })).toEqual([]);
  });

  it("passes file names as separate arguments without shell quoting", () => {
    expect(vitestCommand(["packages/a test/src/quoted ' name.test.ts"], "linux")).toEqual({
      command: "yarn",
      args: ["vitest", "run", "packages/a test/src/quoted ' name.test.ts"],
    });
    expect(vitestCommand([], "win32").command).toBe("yarn.cmd");
  });

  it("validates batch syntax and bounds", () => {
    expect(parseBatch("2/5")).toEqual({ index: 2, count: 5 });
    expect(() => parseBatch("0/5")).toThrow("between 1 and count");
    expect(() => parseBatch("6/5")).toThrow("between 1 and count");
    expect(() => parseBatch("2 of 5")).toThrow("format");
  });
});
