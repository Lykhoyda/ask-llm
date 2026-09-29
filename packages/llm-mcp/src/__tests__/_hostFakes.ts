import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FakeMode = "ok" | "fail" | "silent" | "exists" | "exists-foreign" | "gone" | "unusable-after-remove";

export const FOREIGN = "/opt/other/ask-llm-mcp";
const RACE_EXISTS = "MCP server ask-llm already exists in user config";

interface Reply {
  code: number;
  message: string;
}

interface FakeHost {
  version: string;
  file: string;
  entry: string;
  empty: string;
  unusable: string;
  refuseExisting?: Reply;
  updateMessage?: string;
  notFound: Reply;
}

const json = (file: string): Pick<FakeHost, "file" | "entry" | "empty"> => ({
  file,
  entry: '{"mcpServers":{"other":{"command":"x"},"ask-llm":{"type":"stdio","command":"%s","args":[]}}}',
  empty: '{"mcpServers":{"other":{"command":"x"}}}',
  unusable: '{"mcpServers":{"ask-llm":{"command":"/opt/x/ask-llm-mcp","enabled":false}}}',
});

// Replies are the ones each real CLI printed in the S4 temp-HOME probes; only Claude refuses an existing entry.
export const FAKE_HOSTS: Record<string, FakeHost> = {
  claude: {
    version: "2.1.284 (Claude Code)",
    ...json(".claude.json"),
    refuseExisting: { code: 1, message: "MCP server ask-llm already exists in user config" },
    notFound: { code: 1, message: 'No MCP server named "ask-llm" in user scope' },
  },
  codex: {
    version: "codex-cli 0.158.0",
    file: ".codex/list.json",
    entry: '[{"name":"ask-llm","transport":{"type":"stdio","command":"%s","args":[]}}]',
    empty: "[]",
    unusable: '[{"name":"ask-llm","transport":{}}]',
    notFound: { code: 0, message: "No MCP server named 'ask-llm' found." },
  },
  agy: {
    version: "1.2.13",
    ...json(".gemini/config/mcp_config.json"),
    notFound: { code: 1, message: 'Error: MCP server "ask-llm" not found' },
  },
  grok: {
    version: "grok 1.0.40 (eb1a2256660d)",
    file: ".grok/config.toml",
    entry: '[mcp_servers.other]\\ncommand = "x"\\n\\n[mcp_servers.ask-llm]\\ncommand = "%s"\\nargs = []\\n',
    empty: '[mcp_servers.other]\\ncommand = "x"\\n',
    unusable: "[mcp_servers.ask-llm]\\nargs = []\\n",
    notFound: { code: 1, message: "No MCP server named 'ask-llm' in user config" },
  },
  gemini: {
    version: "0.46.0",
    ...json(".gemini/settings.json"),
    updateMessage: 'MCP server "ask-llm" is already configured within user settings.',
    notFound: { code: 0, message: 'Server "ask-llm" not found in user settings.' },
  },
};

