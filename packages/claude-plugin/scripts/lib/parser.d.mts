export const DEFAULT_SURFACE_THRESHOLD: "med";
export function buildVerdictMessage(options: {
  filePath: string;
  concerns: { high: string[]; med: string[]; low: string[] };
  fellBack: boolean;
  durationMs: number;
  surfaceThreshold: string;
  cached?: boolean;
  repeatedIgnoredCount?: number;
  logPath?: string;
}): string;
export function parseConcerns(message: string): { high: string[]; med: string[]; low: string[] };
export const VERDICT_PREFIXES: Record<string, string>;
export const VALID_THRESHOLDS: Set<string>;
export function formatDuration(durationMs: number): string;
export function parseResetHint(text: unknown): string | null;
