import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { getSpawnEnv } from "@ask-llm/shared";
import { resolveCommand } from "../utils/availability.js";
import { type HostId, type HostSpec, hostSpecs, type RegistrationSource, SERVER_NAME } from "./registry.js";

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 5000;

export interface RegistrationState {
  registered: boolean | null;
  command?: string[];
  error?: string;
}

export interface DetectedHost extends RegistrationState {
  id: HostId;
  name: string;
  installed: boolean;
  binary?: string;
  version?: string;
  supported: boolean;
  leftoverConfig: boolean;
  spec: HostSpec;
}

async function run(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const { stdout, stderr } = await execFileAsync(binary, args, { env, timeout: PROBE_TIMEOUT_MS });
  return stdout || stderr;
}

async function probeVersion(spec: HostSpec, binary: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (!spec.versionProbe) return undefined;
  try {
    const firstLine = (await run(binary, spec.versionProbe.args, env)).split(/\r?\n/)[0]?.trim() ?? "";
    return spec.versionProbe.pattern.exec(firstLine)?.[1];
  } catch {
    return undefined;
  }
}

function entryCommand(entry: unknown): string[] | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const { command, args, enabled } = entry as { command?: unknown; args?: unknown; enabled?: unknown };
  if (enabled === false || (args !== undefined && (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")))) return undefined;
  const rest = (args as string[] | undefined) ?? [];
  if (typeof command === "string" && command.trim()) return [command, ...rest];
  if (Array.isArray(command) && command.length > 0 && command.every((part) => typeof part === "string" && part.trim())) return [...command, ...rest];
  return undefined;
}

function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function readJsonKey(file: string, keyPath: string[]): RegistrationState {
  const text = readText(file);
  if (text === undefined) return { registered: false };
  let value: unknown = JSON.parse(text);
  for (const key of keyPath) {
    if (value === null || typeof value !== "object") return { registered: false };
    value = (value as Record<string, unknown>)[key];
  }
  const command = entryCommand(value);
  return command ? { registered: true, command } : { registered: false };
}

// ponytail: reads only the `[mcp_servers.<name>]` table shape the host's own add command writes;
// inline tables or dotted keys read as unregistered. Add a TOML parser if hosts start writing those.
function readTomlTable(file: string, table: string): RegistrationState {
  const text = readText(file);
  if (text === undefined) return { registered: false };
  let inTable = false;
  let found = false;
  let command: string | undefined;
  let args: unknown = [];
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[\s*([^\]]+?)\s*\]\s*$/.exec(line);
    if (header) {
      inTable = header[1].replace(/"/g, "") === table;
      found ||= inTable;
      continue;
    }
    if (!inTable) continue;
    const pair = /^\s*(command|args)\s*=\s*(.+?)\s*$/.exec(line);
    if (pair?.[1] === "command") command = JSON.parse(pair[2]) as string;
    if (pair?.[1] === "args") args = JSON.parse(pair[2]);
  }
  const entry = found ? entryCommand({ command, args }) : undefined;
  return entry ? { registered: true, command: entry } : { registered: false };
}

async function readList(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<RegistrationState> {
  const servers = JSON.parse(await run(binary, args, env)) as Array<{
    name?: string;
    transport?: { command?: unknown; args?: unknown };
  }>;
  const entry = servers.find((server) => server.name === SERVER_NAME);
  const command = entryCommand(entry?.transport);
  return command ? { registered: true, command } : { registered: false };
}

function readPackages(file: string, source: string): RegistrationState {
  const text = readText(file);
  if (text === undefined) return { registered: false };
  const packages = (JSON.parse(text) as { packages?: unknown }).packages;
  const listed = Array.isArray(packages)
    ? packages.some((entry) => {
        const listed = typeof entry === "string" ? entry : (entry as { source?: unknown })?.source;
        return listed === source || (typeof listed === "string" && listed.startsWith(`${source}@`));
      })
    : false;
  return { registered: listed };
}

async function readRegistration(
  state: RegistrationSource,
  binary: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<RegistrationState> {
  try {
    if (state.kind === "json") return readJsonKey(state.file, state.keyPath);
    if (state.kind === "toml") return readTomlTable(state.file, state.table);
    if (state.kind === "packages") return readPackages(state.file, state.source);
    return binary ? await readList(binary, state.args, env) : { registered: false };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { registered: null, error: `cannot read registration: ${detail.split("\n")[0].slice(0, 200)}` };
  }
}

async function findBinary(spec: HostSpec): Promise<string | undefined> {
  for (const name of spec.binaries) {
    const path = await resolveCommand(name);
    if (path) return path;
  }
  return undefined;
}

async function detectHost(spec: HostSpec, env: NodeJS.ProcessEnv): Promise<DetectedHost> {
  const binary = await findBinary(spec);
  const installed = binary !== undefined || (spec.apps ?? []).some((app) => existsSync(app));
  const version = binary ? await probeVersion(spec, binary, env) : undefined;
  const supported = installed && (!binary || !spec.versionProbe || version !== undefined);
  const registration =
    spec.registrationState.kind === "list" && binary && !supported
      ? { registered: null, error: "unrecognized version output; list command not run" }
      : await readRegistration(spec.registrationState, binary, env);
  return {
    id: spec.id,
    name: spec.name,
    installed,
    binary,
    version,
    supported,
    leftoverConfig: !installed && existsSync(spec.configHome),
    ...registration,
    spec,
  };
}

export async function detectHosts(env: NodeJS.ProcessEnv = process.env): Promise<DetectedHost[]> {
  const spawnEnv = { ...env, PATH: getSpawnEnv().PATH };
  return Promise.all(hostSpecs(env).map((spec) => detectHost(spec, spawnEnv)));
}
