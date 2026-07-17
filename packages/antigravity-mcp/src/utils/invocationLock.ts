import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_NAME = ".ask-llm-invocation.lock";
const OWNER_FILE = "owner.json";
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_LEASE_DURATION_MS = 10 * 60_000;
const LEGACY_LEASE_DURATION_MS = 15 * 60_000;
const MALFORMED_LOCK_STALE_MS = 5 * 60_000;

interface LockOwner {
  pid: number;
  token: string;
  createdAt: number;
  leaseDurationMs: number;
}

export interface AntigravityInvocationLockOptions {
  acquireTimeoutMs?: number;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
}

export function antigravityInvocationLockPath(baseDir: string): string {
  return join(baseDir, LOCK_NAME);
}

function parseOwner(raw: string): LockOwner | null {
  try {
    const owner = JSON.parse(raw) as Partial<LockOwner>;
    if (!Number.isInteger(owner.pid) || (owner.pid ?? 0) <= 0) return null;
    if (typeof owner.token !== "string" || owner.token.length === 0) return null;
    if (typeof owner.createdAt !== "number" || !Number.isFinite(owner.createdAt)) return null;
    const leaseDurationMs = owner.leaseDurationMs ?? LEGACY_LEASE_DURATION_MS;
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) return null;
    return { pid: owner.pid as number, token: owner.token, createdAt: owner.createdAt, leaseDurationMs };
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function readOwner(lockPath: string): Promise<LockOwner | null> {
  try {
    return parseOwner(await readFile(join(lockPath, OWNER_FILE), "utf8"));
  } catch {
    return null;
  }
}

function heartbeatPath(lockPath: string, token: string): string {
  return join(lockPath, `.heartbeat-${token}`);
}

async function heartbeatMtimeMs(lockPath: string, owner: LockOwner): Promise<number | null> {
  try {
    return (await stat(heartbeatPath(lockPath, owner.token))).mtimeMs;
  } catch {
    try {
      return (await stat(join(lockPath, OWNER_FILE))).mtimeMs;
    } catch {
      return null;
    }
  }
}

async function recoverAbandonedLock(lockPath: string): Promise<boolean> {
  const owner = await readOwner(lockPath);
  if (owner && isProcessAlive(owner.pid)) {
    const heartbeatMs = await heartbeatMtimeMs(lockPath, owner);
    if (heartbeatMs !== null && Date.now() - heartbeatMs <= owner.leaseDurationMs) return false;
  }
  if (!owner) {
    try {
      const lockStat = await stat(lockPath);
      if (Date.now() - lockStat.mtimeMs < MALFORMED_LOCK_STALE_MS) return false;
    } catch {
      return true;
    }
  }

  const abandonedPath = `${lockPath}.abandoned-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, abandonedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    return false;
  }
  await rm(abandonedPath, { recursive: true, force: true });
  return true;
}

async function acquireLock(
  baseDir: string,
  options: AntigravityInvocationLockOptions,
): Promise<{ heartbeatPath: string; leaseDurationMs: number; lockPath: string; token: string }> {
  const acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const requestedLease = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  if (!Number.isFinite(requestedLease) || requestedLease <= 0 || requestedLease > Number.MAX_SAFE_INTEGER) {
    throw new Error("Antigravity lock lease duration must be a positive safe finite number");
  }
  const leaseDurationMs = Math.ceil(requestedLease);
  const deadline = Date.now() + Math.max(0, acquireTimeoutMs);
  const lockPath = antigravityInvocationLockPath(baseDir);
  await mkdir(baseDir, { recursive: true, mode: 0o700 });

  while (true) {
    const token = randomUUID();
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        const owner = { pid: process.pid, token, createdAt: Date.now(), leaseDurationMs } satisfies LockOwner;
        await writeFile(join(lockPath, OWNER_FILE), JSON.stringify(owner), { flag: "wx", mode: 0o600 });
        const ownerHeartbeatPath = heartbeatPath(lockPath, token);
        await writeFile(ownerHeartbeatPath, "", { flag: "wx", mode: 0o600 });
        return { heartbeatPath: ownerHeartbeatPath, leaseDurationMs, lockPath, token };
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    if (await recoverAbandonedLock(lockPath)) continue;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(`Antigravity invocation lock remained busy for ${acquireTimeoutMs}ms`);
    }
    await delay(Math.min(Math.max(1, pollIntervalMs), remainingMs));
  }
}

function startHeartbeat(path: string, leaseDurationMs: number): () => Promise<void> {
  const intervalMs = Math.min(5000, Math.max(10, Math.floor(leaseDurationMs / 3)));
  let inFlight: Promise<void> | null = null;
  const refresh = () => {
    if (inFlight) return;
    const now = new Date();
    const update = utimes(path, now, now).catch(() => undefined);
    inFlight = update;
    void update.finally(() => {
      if (inFlight === update) inFlight = null;
    });
  };
  const timer = setInterval(refresh, intervalMs);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await inFlight;
  };
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
  const owner = await readOwner(lockPath);
  if (owner?.token !== token) return;

  const releasedPath = `${lockPath}.released-${process.pid}-${token}`;
  try {
    await rename(lockPath, releasedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await rm(releasedPath, { recursive: true, force: true });
}

export async function withAntigravityInvocationLock<T>(
  baseDir: string,
  fn: () => Promise<T>,
  options: AntigravityInvocationLockOptions = {},
): Promise<T> {
  const lock = await acquireLock(baseDir, options);
  const stopHeartbeat = startHeartbeat(lock.heartbeatPath, lock.leaseDurationMs);
  try {
    return await fn();
  } finally {
    await stopHeartbeat();
    await releaseLock(lock.lockPath, lock.token);
  }
}
