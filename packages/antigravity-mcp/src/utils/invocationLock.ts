import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_NAME = ".ask-llm-invocation.lock";
const OWNER_FILE = "owner.json";
const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const MALFORMED_LOCK_STALE_MS = 5 * 60_000;

interface LockOwner {
  pid: number;
  token: string;
  createdAt: number;
}

export interface AntigravityInvocationLockOptions {
  acquireTimeoutMs?: number;
  pollIntervalMs?: number;
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
    return owner as LockOwner;
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

async function recoverAbandonedLock(lockPath: string): Promise<boolean> {
  const owner = await readOwner(lockPath);
  if (owner && isProcessAlive(owner.pid)) return false;
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
): Promise<{ lockPath: string; token: string }> {
  const acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + Math.max(0, acquireTimeoutMs);
  const lockPath = antigravityInvocationLockPath(baseDir);
  await mkdir(baseDir, { recursive: true, mode: 0o700 });

  while (true) {
    const token = randomUUID();
    try {
      await mkdir(lockPath, { mode: 0o700 });
      try {
        await writeFile(
          join(lockPath, OWNER_FILE),
          JSON.stringify({ pid: process.pid, token, createdAt: Date.now() } satisfies LockOwner),
          { flag: "wx", mode: 0o600 },
        );
        return { lockPath, token };
      } catch (error) {
        await rm(lockPath, { recursive: true, force: true });
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    if (await recoverAbandonedLock(lockPath)) continue;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("Timed out waiting for the Antigravity invocation lock");
    await delay(Math.min(Math.max(1, pollIntervalMs), remainingMs));
  }
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
  try {
    return await fn();
  } finally {
    await releaseLock(lock.lockPath, lock.token);
  }
}
