import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CheckStatus, OverallStatus, ProviderEnrichment, ProviderEnrichmentCheck } from "@ask-llm/shared";

const execFileAsync = promisify(execFile);

const DOCTOR_PROBE_TIMEOUT_MS = 5000;
const DOCTOR_MAX_BUFFER = 1024 * 1024 * 4;

function mapCheckStatus(status: unknown): CheckStatus {
  switch (String(status).toLowerCase()) {
    case "ok":
    case "pass":
      return "pass";
    case "error":
    case "fail":
    case "failed":
      return "fail";
    case "skip":
    case "skipped":
      return "skip";
    default:
      // warn / warning and any unrecognized status — surface conservatively.
      return "warn";
  }
}

function mapOverallStatus(status: unknown): OverallStatus {
  switch (String(status).toLowerCase()) {
    case "ok":
    case "pass":
      return "ok";
    case "error":
    case "fail":
      return "error";
    default:
      return "warning";
  }
}

interface RawDoctorCheck {
  id?: unknown;
  status?: unknown;
  summary?: unknown;
  remediation?: unknown;
}

/**
 * Parse `codex doctor --json` stdout into a provider-agnostic enrichment.
 * Returns `undefined` for anything that is not a recognizable doctor report
 * (non-JSON, missing `overallStatus`/`checks`) so callers degrade silently.
 */
export function parseCodexDoctorJson(stdout: string): ProviderEnrichment | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const report = raw as { overallStatus?: unknown; checks?: unknown };
  if (typeof report.overallStatus !== "string") return undefined;
  if (!report.checks || typeof report.checks !== "object") return undefined;

  const checks: ProviderEnrichmentCheck[] = [];
  for (const [key, value] of Object.entries(report.checks as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const check = value as RawDoctorCheck;
    const remediation =
      typeof check.remediation === "string" && check.remediation.length > 0 ? check.remediation : undefined;
    checks.push({
      name: typeof check.id === "string" ? check.id : key,
      status: mapCheckStatus(check.status),
      summary: typeof check.summary === "string" ? check.summary : "",
      ...(remediation ? { remediation } : {}),
    });
  }

  return { heading: "codex doctor", overall: mapOverallStatus(report.overallStatus), checks };
}

type DoctorRunner = (command: string, pathEnv: string) => Promise<string>;

async function runCodexDoctorJson(command: string, pathEnv: string): Promise<string> {
  const { stdout } = await execFileAsync(command, ["doctor", "--json"], {
    env: { ...process.env, PATH: pathEnv },
    timeout: DOCTOR_PROBE_TIMEOUT_MS,
    maxBuffer: DOCTOR_MAX_BUFFER,
  });
  return stdout;
}

/**
 * Enrich the codex provider with a compact `codex doctor` health summary.
 * Capability-probed: any failure (codex too old to know `--json`, timeout,
 * unparseable output) yields `undefined`, leaving the doctor report unchanged.
 * The `run` parameter is injectable for testing.
 */
export async function enrichCodexDoctor(
  ctx: { command: string; pathEnv: string },
  run: DoctorRunner = runCodexDoctorJson,
): Promise<ProviderEnrichment | undefined> {
  try {
    const stdout = await run(ctx.command, ctx.pathEnv);
    return parseCodexDoctorJson(stdout);
  } catch {
    return undefined;
  }
}
