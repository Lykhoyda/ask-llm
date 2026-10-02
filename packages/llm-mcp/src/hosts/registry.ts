import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_DIR } from "../packageMetadata.js";
import type { HostOp } from "./apply.js";
import type { JsonEdit } from "./json-merge.js";
import { antigravity } from "./registrars/antigravity.js";
import { claude } from "./registrars/claude.js";
import { claudeDesktop } from "./registrars/claude-desktop.js";
import { codex } from "./registrars/codex.js";
import { cursor } from "./registrars/cursor.js";
import { gemini } from "./registrars/gemini.js";
import { grok } from "./registrars/grok.js";
import { opencode } from "./registrars/opencode.js";

export type HostId = "claude" | "codex" | "agy" | "grok" | "gemini" | "cursor" | "claude-desktop" | "pi" | "opencode";

export type Registration =
  | { kind: "command"; argv: (server: string) => string[] }
  | { kind: "json"; file: string; edit: (op: HostOp, server: string) => JsonEdit };

export type RegistrationSource =
  // A `jsonc` sibling the host also loads makes the registration unknown, since setup never rewrites JSONC.
  | { kind: "json"; file: string; keyPath: string[]; jsonc?: string }
  | { kind: "toml"; file: string; table: string }
  | { kind: "list"; args: string[] }
  // `localDir` matches the local package entry `pi install <dir>` records relative to the settings folder.
  | { kind: "packages"; file: string; sources: string[]; localDir?: string };

export interface HostSpec {
  id: HostId;
  name: string;
  binaries: string[];
  apps?: string[];
  configHome: string;
  env?: NodeJS.ProcessEnv;
  // The file setup or the host's own mcp add/remove rewrites; backed up before each write.
  configFile?: string;
  versionProbe?: { args: string[]; pattern: RegExp };
  registration: Registration;
  registrationState: RegistrationSource;
  // Where the skills land for this host; `skillsAgent` is its id in the pinned skills CLI.
  skillsDir?: string;
  skillsAgent?: string;
  pluginInstall?: string[][];
  restart: "new-session" | "app-restart";
  notice?: string;
}

export const SERVER_NAME = "ask-llm";

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
  const piUserHome = env.HOME ?? homedir();
  const piOverride = env.PI_CODING_AGENT_DIR || join(piUserHome, ".pi", "agent");
  const piHome = resolve(
    piOverride === "~"
      ? piUserHome
      : piOverride.startsWith("~/")
        ? join(piUserHome, piOverride.slice(2))
        : piOverride.startsWith("file://")
          ? fileURLToPath(piOverride)
          : piOverride,
  );
  const piSettings = join(piHome, "settings.json");
  const opencodeHome = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode");
  const opencodeConfig = join(opencodeHome, "opencode.json");
  // skills@1.7.0 installs every "universal" agent (Codex, Cursor, Gemini CLI, OpenCode) into this one folder.
  const sharedSkills = join(home, ".agents", "skills");
  const serverKey = ["mcpServers", SERVER_NAME];

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
      skillsDir: sharedSkills,
      skillsAgent: "codex",
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
      // agy reads global skills only from here, which no skills@1.7.0 agent id writes.
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
      skillsAgent: "grok",
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
      skillsDir: sharedSkills,
      skillsAgent: "gemini-cli",
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
      configFile: cursorConfig,
      registration: { kind: "json", file: cursorConfig, edit: cursor },
      registrationState: { kind: "json", file: cursorConfig, keyPath: serverKey },
      skillsDir: sharedSkills,
      skillsAgent: "cursor",
      restart: "app-restart",
    },
    {
      id: "claude-desktop",
      name: "Claude Desktop",
      binaries: ["claude-desktop"],
      apps: platform === "darwin" ? ["/Applications/Claude.app", join(home, "Applications", "Claude.app")] : [],
      configHome: desktopHome,
      configFile: desktopConfig,
      registration: { kind: "json", file: desktopConfig, edit: claudeDesktop },
      registrationState: { kind: "json", file: desktopConfig, keyPath: serverKey },
      restart: "app-restart",
    },
    {
      id: "pi",
      name: "Pi",
      binaries: ["pi"],
      configHome: piHome,
      env: { PI_CODING_AGENT_DIR: piHome },
      configFile: piSettings,
      versionProbe: plainVersion,
      // Pi loads the installed package in place, so its extension always matches this setup's version.
      registration: { kind: "command", argv: () => ["pi", "install", PACKAGE_DIR] },
      registrationState: {
        kind: "packages",
        file: piSettings,
        sources: ["npm:@ask-llm/mcp", "npm:@ask-llm/plugin"],
        localDir: PACKAGE_DIR,
      },
      // Pi discovers shared skills directly. The pinned CLI's pi-only target creates private copies;
      // its universal codex target writes the shared folder without requiring Codex to be installed.
      skillsDir: sharedSkills,
      skillsAgent: "codex",
      restart: "new-session",
    },
    {
      id: "opencode",
      name: "OpenCode",
      binaries: ["opencode"],
      configHome: opencodeHome,
      configFile: opencodeConfig,
      versionProbe: plainVersion,
      registration: { kind: "json", file: opencodeConfig, edit: opencode },
      registrationState: {
        kind: "json",
        file: opencodeConfig,
        keyPath: ["mcp", SERVER_NAME],
        jsonc: join(opencodeHome, "opencode.jsonc"),
      },
      skillsDir: sharedSkills,
      skillsAgent: "opencode",
      restart: "new-session",
      notice: "OpenCode registration is verified against fixture files only, not yet on a real OpenCode install.",
    },
  ];
}
