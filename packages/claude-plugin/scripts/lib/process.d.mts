export const IS_WINDOWS: boolean;
export function quoteArgsForWindows(args: string[]): string[];
export function prepareCommandInvocation<T extends object>(
  args: string[],
  options: T,
  runtimePlatform?: string,
): { args: string[]; options: T & { shell: boolean } };
export function terminateProcessTree(
  child: { pid?: number; killed: boolean; exitCode: number | null; kill?: (signal?: NodeJS.Signals) => boolean },
  signal: NodeJS.Signals,
): void;
