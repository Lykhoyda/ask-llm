import { join } from "node:path";
import { antigravity } from "./registrars/antigravity.js";
import { claude } from "./registrars/claude.js";
import { codex } from "./registrars/codex.js";
import { gemini } from "./registrars/gemini.js";
import { grok } from "./registrars/grok.js";

export type HostId = "claude" | "codex" | "agy" | "grok" | "gemini" | "cursor" | "claude-desktop" | "pi" | "opencode";

export type Registration =
  | { kind: "command"; argv: (server: string) => string[] }
  | { kind: "json"; file: string; keyPath: string[]; entry: (server: string) => unknown };

export type RegistrationSource =
  | { kind: "json"; file: string; keyPath: string[] }
  | { kind: "toml"; file: string; table: string }
  | { kind: "list"; args: string[] }
  | { kind: "packages"; file: string; source: string };

export interface HostSpec {
  id: HostId;
  name: string;
  binaries: string[];
  apps?: string[];
  configHome: string;
  // The file the host's own mcp add/remove rewrites; backed up before each write.
  configFile?: string;
  versionProbe?: { args: string[]; pattern: RegExp };
  registration: Registration;
  registrationState: RegistrationSource;
  skillsDir?: string;
  pluginInstall?: string[][];
  restart: "new-session" | "app-restart";
  notice?: string;
  unverified?: boolean;
}

export const SERVER_NAME = "ask-llm";
export const PI_PACKAGE_SOURCE = "npm:@ask-llm/mcp";

const plainVersion = { args: ["--version"], pattern: /^v?(\d+\.\d+\.\d+)\s*$/ };

export function hostSpecs(env: NodeJS.ProcessEnv = process.env, platform = process.platform): HostSpec[] {
  const home = env.HOME ?? "";
  const claudeHome = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  const claudeFile = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, ".claude.json") : join(home, ".claude.json");
  const codexHome = env.CODEX_HOME ?? join(home, ".codex");
  const agyConfig = join(home, ".gemini", "config", "mcp_config.json");
  const geminiSettings = join(home, ".gemini", "settings.json");
  const grokHome = env.GROK_HOME ?? join(home, ".grok");
  const grokConfig = join(grokHome, "config.toml");
  const cursorConfig = join(home, ".cursor", "mcp.json");
  const desktopHome =
    platform === "darwin"
      ? join(home, "Library", "Application Support", "Claude")
      : join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "Claude");
  const desktopConfig = join(desktopHome, "claude_desktop_config.json");
  const piSettings = join(home, ".pi", "agent", "settings.json");
  const opencodeHome = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode");
  const opencodeConfig = join(opencodeHome, "opencode.json");
  const serverKey = ["mcpServers", SERVER_NAME];
  const stdioEntry = (server: string) => ({ command: server, args: [] });

  return [
    {
      id: "claude",
      name: "Claude Code",
      binaries: ["claude"],
      configHome: claudeHome,
      configFile: claudeFile,
      versionProbe: { args: ["--version"], pattern: /^(\d+\.\d+\.\d+) \(Claude Code\)/ },
      registration: { kind: "command", argv: (server) => claude("add", server) },
      // `claude mcp list` health-checks (spawns) every server, so read the user-scope file instead.
      registrationState: { kind: "json", file: claudeFile, keyPath: serverKey },
      skillsDir: join(claudeHome, "skills"),
      pluginInstall: [
        ["claude", "plugin", "marketplace", "add", "Lykhoyda/ask-llm"],
        ["claude", "plugin", "install", "ask-llm@ask-llm-plugins"],
      ],
      restart: "new-session",
    },
    {
      id: "codex",
      name: "Codex CLI",
      binaries: ["codex"],
      configHome: codexHome,
      configFile: join(codexHome, "config.toml"),
      versionProbe: { args: ["--version"], pattern: /^codex-cli (\d+\.\d+\.\d+)/ },
      registration: { kind: "command", argv: (server) => codex("add", server) },
      registrationState: { kind: "list", args: ["mcp", "list", "--json"] },
      skillsDir: join(codexHome, "skills"),
      restart: "new-session",
    },
    {
      id: "agy",
      name: "Antigravity",
      binaries: ["agy"],
      configHome: join(home, ".gemini", "config"),
      configFile: agyConfig,
      versionProbe: plainVersion,
      registration: { kind: "command", argv: (server) => antigravity("add", server) },
      registrationState: { kind: "json", file: agyConfig, keyPath: serverKey },
      skillsDir: join(home, ".gemini", "config", "skills"),
      restart: "new-session",
    },
    {
      id: "grok",
      name: "Grok Build",
      binaries: ["grok"],
      configHome: grokHome,
      configFile: grokConfig,
      versionProbe: { args: ["--version"], pattern: /^grok (\d+\.\d+\.\d+)/ },
      registration: { kind: "command", argv: (server) => grok("add", server) },
      // `grok mcp list` writes logs and docs under ~/.grok, so read the file its add command owns.
      registrationState: { kind: "toml", file: grokConfig, table: `mcp_servers.${SERVER_NAME}` },
      skillsDir: join(grokHome, "skills"),
      restart: "new-session",
    },
    {
      id: "gemini",
      name: "Gemini CLI",
      binaries: ["gemini"],
      configHome: geminiSettings,
      configFile: geminiSettings,
      versionProbe: plainVersion,
      registration: { kind: "command", argv: (server) => gemini("add", server) },
      registrationState: { kind: "json", file: geminiSettings, keyPath: serverKey },
      skillsDir: join(home, ".gemini", "skills"),
      restart: "new-session",
      notice:
        "Gemini CLI loads user MCP servers only in trusted folders; trust the folder in Gemini CLI to use Ask LLM there.",
    },
    {
      id: "cursor",
      name: "Cursor",
      binaries: ["agent", "cursor-agent"],
      apps: platform === "darwin" ? ["/Applications/Cursor.app", join(home, "Applications", "Cursor.app")] : [],
      configHome: join(home, ".cursor"),
      registration: { kind: "json", file: cursorConfig, keyPath: serverKey, entry: stdioEntry },
      registrationState: { kind: "json", file: cursorConfig, keyPath: serverKey },
      skillsDir: join(home, ".cursor", "skills"),
      restart: "app-restart",
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      binaries: ["claude-desktop"],
      apps: platform === "darwin" ? ["/Applications/Claude.app", join(home, "Applications", "Claude.app")] : [],
      configHome: desktopHome,
      registration: { kind: "json", file: desktopConfig, keyPath: serverKey, entry: stdioEntry },
      registrationState: { kind: "json", file: desktopConfig, keyPath: serverKey },
      restart: "app-restart",
    },
    {
      id: "pi",
      name: "Pi",
      binaries: ["pi"],
      configHome: join(home, ".pi"),
      versionProbe: plainVersion,
      registration: { kind: "command", argv: () => ["pi", "install", PI_PACKAGE_SOURCE] },
      registrationState: { kind: "packages", file: piSettings, source: PI_PACKAGE_SOURCE },
      restart: "new-session",
    },
    {
      id: "opencode",
      name: "OpenCode",
      binaries: ["opencode"],
      configHome: opencodeHome,
      versionProbe: plainVersion,
      registration: {
        kind: "json",
        file: opencodeConfig,
        keyPath: ["mcp", SERVER_NAME],
        entry: (server) => ({ type: "local", command: [server], enabled: true }),
      },
      registrationState: { kind: "json", file: opencodeConfig, keyPath: ["mcp", SERVER_NAME] },
      skillsDir: join(opencodeHome, "skills"),
      restart: "new-session",
      unverified: true,
    },
  ];
}
