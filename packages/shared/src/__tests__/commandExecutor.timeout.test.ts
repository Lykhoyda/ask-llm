import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Isolated from commandExecutor.test.ts (which uses real spawns) because this
// suite mocks node:child_process to drive the timeout / SIGKILL-grace timer
// deterministically with fake timers.
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const { executeCommand } = await import("../commandExecutor.js");

interface FakeChild extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = { write: vi.fn(), end: vi.fn(), on: vi.fn() };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function sigkillCount(child: FakeChild): number {
  return child.kill.mock.calls.filter((c) => c[0] === "SIGKILL").length;
}

describe("executeCommand timeout — SIGKILL grace timer cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends SIGTERM on timeout and rejects", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const settled = executeCommand("fake", [], undefined, undefined, undefined, 50).then(
      () => "resolved",
      (err: Error) => err,
    );

    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    await expect(settled).resolves.toBeInstanceOf(Error);
  });

  it("cancels the pending SIGKILL when the child exits cleanly after SIGTERM", async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValue(child);

    const settled = executeCommand("fake", [], undefined, undefined, undefined, 50).then(
      () => "resolved",
      (err: Error) => err,
    );

    // Timeout fires → SIGTERM + schedules the 5s SIGKILL grace.
    await vi.advanceTimersByTimeAsync(50);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Child obeys SIGTERM and exits before the grace window elapses.
    child.emit("close", 143);

    // Past the 5s grace: a well-behaved executor must NOT fire a now-pointless
    // SIGKILL, and the timer must not have been left dangling on the loop.
    await vi.advanceTimersByTimeAsync(5000);
    expect(sigkillCount(child)).toBe(0);

    await expect(settled).resolves.toBeInstanceOf(Error);
  });
});
