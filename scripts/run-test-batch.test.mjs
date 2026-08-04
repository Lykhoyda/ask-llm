import { describe, expect, it } from "vitest";
import { assignTestFiles, parseBatch, run, vitestCommand } from "./run-test-batch.mjs";

describe("test batch assignment", () => {
  it("covers every sorted file exactly once across five batches", () => {
    const files = ["z.test.ts", "a.test.ts", "nested/c.test.ts", "b.test.ts"];
    const batches = Array.from({ length: 5 }, (_, offset) => assignTestFiles(files, { index: offset + 1, count: 5 }));

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
    expect(assignTestFiles(["c", "a", "b", "d"], batch)).toEqual(assignTestFiles(["d", "b", "a", "c"], batch));
  });

  it("supports empty and smaller-than-batch-count suites", () => {
    expect(assignTestFiles([], { index: 5, count: 5 })).toEqual([]);
    expect(assignTestFiles(["b", "a"], { index: 1, count: 5 })).toEqual(["a"]);
    expect(assignTestFiles(["b", "a"], { index: 3, count: 5 })).toEqual([]);
  });

  it("spawns Vitest through Node on Windows without changing argument boundaries", () => {
    const nodePath = "C:\\Program Files\\nodejs\\node.exe";
    const vitestPath = "C:\\repo path\\node_modules\\vitest\\vitest.mjs";
    const testPath = "packages/a test/src/quoted ' name.test.ts";
    const calls = [];

    run(vitestCommand([testPath], { nodePath, vitestPath }), {}, (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: "" };
    });

    expect(calls).toEqual([
      {
        command: nodePath,
        args: [vitestPath, "run", testPath],
        options: expect.objectContaining({ shell: false }),
      },
    ]);
    expect(vitestCommand([testPath], { nodePath, vitestPath })).toEqual({
      command: nodePath,
      args: [vitestPath, "run", testPath],
    });
  });

  it("validates batch syntax and bounds", () => {
    expect(parseBatch("2/5")).toEqual({ index: 2, count: 5 });
    expect(() => parseBatch("0/5")).toThrow("between 1 and count");
    expect(() => parseBatch("6/5")).toThrow("between 1 and count");
    expect(() => parseBatch("2 of 5")).toThrow("format");
  });
});
