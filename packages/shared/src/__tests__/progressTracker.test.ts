import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProgressTracker } from "../progressTracker.js";

function createMockExtra(hasToken = true) {
  return {
    _meta: hasToken ? { progressToken: "test-token" } : {},
    sendNotification: vi.fn().mockResolvedValue(undefined),
  } as unknown as Parameters<typeof createProgressTracker>[1];
}

describe("createProgressTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends initial progress notification on creation", () => {
    const extra = createMockExtra();
    const handle = createProgressTracker("test-op", extra, ["Working..."]);

    expect(extra.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "notifications/progress",
        params: expect.objectContaining({ progressToken: "test-token", progress: 0 }),
      }),
    );

    handle.stop(true);
  });

  it.each([0, ""])("honors valid falsy progress token %j", async (progressToken) => {
    const extra = createMockExtra();
    extra._meta = { progressToken };
    const handle = createProgressTracker("test-op", extra, ["Working..."]);
    await vi.advanceTimersByTimeAsync(25000);
    await handle.stop(true);
    expect(extra.sendNotification.mock.calls.map(([notification]) => notification.params)).toEqual([
      expect.objectContaining({ progressToken, progress: 0 }),
      expect.objectContaining({ progressToken, progress: 1 }),
      expect.objectContaining({ progressToken, progress: 100, total: 100 }),
    ]);
  });

  it("sends periodic progress notifications", async () => {
    const extra = createMockExtra();
    const handle = createProgressTracker("test-op", extra, ["Message 1", "Message 2"]);
    const initialCalls = extra.sendNotification.mock.calls.length;

    vi.advanceTimersByTime(25000);
    await vi.runOnlyPendingTimersAsync();

    expect(extra.sendNotification.mock.calls.length).toBeGreaterThan(initialCalls);

    await handle.stop(true);
  });

  it("rotates through messages", async () => {
    const extra = createMockExtra();
    const handle = createProgressTracker("test-op", extra, ["A", "B"]);

    vi.advanceTimersByTime(25000);
    await vi.runOnlyPendingTimersAsync();
    vi.advanceTimersByTime(25000);
    await vi.runOnlyPendingTimersAsync();

    const calls = extra.sendNotification.mock.calls;
    const messages = calls
      .map((c: unknown[]) => (c[0] as Record<string, Record<string, string>>).params.message)
      .filter(Boolean);
    expect(messages).toContain("A");
    expect(messages).toContain("B");

    await handle.stop(true);
  });

  it("includes output preview in messages", async () => {
    const extra = createMockExtra();
    const handle = createProgressTracker("test-op", extra, ["Working..."]);

    handle.updateOutput("Some CLI output here");
    vi.advanceTimersByTime(25000);
    await vi.runOnlyPendingTimersAsync();

    const lastCall = extra.sendNotification.mock.calls.at(-1);
    expect(lastCall[0].params.message).toContain("Some CLI output here");

    await handle.stop(true);
  });

  it("stop sends completion notification with progress 100/100", async () => {
    const extra = createMockExtra();
    const handle = createProgressTracker("test-op", extra, ["Working..."]);

    await handle.stop(true);

    const lastCall = extra.sendNotification.mock.calls.at(-1);
    expect(lastCall[0].params).toEqual(
      expect.objectContaining({ progress: 100, total: 100, message: "test-op completed" }),
    );
  });

  it("stop sends failure message when success is false", async () => {
    const extra = createMockExtra();
    const handle = createProgressTracker("test-op", extra, ["Working..."]);

    await handle.stop(false);

    const lastCall = extra.sendNotification.mock.calls.at(-1);
    expect(lastCall[0].params.message).toBe("test-op failed");
  });

  it("skips notifications when no progressToken", () => {
    const extra = createMockExtra(false);
    const handle = createProgressTracker("test-op", extra, ["Working..."]);

    expect(extra.sendNotification).not.toHaveBeenCalled();

    handle.stop(true);
  });

  it("clears interval after stop", async () => {
    const extra = createMockExtra();
    const handle = createProgressTracker("test-op", extra, ["Working..."]);

    await handle.stop(true);
    const callCount = extra.sendNotification.mock.calls.length;

    vi.advanceTimersByTime(50000);
    expect(extra.sendNotification.mock.calls.length).toBe(callCount);
  });
});
