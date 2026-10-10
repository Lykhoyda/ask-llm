import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Fake host CLIs that keep any number of named MCP servers where each real CLI keeps them (Codex's
// `mcp list --json` reply stands in for its TOML). Claude refuses to add over an existing name;
// the others overwrite, as the S4 probes recorded. `.fake-<host>-mode` holds one optional fault.
export type MigrationFakeMode = "ok" | "fail-add" | "fail-add-after-user-edit" | "fail-remove";

export const MIGRATION_HOSTS = ["claude", "codex", "agy", "grok", "gemini"] as const;
export type MigrationHost = (typeof MIGRATION_HOSTS)[number];

const VERSIONS: Record<MigrationHost, string> = {
  claude: "2.1.284 (Claude Code)",
  codex: "codex-cli 0.158.0",
  agy: "1.2.13",
  grok: "grok 1.0.40 (eb1a2256660d)",
  gemini: "0.46.0",
};

export const HOST_FILES: Record<MigrationHost, string> = {
  claude: ".claude.json",
  codex: ".codex/list.json",
  agy: ".gemini/config/mcp_config.json",
  grok: ".grok/config.toml",
  gemini: ".gemini/settings.json",
};

// Grok Build's `grok mcp add` writes an args list of two or more elements one element per line (the fake
// CLI script below keeps a copy).
function grokArgs(args: string[]): string[] {
  return args.length < 2
    ? [`args = ${JSON.stringify(args)}`]
    : ["args = [", ...args.map((arg) => `    ${JSON.stringify(arg)},`), "]"];
}

const SCRIPT = String.raw`
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const host = HOST;
const home = process.env.HOME;
const file = join(home, FILE);
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log(VERSION); process.exit(PROBE_EXIT); }
const read = () => (existsSync(file) ? readFileSync(file, "utf8") : undefined);
if (args.join(" ") === "mcp list --json") { console.log(read() ?? "[]"); process.exit(0); }
appendFileSync(join(home, ".fake-" + host + "-argv"), args.join("\t") + "\t\n");
const mode = existsSync(join(home, ".fake-" + host + "-mode")) ? readFileSync(join(home, ".fake-" + host + "-mode"), "utf8") : "ok";
const rest = args.slice(2).filter((arg, index, all) => arg !== "--scope" && all[index - 1] !== "--scope");
const op = args[1];
const name = rest[0];
const dash = rest.indexOf("--");
const command = dash === -1 ? rest.slice(1) : rest.slice(dash + 1);
mkdirSync(dirname(file), { recursive: true });

function grokArgs(args) {
  return args.length < 2 ? ["args = " + JSON.stringify(args)] : ["args = [", ...args.map((arg) => "    " + JSON.stringify(arg) + ","), "]"];
}

function tomlTables(text) {
  const chunks = [];
  for (const line of (text ?? "").split("\n")) {
    if (line.startsWith("[") || chunks.length === 0) chunks.push([]);
    chunks[chunks.length - 1].push(line);
  }
  return chunks.map((lines) => lines.join("\n"));
}
const belongs = (chunk) => chunk.startsWith("[mcp_servers." + name + "]") || chunk.startsWith("[mcp_servers." + name + ".");

function has() {
  const text = read();
  if (text === undefined) return false;
  if (host === "grok") return tomlTables(text).some(belongs);
  if (host === "codex") return JSON.parse(text).some((server) => server.name === name);
  return Boolean(JSON.parse(text).mcpServers?.[name]);
}

function write(entry) {
  const text = read();
  if (host === "grok") {
    const kept = tomlTables(text).filter((chunk) => !belongs(chunk) && chunk.trim());
    const table = entry ? ["[mcp_servers." + name + "]", "command = " + JSON.stringify(entry[0]), ...grokArgs(entry.slice(1))].join("\n") : undefined;
    writeFileSync(file, [...kept.map((chunk) => chunk.trimEnd()), ...(table ? [table] : [])].join("\n\n") + "\n");
    return;
  }
  if (host === "codex") {
    const servers = text === undefined ? [] : JSON.parse(text);
    const kept = servers.filter((server) => server.name !== name);
    if (entry) kept.push({ name, enabled: true, disabled_reason: null, transport: { type: "stdio", command: entry[0], args: entry.slice(1), env: null, env_vars: [], cwd: null }, startup_timeout_sec: null, tool_timeout_sec: null, auth_status: "unsupported" });
    writeFileSync(file, JSON.stringify(kept, null, 2));
    return;
  }
  const config = text === undefined ? {} : JSON.parse(text);
  config.mcpServers ??= {};
  if (entry) config.mcpServers[name] = host === "claude" ? { type: "stdio", command: entry[0], args: entry.slice(1), env: {} } : { command: entry[0], args: entry.slice(1) };
  else delete config.mcpServers[name];
  // agy 1.3.2 rewrites the whole file and drops every empty args array, including unrelated servers'.
  if (host === "agy") for (const server of Object.values(config.mcpServers)) if (Array.isArray(server.args) && server.args.length === 0) delete server.args;
  writeFileSync(file, JSON.stringify(config, null, 2));
}

function userEdit() {
  const config = JSON.parse(read());
  config.userEdit = "made while setup ran";
  writeFileSync(file, JSON.stringify(config, null, 2));
}

if (op === "add") {
  if (mode === "fail-add") { console.error("error: unexpected argument found"); process.exit(2); }
  if (mode === "fail-add-after-user-edit" && command[0] !== "npx") { console.error("error: unexpected argument found"); process.exit(2); }
  if (host === "claude" && has()) { console.error("MCP server " + name + " already exists in user config"); process.exit(1); }
  write(command);
  process.exit(0);
}
if (op === "remove") {
  if (mode === "fail-remove") { console.error("error: permission denied"); process.exit(2); }
  if (!has()) { console.error("No MCP server named " + name); process.exit(host === "codex" || host === "gemini" ? 0 : 1); }
  write(undefined);
  if (mode === "fail-add-after-user-edit") userEdit();
  process.exit(0);
}
process.exit(9);
`;

export function installMigrationHost(
  bin: string,
  host: MigrationHost,
  probe: "ok" | "mismatch" | "failed" = "ok",
): void {
  const script = SCRIPT.replace("HOST", JSON.stringify(host))
    .replace("FILE", JSON.stringify(HOST_FILES[host]))
    .replace("VERSION", JSON.stringify(probe === "mismatch" ? "unknown version" : VERSIONS[host]))
    .replace("PROBE_EXIT", probe === "failed" ? "1" : "0");
  writeFileSync(join(bin, host), `#!${process.execPath}\n${script}`);
  chmodSync(join(bin, host), 0o755);
}

export function setMigrationMode(home: string, host: MigrationHost, mode: MigrationFakeMode): void {
  writeFileSync(join(home, `.fake-${host}-mode`), mode);
}

export function migrationArgv(home: string, host: MigrationHost): string[][] {
  const file = join(home, `.fake-${host}-argv`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t").slice(0, -1));
}

export interface SeedEntry {
  command: string[];
  env?: Record<string, string>;
}

// Writes the servers the way each host's own add command stores them.
export function seedServers(home: string, host: MigrationHost, servers: Record<string, SeedEntry>, extra = {}): void {
  const path = join(home, HOST_FILES[host]);
  mkdirSync(join(path, ".."), { recursive: true });
  const entries = Object.entries(servers);
  if (host === "grok") {
    const tables = entries.map(([name, { command, env }]) =>
      [
        `[mcp_servers.${name}]`,
        `command = ${JSON.stringify(command[0])}`,
        ...grokArgs(command.slice(1)),
        ...(env
          ? ["", `[mcp_servers.${name}.env]`, ...Object.entries(env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`)]
          : []),
      ].join("\n"),
    );
    writeFileSync(path, `${['[ui]\ntheme = "dark"', ...tables].join("\n\n")}\n`);
    return;
  }
  if (host === "codex") {
    const list = entries.map(([name, { command, env }]) => ({
      name,
      enabled: true,
      disabled_reason: null,
      transport: {
        type: "stdio",
        command: command[0],
        args: command.slice(1),
        env: env ?? null,
        env_vars: [],
        cwd: null,
      },
      startup_timeout_sec: null,
      tool_timeout_sec: null,
      auth_status: "unsupported",
    }));
    writeFileSync(path, JSON.stringify(list, null, 2));
    return;
  }
  const mcpServers = Object.fromEntries(
    entries.map(([name, { command, env }]) => [
      name,
      host === "claude"
        ? { type: "stdio", command: command[0], args: command.slice(1), env: env ?? {} }
        : { command: command[0], args: command.slice(1), ...(env ? { env } : {}) },
    ]),
  );
  writeFileSync(path, JSON.stringify({ ...extra, mcpServers }, null, 2));
}

export function readHostFile(home: string, host: MigrationHost): string {
  return readFileSync(join(home, HOST_FILES[host]), "utf8");
}

export function serverNames(home: string, host: MigrationHost): Record<string, string[]> {
  const text = readHostFile(home, host);
  if (host === "grok") {
    const names: Record<string, string[]> = {};
    let current: string | undefined;
    let inArgs = false;
    for (const line of text.split("\n")) {
      if (current && inArgs) {
        if (line === "]") inArgs = false;
        else names[current] = [...(names[current] ?? []), JSON.parse(line.trim().replace(/,$/, ""))];
        continue;
      }
      const header = /^\[mcp_servers\.([^.\]]+)\]$/.exec(line);
      if (header) current = header[1];
      else if (line.startsWith("[")) current = undefined;
      const command = /^command = (.+)$/.exec(line);
      const args = /^args = (.+)$/.exec(line);
      if (current && command) names[current] = [JSON.parse(command[1]), ...(names[current] ?? [])];
      if (current && args) {
        if (args[1] === "[") inArgs = true;
        else names[current] = [...(names[current] ?? []), ...JSON.parse(args[1])];
      }
    }
    return names;
  }
  if (host === "codex") {
    return Object.fromEntries(
      (JSON.parse(text) as Array<{ name: string; transport: { command: string; args: string[] } }>).map((server) => [
        server.name,
        [server.transport.command, ...server.transport.args],
      ]),
    );
  }
  const servers = JSON.parse(text).mcpServers as Record<string, { command: string; args?: string[] }>;
  return Object.fromEntries(
    Object.entries(servers).map(([name, entry]) => [name, [entry.command, ...(entry.args ?? [])]]),
  );
}
