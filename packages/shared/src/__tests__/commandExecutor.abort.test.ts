import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { executeCommand } from "../commandExecutor.js";

describe("executeCommand AbortSignal", () => {
  it("terminates and rejects an active provider command when the caller aborts", async () => {
    const controller = new AbortController();
    const pending = executeCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      undefined,
      undefined,
      undefined,
      30_000,
      undefined,
      controller.signal,
    );
    controller.abort(new DOMException("fixture cancelled", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "fixture cancelled" });
  });

  it("rejects a pre-aborted command before spawning or forwarding its stdin", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ask-llm-preabort-"));
    const controller = new AbortController();
    controller.abort(new DOMException("already cancelled", "AbortError"));
    const stderr: string[] = [];
    try {
      await expect(
        executeCommand(
          process.execPath,
          [
            "-e",
            'const fs = require("node:fs"); fs.writeFileSync("started", "yes"); console.error(fs.readFileSync(0, "utf8"));',
          ],
          undefined,
          (value) => stderr.push(value),
          "fixture input",
          30_000,
          undefined,
          controller.signal,
          { cwd, killProcessGroup: true },
        ),
      ).rejects.toMatchObject({ name: "AbortError", message: "already cancelled" });
      await sleep(100);
      await expect(readFile(join(cwd, "started"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(stderr).toEqual([]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
