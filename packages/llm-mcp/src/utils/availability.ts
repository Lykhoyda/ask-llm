import { resolveSpawnCommand } from "@ask-llm/shared";

export async function resolveCommand(command: string): Promise<string | undefined> {
  return resolveSpawnCommand(command);
}

export async function isCommandAvailable(command: string): Promise<boolean> {
  return (await resolveCommand(command)) !== undefined;
}
