import { describe, expect, it } from "vitest";
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

  it("rejects an already-aborted command without waiting for timeout", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("already cancelled", "AbortError"));
    await expect(
      executeCommand(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        undefined,
        undefined,
        undefined,
        30_000,
        undefined,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError", message: "already cancelled" });
  });
});
