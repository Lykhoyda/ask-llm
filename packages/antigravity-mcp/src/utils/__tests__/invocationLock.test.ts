import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { antigravityInvocationLockPath, withAntigravityInvocationLock } from "../invocationLock.js";

let baseDir: string;

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "agy-lock-test-"));
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("withAntigravityInvocationLock", () => {
  it("uses owner-only permissions and removes the lock after success", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);

    await withAntigravityInvocationLock(baseDir, async () => {
      const ownerPath = join(lockPath, "owner.json");
      expect(existsSync(lockPath)).toBe(true);
      expect(existsSync(ownerPath)).toBe(true);
      const heartbeat = readdirSync(lockPath).find((name) => name.startsWith(".heartbeat-"));
      expect(heartbeat).toBeDefined();
      if (!heartbeat) throw new Error("heartbeat file missing");
      const heartbeatPath = join(lockPath, heartbeat);
      expect(existsSync(heartbeatPath)).toBe(true);
      if (process.platform !== "win32") {
        expect(statSync(lockPath).mode & 0o777).toBe(0o700);
        expect(statSync(ownerPath).mode & 0o777).toBe(0o600);
        expect(statSync(heartbeatPath).mode & 0o777).toBe(0o600);
      }
    });

    expect(existsSync(lockPath)).toBe(false);
  });

  it("removes its lock after the critical section throws", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);

    await expect(
      withAntigravityInvocationLock(baseDir, async () => {
        throw new Error("agy failed");
      }),
    ).rejects.toThrow("agy failed");

    expect(existsSync(lockPath)).toBe(false);
  });

  it("recovers a lock owned by a dead process", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);
    mkdirSync(lockPath, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(lockPath, "owner.json"),
      JSON.stringify({ pid: 2_147_483_647, token: "dead-owner", createdAt: 1 }),
      { mode: 0o600 },
    );

    let entered = false;
    await withAntigravityInvocationLock(baseDir, async () => {
      entered = true;
    });

    expect(entered).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("recovers an old malformed lock without deleting a fresh one", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);
    mkdirSync(lockPath, { recursive: true, mode: 0o700 });
    writeFileSync(join(lockPath, "owner.json"), "not-json", { mode: 0o600 });
    utimesSync(lockPath, new Date(1), new Date(1));

    await withAntigravityInvocationLock(baseDir, async () => undefined);
    expect(existsSync(lockPath)).toBe(false);

    mkdirSync(lockPath, { recursive: true, mode: 0o700 });
    writeFileSync(join(lockPath, "owner.json"), "not-json", { mode: 0o600 });
    await expect(
      withAntigravityInvocationLock(baseDir, async () => undefined, {
        acquireTimeoutMs: 40,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow("Timed out waiting for the Antigravity invocation lock");
    expect(existsSync(lockPath)).toBe(true);
  });

  it("does not recover a lock owned by a live process", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);
    const token = "live-owner";
    mkdirSync(lockPath, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid, token, createdAt: Date.now(), leaseDurationMs: 60_000 }),
      { mode: 0o600 },
    );
    writeFileSync(join(lockPath, `.heartbeat-${token}`), "", { mode: 0o600 });

    await expect(
      withAntigravityInvocationLock(baseDir, async () => undefined, {
        acquireTimeoutMs: 40,
        pollIntervalMs: 5,
      }),
    ).rejects.toThrow("Timed out waiting for the Antigravity invocation lock");
    expect(readFileSync(join(lockPath, "owner.json"), "utf8")).toContain("live-owner");
  });

  it("recovers a stale lease even when the recorded PID is live or reused", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);
    const ownerPath = join(lockPath, "owner.json");
    const token = "reused-pid";
    mkdirSync(lockPath, { recursive: true, mode: 0o700 });
    writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token, createdAt: 1, leaseDurationMs: 50 }), {
      mode: 0o600,
    });
    const heartbeatPath = join(lockPath, `.heartbeat-${token}`);
    writeFileSync(heartbeatPath, "", { mode: 0o600 });
    utimesSync(heartbeatPath, new Date(1), new Date(1));

    let entered = false;
    await withAntigravityInvocationLock(
      baseDir,
      async () => {
        entered = true;
      },
      { acquireTimeoutMs: 200, pollIntervalMs: 5 },
    );

    expect(entered).toBe(true);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("refreshes its heartbeat while the critical section is active", async () => {
    const lockPath = antigravityInvocationLockPath(baseDir);
    let initialHeartbeat = 0;

    await withAntigravityInvocationLock(
      baseDir,
      async () => {
        const heartbeatName = readdirSync(lockPath).find((name) => name.startsWith(".heartbeat-"));
        if (!heartbeatName) throw new Error("heartbeat file missing");
        const heartbeatPath = join(lockPath, heartbeatName);
        initialHeartbeat = statSync(heartbeatPath).mtimeMs;
        for (let attempt = 0; attempt < 100; attempt++) {
          if (statSync(heartbeatPath).mtimeMs > initialHeartbeat) return;
          await delay(5);
        }
        throw new Error("heartbeat did not refresh");
      },
      { leaseDurationMs: 60 },
    );

    expect(initialHeartbeat).toBeGreaterThan(0);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_VALUE,
    0,
    -1,
  ])("rejects invalid lease duration %s without leaving a lock", async (leaseDurationMs) => {
    const lockPath = antigravityInvocationLockPath(baseDir);

    await expect(withAntigravityInvocationLock(baseDir, async () => undefined, { leaseDurationMs })).rejects.toThrow(
      "Antigravity lock lease duration must be a positive safe finite number",
    );
    expect(existsSync(lockPath)).toBe(false);
  });

  it("serializes critical sections across two OS processes", async () => {
    const markerDir = join(baseDir, "markers");
    mkdirSync(markerDir, { mode: 0o700 });
    const releaseA = join(markerDir, "release-a");
    const workerPath = fileURLToPath(new URL("./fixtures/invocationLockWorker.ts", import.meta.url));
    const startWorker = (id: string, releasePath = "") =>
      spawn(process.execPath, ["--import", "tsx", workerPath, baseDir, markerDir, id, releasePath], {
        cwd: dirname(workerPath),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    const waitForFile = async (path: string) => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (existsSync(path)) return;
        await delay(10);
      }
      throw new Error(`Timed out waiting for ${path}`);
    };
    const waitForExit = (child: ReturnType<typeof startWorker>) =>
      new Promise<void>((resolve, reject) => {
        let stderr = "";
        child.stderr?.on("data", (chunk) => {
          stderr += String(chunk);
        });
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`worker exited ${code}: ${stderr}`));
        });
      });

    const workerA = startWorker("a", releaseA);
    await waitForFile(join(markerDir, "enter-a"));
    const workerB = startWorker("b");
    await waitForFile(join(markerDir, "attempt-b"));
    await delay(100);
    writeFileSync(releaseA, "");
    await Promise.all([waitForExit(workerA), waitForExit(workerB)]);

    expect(existsSync(join(markerDir, "overlap-a"))).toBe(false);
    expect(existsSync(join(markerDir, "overlap-b"))).toBe(false);
    expect(existsSync(join(markerDir, "exit-a"))).toBe(true);
    expect(existsSync(join(markerDir, "enter-b"))).toBe(true);
  });
});
