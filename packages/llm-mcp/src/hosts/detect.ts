import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getSpawnEnv } from "@ask-llm/shared";
import { resolveCommand } from "../utils/availability.js";
import { type HostId, type HostSpec, hostSpecs, type RegistrationSource, SERVER_NAME } from "./registry.js";
import { runHost } from "./spawn.js";

const PROBE_TIMEOUT_MS = 5000;

export interface RegistrationState {
  registered: boolean | null;
  command?: string[];
  // Settings beyond the command that setup would not carry over, named without their values.
  custom?: string;
  present?: boolean;
  // Package sources of an earlier Ask LLM install that the host still lists.
  legacy?: string[];
  error?: string;
}

function state(found: boolean, command: string[] | undefined, custom?: string): RegistrationState {
  if (command) return custom ? { registered: true, command, custom } : { registered: true, command };
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

// Keys every host writes for a plain stdio entry; any other key with a value is the user's own setting.
const ENTRY_KEYS = new Set(["name", "command", "args", "transport", "disabled_reason", "auth_status"]);

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value as object).length === 0;
}

export function customSettings(entry: unknown): string | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const settings: string[] = [];
  const visit = (fields: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(fields)) {
      if (key === "transport" && value !== null && typeof value === "object") visit(value as Record<string, unknown>);
      else if (key === "enabled") {
        if (value !== true) settings.push(`enabled ${JSON.stringify(value)}`);
      } else if (key === "type") {
        if (value !== "stdio" && value !== "local") settings.push(`type ${JSON.stringify(value)}`);
      } else if (!ENTRY_KEYS.has(key) && !isEmpty(value)) {
        settings.push(
          value !== null && typeof value === "object" && !Array.isArray(value)
            ? `${key} ${Object.keys(value).join(", ")}`
            : key,
        );
      }
    }
  };
  visit(entry as Record<string, unknown>);
  return settings.length > 0 ? settings.join("; ") : undefined;
}

export function readText(file: string): string | undefined {
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
  return state(value !== undefined, entryCommand(value), customSettings(value));
}

function readTomlTable(file: string, table: string): RegistrationState {
  const name = table.slice("mcp_servers.".length);
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
      inTable = trimmed === `[${table}]` || trimmed === `[mcp_servers."${name}"]`;
      if (inTable) {
        if (found) throw new Error(`unsupported Grok TOML duplicate ${name} table`);
        found = true;
        currentTable = table;
      } else {
        const header =
          /^\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\]$|^\[\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)\]\]$/.exec(trimmed);
        currentTable = header?.[1] ?? header?.[2] ?? "";
        if (!header || currentTable === "mcp_servers" || currentTable === table)
          throw new Error("unsupported Grok TOML table header");
        if (currentTable.startsWith(`${table}.`)) throw new Error(`unsupported Grok TOML nested ${name} table`);
      }
      continue;
    }
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (currentTable === "") {
      const rootKey = /^([A-Za-z0-9_-]+)\s*=/.exec(trimmed);
      if (!rootKey || rootKey[1] === "mcp_servers") throw new Error("unsupported Grok TOML root key");
    }
    if (!inTable) continue;
    if (trimmed.includes("\\")) throw new Error(`unsupported Grok TOML escape for ${name}`);
    const pair = /^(command|args|enabled)\s*=\s*(.+)$/.exec(trimmed);
    if (!pair) throw new Error(`unsupported Grok TOML key syntax for ${name}`);
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
      throw new Error(`unsupported Grok TOML ${form} for ${name}`);
    }
    if (pair[1] === "command") command = value as string;
    if (pair[1] === "args") args = value;
    if (pair[1] === "enabled") enabled = value;
  }
  return state(found, found ? entryCommand({ command, args, enabled }) : undefined);
}

interface ListedServer {
  name?: unknown;
  transport?: { command?: unknown; args?: unknown };
}

async function listed(binary: string, args: string[], env: NodeJS.ProcessEnv): Promise<ListedServer[]> {
  const servers = JSON.parse(await run(binary, args, env));
  if (!Array.isArray(servers)) throw new Error("the server list is not a JSON array");
  return servers;
}

async function readList(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  name = SERVER_NAME,
): Promise<RegistrationState> {
  const entry = (await listed(binary, args, env)).find((server) => server.name === name);
  return state(entry !== undefined, entryCommand(entry?.transport), customSettings(entry));
}

// Pi's own test for a local package source: anything without a remote prefix.
const REMOTE_PI_SOURCE = /^(npm|git|github|http|https|ssh):/;

function samePath(left: string, right: string): boolean {
  const real = (path: string) => (existsSync(path) ? realpathSync(path) : resolve(path));
  return real(left) === real(right);
}

