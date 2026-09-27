import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { Logger } from "./logger.js";

const IS_WINDOWS = process.platform === "win32";
const SHELL_PATH_ENV_VAR = "ASK_LLM_PATH";

let cachedPath: string | null = null;

function extractShellPath(): string | null {
  if (IS_WINDOWS) return null;

  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const output = execFileSync(shell, ["-ilc", 'echo "___PATH___$PATH___END___"'], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    const match = output.match(/___PATH___(.*)___END___/);
    if (match?.[1]) {
      return match[1].trim();
    }
  } catch {
    Logger.debug("Failed to extract PATH from login shell");
  }
  return null;
}

function findNvmNodePath(): string | null {
  const nvmDir = join(homedir(), ".nvm", "versions", "node");
  if (!existsSync(nvmDir)) return null;

  try {
    const versions = readdirSync(nvmDir)
      .filter((v) => {
        const major = parseInt(v.replace("v", "").split(".")[0], 10);
        return major >= 24;
      })
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    if (versions.length > 0) {
      const binDir = join(nvmDir, versions[0], "bin");
      if (existsSync(binDir)) return binDir;
    }
  } catch {
    Logger.debug("Failed to scan nvm versions");
  }
  return null;
}

function buildAugmentedPath(): string {
  const currentPath = process.env.PATH || "";
  const home = homedir();
  const candidates: string[] = [];

  const nvmBin = findNvmNodePath();
  if (nvmBin) candidates.push(nvmBin);

  for (const dir of [
    join(home, ".volta", "bin"),
    join(home, ".local", "share", "fnm"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ]) {
    if (existsSync(dir)) candidates.push(dir);
  }

  if (candidates.length === 0) return currentPath;
  return [...candidates, ...currentPath.split(delimiter)].join(delimiter);
}

export function resolveShellPath(): string {
  if (cachedPath !== null) return cachedPath;

  const envOverride = process.env[SHELL_PATH_ENV_VAR];
  if (envOverride) {
    Logger.debug(`Using ${SHELL_PATH_ENV_VAR} override`);
    cachedPath = envOverride;
    return cachedPath;
  }

  if (IS_WINDOWS) {
    cachedPath = process.env.PATH || "";
    return cachedPath;
  }

  const shellPath = extractShellPath();
  if (shellPath) {
    Logger.debug("Using PATH from login shell");
    cachedPath = shellPath;
    return cachedPath;
  }

  Logger.debug("Login shell PATH extraction failed, using heuristic fallback");
  cachedPath = buildAugmentedPath();
  return cachedPath;
}

export function getSpawnEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: resolveShellPath() };
}
