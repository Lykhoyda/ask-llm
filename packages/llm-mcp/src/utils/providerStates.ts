import { execFile } from "node:child_process";
import { type LocalProviderStates, type LocalState, resolveSpawnCommand } from "@ask-llm/shared";

const STATUS_PROBE_TIMEOUT_MS = 5000;

type StatusRunner = (
  command: string,
  args: string[],
  pathEnv: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const runStatus: StatusRunner = (command, args, pathEnv) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { env: { ...process.env, PATH: pathEnv }, timeout: STATUS_PROBE_TIMEOUT_MS },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : -1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });

function hasEnv(...names: string[]): boolean {
  return names.some((name) => Boolean(process.env[name]?.trim()));
}

async function codexAuth(pathEnv: string, run: StatusRunner): Promise<LocalState> {
  const { code, stdout, stderr } = await run("codex", ["login", "status"], pathEnv);
  if (code === 0) return "yes";
  return /not logged in/i.test(`${stdout}${stderr}`) ? "no" : "unknown";
}

async function claudeAuth(pathEnv: string, run: StatusRunner): Promise<LocalState> {
  const { stdout } = await run("claude", ["auth", "status"], pathEnv);
  try {
    const { loggedIn } = JSON.parse(stdout) as { loggedIn?: unknown };
    if (typeof loggedIn === "boolean") return loggedIn ? "yes" : "no";
  } catch {}
  return "unknown";
}

export async function localProviderStates(
  key: string,
  ctx: { cliPath?: string; available: boolean; pathEnv: string },
  run: StatusRunner = runStatus,
): Promise<LocalProviderStates> {
  const onPath = (command: string) => resolveSpawnCommand(command, { ...process.env, PATH: ctx.pathEnv }) !== undefined;
  const installed: LocalState = ctx.cliPath ? "yes" : "no";
  switch (key) {
    case "codex":
      return {
        installed,
        authenticated: ctx.cliPath ? await codexAuth(ctx.pathEnv, run) : "unknown",
        permitted: "yes",
      };
    case "claude":
      return {
        installed,
        authenticated: ctx.cliPath ? await claudeAuth(ctx.pathEnv, run) : "unknown",
        permitted: "yes",
      };
    case "gemini":
      return {
        installed,
        authenticated: hasEnv("GEMINI_API_KEY", "GOOGLE_API_KEY") ? "yes" : "unknown",
        permitted: "yes",
      };
    case "grok": {
      const apiKey = hasEnv("XAI_API_KEY");
      return {
        installed: onPath("grok") ? "yes" : apiKey ? "not-required" : "no",
        authenticated: apiKey ? "yes" : "unknown",
        permitted: "yes",
      };
    }
    case "ollama":
      return { installed: onPath("ollama") ? "yes" : "no", authenticated: "not-required", permitted: "yes" };
    case "antigravity":
      return {
        installed,
        authenticated: "unknown",
        permitted: process.env.ASK_ANTIGRAVITY_ALLOW_UNISOLATED === "1" ? "yes" : "no",
      };
    default:
      return { installed, authenticated: "unknown", permitted: "unknown" };
  }
}