function readPackages(
  file: string,
  sources: string[],
  legacySources: string[],
  localDir: string | undefined,
): RegistrationState {
  const text = readText(file);
  if (text === undefined) return { registered: false };
  const packages = (JSON.parse(text) as { packages?: unknown }).packages;
  const entries: unknown[] = Array.isArray(packages) ? packages : [];
  const isSource = (listed: string, among: string[]) =>
    among.some((source) => listed === source || listed.startsWith(`${source}@`));
  const isLocal = (listed: string) =>
    localDir !== undefined &&
    !REMOTE_PI_SOURCE.test(listed.trim()) &&
    samePath(resolve(dirname(file), listed.trim()), localDir);
  let registered = false;
  const legacy: string[] = [];
  const settings = new Set<string>();
  for (const entry of entries) {
    const source = typeof entry === "string" ? entry : (entry as { source?: unknown } | null)?.source;
    if (typeof source !== "string") continue;
    const current = isSource(source, sources) || isLocal(source);
    const earlier = isSource(source, legacySources);
    if (!current && !earlier) continue;
    if (current) registered = true;
    if (earlier) legacy.push(source);
    if (typeof entry === "object" && entry !== null)
      for (const key of Object.keys(entry)) if (key !== "source") settings.add(key);
  }
  return {
    registered,
    ...(legacy.length > 0 ? { legacy } : {}),
    ...(settings.size > 0 ? { custom: [...settings].join(", ") } : {}),
  };
}

// The same registration surface, read for another server name.
export function namedSource(source: RegistrationSource, name: string): RegistrationSource {
  if (source.kind === "json") return { ...source, keyPath: [...source.keyPath.slice(0, -1), name] };
  if (source.kind === "toml") return { ...source, table: `mcp_servers.${name}` };
  if (source.kind === "list") return { ...source, name };
  return source;
}

export interface ServerEntry {
  name: string;
  command?: string[];
  custom?: string;
  // Why the entry could not be read; `text` is its raw form, for recognizing what it runs.
  error?: string;
  text?: string;
}

function tomlTableText(text: string, name: string): string {
  const lines: string[] = [];
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[+\s*mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))/.exec(line);
    if (/^\s*\[/.test(line)) inside = (header?.[1] ?? header?.[2]) === name;
    if (inside) lines.push(line);
  }
  return lines.join("\n");
}

// Every MCP server entry a host lists at user scope, read from the same surface as its ask-llm entry.
export async function listServers(
  source: RegistrationSource,
  binary: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<ServerEntry[]> {
  if (source.kind === "json") {
    if (source.jsonc && existsSync(source.jsonc))
      throw new Error(`${source.jsonc} exists and setup does not rewrite JSONC`);
    const text = readText(source.file);
    if (text === undefined) return [];
    let value: unknown = JSON.parse(text);
    for (const key of source.keyPath.slice(0, -1)) {
      value = value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.entries(value).map(([name, entry]) => ({
      name,
      command: entryCommand(entry),
      custom: customSettings(entry),
      text: JSON.stringify(entry),
    }));
  }
  if (source.kind === "toml") {
    const text = readText(source.file);
    if (text === undefined) return [];
    const header = /^\s*\[mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]\s*$/gm;
    const names = new Set([...text.matchAll(header)].map((match) => match[1] ?? match[2]));
    return [...names].map((name) => {
      try {
        const { command } = readTomlTable(source.file, `mcp_servers.${name}`);
        return { name, command, text: tomlTableText(text, name) };
      } catch (error) {
        return { name, error: (error as Error).message, text: tomlTableText(text, name) };
      }
    });
  }
  if (source.kind === "list") {
    if (!binary) return [];
    return (await listed(binary, source.args, env))
      .filter((server): server is ListedServer & { name: string } => typeof server.name === "string")
      .map((server) => ({
        name: server.name,
        command: entryCommand(server.transport),
        custom: customSettings(server),
        text: JSON.stringify(server),
      }));
  }
  return [];
}

export async function readRegistration(
  state: RegistrationSource,
  binary: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<RegistrationState> {
  try {
    if (state.kind === "json") return readJsonKey(state.file, state.keyPath, state.jsonc);
    if (state.kind === "toml") return readTomlTable(state.file, state.table);
    if (state.kind === "packages") return readPackages(state.file, state.sources, state.legacySources, state.localDir);
    return binary ? await readList(binary, state.args, env, state.name) : { registered: false };
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
  return Promise.all(hostSpecs(env).map((spec) => detectHost(spec, { ...spawnEnv, ...spec.env })));
}
