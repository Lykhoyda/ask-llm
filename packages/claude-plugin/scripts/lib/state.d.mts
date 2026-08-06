export const AUTOPAUSE_FAILURE_THRESHOLD: number;
export const INFLIGHT_TTL_MIN_MS: number;
export const pausePath: (markerDir: string) => string;
export const stateRoot: (markerDir: string) => string;
export const logPath: (markerDir: string) => string;
export function addAck(markerDir: string, hash: string, options: { reason: string }): void;
export function appendLog(markerDir: string, entry: Record<string, unknown>): Promise<void>;
export function clearAutoPause(markerDir: string, expected?: PauseInfo): boolean;
export function clearReviewFailures(markerDir: string): void;
export function computeCacheKey(options: {
  model: string;
  prompt: string;
  fileContent: string;
  surfaceThreshold: string;
}): string;
export function getCachedConcerns(
  markerDir: string,
  cacheKey: string,
): Promise<{ high: string[]; med: string[]; low: string[]; durationMs?: number } | null>;
export function hashConcernBody(body: string): string;
export function isPaused(markerDir: string): boolean;
export type PauseInfo =
  | { manual: true }
  | {
      kind: "quota" | "failures";
      reason: string;
      at?: string;
      pluginVersion?: string;
      resetHint?: string;
    };
export function readAcks(markerDir: string): Record<string, unknown>;
export function readPauseInfo(markerDir: string): PauseInfo | null;
export function readPluginVersion(): string | null;
export function recordReviewFailure(markerDir: string, reason: string): number;
export function resolveAutoResume(
  pauseInfo: PauseInfo | null,
  options?: {
    now?: number;
    currentVersion?: string | null;
    quotaTtlMs?: number;
    failuresTtlMs?: number;
  },
): { resume: boolean; why?: string };
export function releaseInflightLock(lockPath?: string): void;
export function setCachedConcerns(
  markerDir: string,
  cacheKey: string,
  value: { high: string[]; med: string[]; low: string[]; durationMs: number },
): Promise<void>;
export function tryAcquireInflightLock(
  markerDir: string,
  filePath: string,
  ttlMs: number,
): { acquired: boolean; lockPath: string; reason?: string };
export function writeAutoPause(
  markerDir: string,
  value: { kind: "quota" | "failures"; reason: string; resetHint?: string },
): boolean;
