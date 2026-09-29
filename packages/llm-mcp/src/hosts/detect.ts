import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSpawnEnv } from "@ask-llm/shared";
import { resolveCommand } from "../utils/availability.js";
import { type HostId, type HostSpec, hostSpecs, type RegistrationSource, SERVER_NAME } from "./registry.js";
import { runHost } from "./spawn.js";

const PROBE_TIMEOUT_MS = 5000;

export interface RegistrationState {
  registered: boolean | null;
  command?: string[];
  present?: boolean;
  error?: string;
}

function state(found: boolean, command: string[] | undefined): RegistrationState {
  if (command) return { registered: true, command };
  return found ? { registered: false, present: true } : { registered: false };
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
  const { code, stdout, stderr } = await runHost(binary, args, env, PROBE_TIMEOUT_MS);
  if (code !== 0)
    throw new Error(`\`${[binary, ...args].join(" ")}\` exited ${code ?? "on timeout or signal"}: ${stderr}`);
  return stdout || stderr;
}

async function probeVersion(spec: HostSpec, binary: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  if (!spec.versionProbe) return undefined;
  const probeHome = ["gemini", "grok"].includes(spec.id)
    ? mkdtempSync(join(tmpdir(), "ask-llm-host-probe-"))
    : undefined;
  try {
    const probeEnv = probeHome
      ? { ...env, HOME: probeHome, XDG_CONFIG_HOME: probeHome, XDG_CACHE_HOME: probeHome, GROK_HOME: probeHome }
      : env;
    const firstLine = (await run(binary, spec.versionProbe.args, probeEnv)).split(/\r?\n/)[0]?.trim() ?? "";
    return spec.versionProbe.pattern.exec(firstLine)?.[1];
  } catch {
    return undefined;
  } finally {
    if (probeHome) rmSync(probeHome, { recursive: true, force: true });
  }
}

export function entryCommand(entry: unknown): string[] | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const { command, args, enabled } = entry as { command?: unknown; args?: unknown; enabled?: unknown };
  if (
    enabled === false ||
    (args !== undefined && (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")))
  )
    return undefined;
  const rest = (args as string[] | undefined) ?? [];
  if (typeof command === "string" && command.trim()) return [command, ...rest];
  if (Array.isArray(command) && command.length > 0 && command.every((part) => typeof part === "string" && part.trim()))
    return [...command, ...rest];
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

function readJsonKey(file: string, keyPath: string[], jsonc?: string): RegistrationState {
  if (jsonc && existsSync(jsonc)) throw new Error(`${jsonc} exists and setup does not rewrite JSONC`);
  const text = readText(file);
  if (text === undefined) return { registered: false };
  let value: unknown = JSON.parse(text);
  for (const key of keyPath) {
    if (value === null || typeof value !== "object") return { registered: false };
    value = (value as Record<string, unknown>)[key];
  }
  return state(value !== undefined, entryCommand(value));
}

function readTomlTable(file: string, table: string): RegistrationState {
  const text = readText(file);
  if (text === undefined) return { registered: false };
  let currentTable = "";
  let inTable = false;
  let found = false;
  let command: string | undefined;
  let args: unknown = [];
  let enabled: unknown;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inTable = trimmed === `[${table}]` || trimmed === `[mcp_servers."${SERVER_NAME}"]`;
      if (inTable) {
        if (found) throw new Error("unsupported Grok TOML duplicate ask-llm table");
        found = true;
        currentTable = table;
      } else {
        const header =
          /^\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\]$|^\[\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\]\]$/.exec(trimmed);
        currentTable = header?.[1] ?? header?.[2] ?? "";
        if (!header || currentTable === "mcp_servers" || currentTable === table)
          throw new Error("unsupported Grok TOML table header");
        if (currentTable.startsWith(`${table}.`)) throw new Error("unsupported Grok TOML nested ask-llm table");
      }
      continue;
    }
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (currentTable === "") {
      const rootKey = /^([A-Za-z0-9_-]+)\s*=/.exec(trimmed);
      if (!rootKey || rootKey[1] === "mcp_servers") throw new Error("unsupported Grok TOML root key");
    }
    if (!inTable) continue;
    if (trimmed.includes("\\")) throw new Error("unsupported Grok TOML escape for ask-llm");
    const pair = /^(command|args|enabled)\s*=\s*(.+)$/.exec(trimmed);
    if (!pair) throw new Error("unsupported Grok TOML key syntax for ask-llm");
    let value: unknown;
    try {
      value = JSON.parse(pair[2]);
    } catch {
      const form = pair[2].startsWith("'")
        ? "single-quoted value"
        : pair[2].startsWith("[") && !pair[2].includes("]")
          ? "multiline array"
          : pair[2].includes("#")
            ? "trailing comment"
            : "value syntax";
      throw new Error(`unsupported Grok TOML ${form} for ask-llm`);
    }
    if (pair[1] === "command") command = value as string;
    if (pair[1] === "args") args = value;
    if (pair[1] === "enabled") enabled = value;
  }
  return state(found, found ? entryCommand({ command, args, enabled }) : undefined);
}

async function readList(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<RegistrationState> {
  const servers = JSON.parse(await run(binary, args, env)) as Array<{
    name?: string;
    transport?: { command?: unknown; args?: unknown };
  }>;
  const entry = servers.find((server) => server.name === SERVER_NAME);
  return state(entry !== undefined, entryCommand(entry?.transport));
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

export async function readRegistration(
  state: RegistrationSource,
  binary: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<RegistrationState> {
  try {
    if (state.kind === "json") return readJsonKey(state.file, state.keyPath, state.jsonc);
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
