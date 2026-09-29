import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSpawnEnv } from "@ask-llm/shared";

const execFileAsync = promisify(execFile);
const IS_WINDOWS = process.platform === "win32";

export async function resolveCommand(command: string): Promise<string | undefined> {
  try {
    const which = IS_WINDOWS ? "where" : "which";
    const { stdout } = await execFileAsync(which, [command], { timeout: 5000, env: getSpawnEnv() });
    return stdout.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  return (await resolveCommand(command)) !== undefined;
}
