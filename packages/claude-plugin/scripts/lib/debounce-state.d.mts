export const DEBOUNCE_DIR: string;
export const PENDING_DIR: string;
export const REVIEWING_DIR: string;
export const DEFAULT_DEBOUNCE_MS: number;
export const DEFAULT_DEBOUNCE_MAX_MS: number;
export const DEBOUNCE_STALE_BUFFER_MS: number;
export const MAX_SURFACE_VERDICTS: number;
export interface EditRecord {
  file: string;
  generation: number;
  burstStartedAt: number;
  reviewedGen: number;
  sessionId?: string;
}
export const debounceRoot: (markerDir: string) => string;
export const pendingRoot: (markerDir: string) => string;
export const reviewingRoot: (markerDir: string) => string;
export const debounceRecordPath: (markerDir: string, file: string) => string;
export const pendingPath: (markerDir: string, file: string) => string;
export const reviewingPath: (markerDir: string, file: string) => string;
export function bumpEditRecord(
  markerDir: string,
  file: string,
  options: { sessionId?: string; now: number },
): EditRecord;
export function readEditRecord(markerDir: string, file: string): EditRecord | null;
export function decideReview(options: {
  record: EditRecord | null;
  myGeneration: number;
  now: number;
  maxMs: number;
}): { review: boolean; reason: string };
export function markReviewed(markerDir: string, file: string, generation: number): void;
export function writePending(markerDir: string, file: string, message: string): void;
export function markReviewing(markerDir: string, file: string): void;
export function clearReviewing(markerDir: string, file: string): void;
export function drainPending(markerDir: string): string[];
export function joinPendingForSurface(messages: string[]): string;
export function clearAllDebounceState(markerDir: string): void;
export function sweepStaleDebounce(markerDir: string, maxMs: number): void;
