import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { getSpawnEnv } from "@ask-llm/shared";
import { resolveCommand } from "../utils/availability.js";
import { type HostId, type HostSpec, hostSpecs, type RegistrationSource, SERVER_NAME } from "./registry.js";
import { runHost } from "./spawn.js";

const PROBE_TIMEOUT_MS = 5000;

export const INCOMPLETE_REGISTRATION =
  "the host list omits persisted settings and may include project overrides; user-scope ownership is unverified";

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

export function customSettings(entry: unknown, packageEntry = false): string | undefined {
  if (entry === null || typeof entry !== "object") return undefined;
  const settings: string[] = [];
  for (const [key, value] of Object.entries(entry)) {
    const known = packageEntry
      ? key === "source"
      : key === "command" ||
        key === "args" ||
        (key === "type" && (value === "stdio" || value === "local")) ||
        (key === "enabled" && value === true) ||
        (key === "env" &&
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          Object.keys(value).length === 0);
    if (!known) {
      settings.push(
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? `${key} ${Object.keys(value).join(", ")}`.trimEnd()
          : key,
      );
    }
  }
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

// Grok Build writes an args list of two or more elements one per line, and `-e` settings as a nested
// `env` table; the env values are skipped, only their names are reported.
function readTomlTable(file: string, table: string): RegistrationState {
  const name = table.slice("mcp_servers.".length);
  const text = readText(file);
  if (text === undefined) return { registered: false };
  let currentTable = "";
  let inTable = false;
  let inEnv = false;
  let found = false;
  let command: string | undefined;
  let args: unknown = [];
  let enabled: unknown;
  let env: Record<string, true> | undefined;
  let array: { key: string; text: string } | undefined;
  const assign = (key: string, value: unknown) => {
    if (key === "command") command = value as string;
    if (key === "args") args = value;
    if (key === "enabled") enabled = value;
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (array) {
      if (trimmed.includes("\\")) throw new Error(`unsupported Grok TOML escape for ${name}`);
      if (!trimmed || trimmed.startsWith("#")) continue;
      array.text += trimmed;
      if (!trimmed.endsWith("]")) continue;
      let value: unknown;
      try {
        value = JSON.parse(array.text.replace(/,\s*\]$/, "]"));
      } catch {
        throw new Error(`unsupported Grok TOML multiline array for ${name}`);
      }
      assign(array.key, value);
      array = undefined;
      continue;
    }
    if (trimmed.startsWith("[")) {
      inTable = trimmed === `[${table}]` || trimmed === `[mcp_servers."${name}"]`;
      inEnv = trimmed === `[${table}.env]` || trimmed === `[mcp_servers."${name}".env]`;
      if (inTable) {
        if (found) throw new Error(`unsupported Grok TOML duplicate ${name} table`);
        found = true;
        currentTable = table;
      } else if (inEnv) {
        if (!found || env) throw new Error(`unsupported Grok TOML nested ${name} table`);
        env = {};
        currentTable = `${table}.env`;
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
    if (inEnv && env) {
      // A single-line basic or literal string; its value never leaves this function.
      const setting = /^([A-Za-z0-9_-]+)\s*=\s*(?:"(?:[^"\\]|\\.)*"|'[^']*')$/.exec(trimmed);
      if (!setting) throw new Error(`unsupported Grok TOML env syntax for ${name}`);
      env[setting[1]] = true;
      continue;
    }
    if (!inTable) continue;
    if (trimmed.includes("\\")) throw new Error(`unsupported Grok TOML escape for ${name}`);
    const pair = /^(command|args|enabled)\s*=\s*(.+)$/.exec(trimmed);
    if (!pair) throw new Error(`unsupported Grok TOML key syntax for ${name}`);
    if (pair[2] === "[") {
      array = { key: pair[1], text: "[" };
      continue;
    }
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
    assign(pair[1], value);
  }
  if (array) throw new Error(`unsupported Grok TOML multiline array for ${name}`);
  const entry = { command, args, ...(enabled === undefined ? {} : { enabled }), ...(env ? { env } : {}) };
  return state(found, found ? entryCommand(entry) : undefined, customSettings(entry));
}

interface ListedServer {
  name?: unknown;
  enabled?: unknown;
  transport?: { command?: unknown; args?: unknown };
}

function listedCommand(entry: ListedServer | undefined): string[] | undefined {
  return entry?.enabled === false ? undefined : entryCommand(entry?.transport);
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
  return { registered: null, command: listedCommand(entry), error: INCOMPLETE_REGISTRATION };
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
    const current = isLocal(source);
    const earlier = isSource(source, legacySources);
    const unverified = isSource(source, sources) || earlier;
    if (!current && !unverified) continue;
    if (current) registered = true;
    if (unverified) settings.add("unverified package compatibility");
    if (earlier) legacy.push(source);
    const custom = customSettings(entry, true);
    if (custom) settings.add(custom);
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

// Read the same surface as the ask-llm entry; list projections cannot establish user-scope ownership.
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
        const { command, custom } = readTomlTable(source.file, `mcp_servers.${name}`);
        return { name, command, custom, text: tomlTableText(text, name) };
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
        command: listedCommand(server),
        error: INCOMPLETE_REGISTRATION,
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
