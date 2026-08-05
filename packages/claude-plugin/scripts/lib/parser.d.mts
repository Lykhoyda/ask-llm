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
