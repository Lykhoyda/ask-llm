import { execFile } from "node:child_process";
import { type DiagnosticCheck, type LocalProviderStates, type LocalState, resolveSpawnCommand } from "@ask-llm/shared";

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

const GEMINI_BILLING_SIGNALS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_APPLICATION_CREDENTIALS",
];
const ANTIGRAVITY_BILLING_SIGNALS = ["AGY_ADC_AUTH", "GEMINI_API_KEY"];
const GOOGLE_PROJECT_SIGNALS = ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT_ID"];

export function googleRouteCheck(key: string, providerName: string, env = process.env): DiagnosticCheck | undefined {
  if (key !== "gemini" && key !== "antigravity") return undefined;
  const billingSignals = key === "gemini" ? GEMINI_BILLING_SIGNALS : ANTIGRAVITY_BILLING_SIGNALS;
  const billing = billingSignals.filter((name) => Object.hasOwn(env, name));
  const projectVariables = GOOGLE_PROJECT_SIGNALS.filter((name) => Object.hasOwn(env, name));
  const funding = "Google route and funding unverified. Seat unproven.";
  const cachedRoutes = "Cached Cloud or pay-as-you-go settings may affect billing.";
  return {
    name: `Route: ${providerName}`,
    status: billing.length > 0 ? "warn" : "skip",
    message:
      billing.length > 0
        ? `${billing.join(", ")} present. Possible alternate billing. ${funding}`
        : `${projectVariables.length > 0 ? `Project variables only (${projectVariables.join(", ")}). ` : "No route signals in the environment. "}${funding}`,
    fix:
      key === "antigravity"
        ? `${cachedRoutes} Google excludes third-party headless agy wrappers from consumer-plan support.`
        : cachedRoutes,
  };
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
        authenticated: "unknown",
        permitted: "yes",
      };
    case "grok": {
      const apiKey = process.env.ASK_GROK_HARNESS !== "grok-cli" && hasEnv("XAI_API_KEY");
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
