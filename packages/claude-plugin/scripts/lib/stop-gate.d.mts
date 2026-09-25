export interface LogEntry {
  file: string;
  verdict?: string;
  concerns?: { high?: string[]; med?: string[]; low?: string[] };
  [key: string]: unknown;
}
export interface BlockingHigh {
  file: string;
  text: string;
  hash: string;
}
export function parseGitPorcelain(stdout: string, repoRoot: string): Set<string>;
export function collectBlockingHighs(options: {
  entries: Iterable<[string, LogEntry]>;
  acks: Record<string, unknown>;
  existsFn: (file: string) => boolean;
  gitDirty: Set<string> | null;
  markerDir: string;
}): BlockingHigh[];
export function formatBlockMessage(blocking: BlockingHigh[], markerDir: string): string;
export function collectInFlight(options: {
  records: unknown[];
  lockMtimes: number[];
  now: number;
  freshMs: number;
  staleMs?: number;
}): { settling: string[]; reviewing: number; any: boolean };
export function formatInFlightMessage(inFlight: { settling: string[]; reviewing: number }, markerDir: string): string;
export function selectLatestEntries(logText: string): Map<string, LogEntry>;