export function installFakeHost(bin: string, name: string): void {
  const host = FAKE_HOSTS[name];
  const file = `"$HOME/${host.file}"`;
  const script = [
    "#!/bin/sh",
    `if [ "$1" = "--version" ]; then echo "${host.version}"; exit 0; fi`,
    `if [ "$*" = "mcp list --json" ]; then cat ${file} 2>/dev/null || echo "[]"; exit 0; fi`,
    // Plugin commands answer like Claude Code 2.1.284 did in the temp-HOME probes; logged apart from MCP argv.
    `if [ "$1" = plugin ]; then echo "$*" >> "$HOME/.fake-${name}-plugin-argv"; p="$HOME/.claude/plugins"; mkdir -p "$p"`,
    `  [ "$2" = marketplace ] && echo '{"ask-llm-plugins":{}}' > "$p/known_marketplaces.json"`,
    `  [ "$2" = install ] && echo '{"version":2,"plugins":{"ask-llm@ask-llm-plugins":[{"scope":"user"}]}}' > "$p/installed_plugins.json"`,
    "  exit 0; fi",
    `printf '%s\\t' "$@" >> "$HOME/.fake-${name}-argv"; echo >> "$HOME/.fake-${name}-argv"`,
    `mode=$(cat "$HOME/.fake-${name}-mode" 2>/dev/null)`,
    `if [ "$mode" = fail ]; then echo "error: unexpected argument --scope found" >&2; exit 2; fi`,
    `if [ "$mode" = silent ]; then exit 0; fi`,
    `present=no; grep -qE '"ask-llm"|mcp_servers[.]ask-llm' ${file} 2>/dev/null && present=yes`,
    'for arg; do last="$arg"; done',
    `mkdir -p "$(dirname ${file})"`,
    // Race modes: the entry changes between the pre-spawn read and the host command.
    `if [ "$mode" = exists ]; then printf '${host.entry}' "$last" > ${file}; echo '${RACE_EXISTS}' >&2; exit 1; fi`,
    `if [ "$mode" = exists-foreign ]; then printf '${host.entry}' "${FOREIGN}" > ${file}; echo '${RACE_EXISTS}' >&2; exit 1; fi`,
    `if [ "$mode" = gone ]; then printf '${host.empty}' > ${file}; echo '${host.notFound.message}' >&2; exit ${host.notFound.code}; fi`,
    `if [ "$mode" = unusable-after-remove ] && [ "$2" = remove ]; then printf '${host.unusable}' > ${file}; exit 0; fi`,
    'if [ "$2" = add ]; then',
    host.refuseExisting
      ? `  if [ $present = yes ]; then echo '${host.refuseExisting.message}' >&2; exit ${host.refuseExisting.code}; fi`
      : "",
    host.updateMessage ? `  if [ $present = yes ]; then echo '${host.updateMessage}'; fi` : "",
    `  printf '${host.entry}' "$last" > ${file}; exit 0`,
    "fi",
    `if [ $present = no ]; then echo '${host.notFound.message}' >&2; exit ${host.notFound.code}; fi`,
    `printf '${host.empty}' > ${file}`,
  ]
    .filter(Boolean)
    .join("\n");
  writeFileSync(join(bin, name), `${script}\n`);
  chmodSync(join(bin, name), 0o755);
}

export function setFakeMode(home: string, name: string, mode: FakeMode): void {
  writeFileSync(join(home, `.fake-${name}-mode`), mode);
}

export function fakeArgv(home: string, name: string): string[][] {
  const file = join(home, `.fake-${name}-argv`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t").slice(0, -1));
}

export function writeRegistration(home: string, name: string, command: string): void {
  const host = FAKE_HOSTS[name];
  const path = join(home, host.file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, host.entry.replaceAll("\\n", "\n").replace("%s", command));
}

export function writeUnusableRegistration(home: string, name: string): void {
  const host = FAKE_HOSTS[name];
  const path = join(home, host.file);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, host.unusable.replaceAll("\\n", "\n"));
}

// Mirrors skills@1.7.0 from the temp-HOME probes: writes where the real CLI writes, "Invalid agents" exits 1.
export const FAKE_NPX = `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/npx-argv"
mode=$(cat "$HOME/npx-mode" 2>/dev/null || echo ok)
[ "$mode" = fail ] && { echo "network error" >&2; exit 1; }
agents=$(printf '%s\\n' "$@" | sed -n '/^-a$/,/^-y$/p' | sed '1d;$d')
for agent in $agents; do
  case $agent in codex|cursor|gemini-cli|opencode|grok|pi) ;; *) echo "Invalid agents: $agent" >&2; exit 1 ;; esac
done
skills=$(printf '%s\\n' "$@" | sed -n '/^--skill$/,/^-g$/p' | sed '1d;$d')
for agent in $agents; do
  case $agent in grok) dir="$HOME/.grok/skills" ;; pi) dir="$HOME/.pi/agent/skills" ;; *) dir="$HOME/.agents/skills" ;; esac
  for skill in $skills; do mkdir -p "$dir/$skill" && echo x > "$dir/$skill/SKILL.md"; done
done
`;

export function installFakeNpx(bin: string): void {
  writeFileSync(join(bin, "npx"), FAKE_NPX);
  chmodSync(join(bin, "npx"), 0o755);
}
