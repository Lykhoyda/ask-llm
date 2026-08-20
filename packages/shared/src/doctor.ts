import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveTimeoutMs } from "./commandExecutor.js";
import { EXECUTION } from "./constants.js";
import { resolveShellPath } from "./shellPath.js";

const execFileAsync = promisify(execFile);

export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type OverallStatus = "ok" | "warning" | "error";

export interface DiagnosticCheck {
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

export interface ProviderEnrichmentCheck {
  name: string;
  status: CheckStatus;
  summary: string;
  remediation?: string;
}

export interface ProviderEnrichment {
  heading: string;
  overall: OverallStatus;
  checks: ProviderEnrichmentCheck[];
}

export interface ProviderVersionAssessment {
  available: boolean;
  error?: string;
  fix?: string;
}

export interface ProviderProbe {
  name: string;
  command: string;
  available: boolean;
  cliPath: string | undefined;
  cliVersion: string | undefined;
  error: string | undefined;
  enrichment?: ProviderEnrichment;
}

export interface DiagnosticReport {
  status: OverallStatus;
  generatedAt: string;
  environment: {
    nodeVersion: string;
    nodeOk: boolean;
    platform: string;
    arch: string;
    resolvedPath: string;
    askLlmPath: string | undefined;
    timeoutMs: number;
    codexTimeoutMs: number;
    claudeTimeoutMs: number;
    geminiTimeoutMs: number;
    grokTimeoutMs: number;
    cursorHarnessTimeoutMs: number;
  };
  providers: ProviderProbe[];
  checks: DiagnosticCheck[];
}

export interface ProviderSpec {
  key: string;
  name: string;
  command: string;
  versionArgs?: string[];
  installHint?: string;
  probeAvailability?: () => Promise<boolean>;
  availabilitySuccess?: string;
  availabilityFailure?: string;
  assessVersion?: (
    version: string | undefined,
    probeError: string | undefined,
  ) => ProviderVersionAssessment | Promise<ProviderVersionAssessment>;
  enrich?: (ctx: { command: string; pathEnv: string }) => Promise<ProviderEnrichment | undefined>;
}

const NODE_MIN_MAJOR = 20;
const VERSION_PROBE_TIMEOUT_MS = 5000;

function parseNodeMajor(version: string): number {
  const match = version.match(/^v?(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

async function probeCommand(
  command: string,
  versionArgs: string[],
  pathEnv: string,
): Promise<{ cliPath: string | undefined; version: string | undefined; error: string | undefined }> {
  const env = { ...process.env, PATH: pathEnv };
  let cliPath: string | undefined;
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(which, [command], { env, timeout: VERSION_PROBE_TIMEOUT_MS });
    cliPath = stdout.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return { cliPath: undefined, version: undefined, error: "not found on PATH" };
  }

  try {
    const { stdout, stderr } = await execFileAsync(command, versionArgs, {
      env,
      timeout: VERSION_PROBE_TIMEOUT_MS,
    });
    const versionLine = (stdout || stderr).split(/\r?\n/)[0]?.trim();
    return { cliPath, version: versionLine || undefined, error: undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { cliPath, version: undefined, error: `version probe failed: ${msg.slice(0, 200)}` };
  }
}

export async function runDiagnostics(providers: ProviderSpec[]): Promise<DiagnosticReport> {
  const checks: DiagnosticCheck[] = [];
  const resolvedPath = resolveShellPath();
  const nodeMajor = parseNodeMajor(process.version);
  const nodeOk = nodeMajor >= NODE_MIN_MAJOR;

  checks.push(
    nodeOk
      ? {
          name: "Node.js version",
          status: "pass",
          message: `${process.version} (>= v${NODE_MIN_MAJOR} required)`,
        }
      : {
          name: "Node.js version",
          status: "fail",
          message: `${process.version} is too old — provider CLIs use ES2024 features that crash on Node < ${NODE_MIN_MAJOR}`,
          fix: `Upgrade Node to v${NODE_MIN_MAJOR}+ (LTS). nvm: \`nvm install 22 && nvm use 22\``,
        },
  );

  checks.push(
    resolvedPath.length > 0
      ? {
          name: "PATH resolution",
          status: "pass",
          message: `Resolved PATH has ${resolvedPath.split(":").filter(Boolean).length} entries`,
        }
      : {
          name: "PATH resolution",
          status: "fail",
          message: "Resolved PATH is empty — provider CLIs cannot be located",
          fix: "Set ASK_LLM_PATH env var explicitly, or restart your MCP client from a shell with a working PATH",
        },
  );

  const providerProbes: ProviderProbe[] = [];
  for (const spec of providers) {
    if (spec.probeAvailability) {
      let available = false;
      try {
        available = await spec.probeAvailability();
      } catch {
        available = false;
      }
      const successMessage = spec.availabilitySuccess ?? "endpoint reachable";
      const failureMessage = spec.availabilityFailure ?? "endpoint unreachable";
      providerProbes.push({
        name: spec.name,
        command: spec.command,
        available,
        cliPath: undefined,
        cliVersion: undefined,
        error: available ? undefined : failureMessage,
      });
      checks.push(
        available
          ? { name: `Provider: ${spec.name}`, status: "pass", message: successMessage }
          : {
              name: `Provider: ${spec.name}`,
              status: "warn",
              message: failureMessage,
              fix: spec.installHint,
            },
      );
      continue;
    }

    const versionArgs = spec.versionArgs ?? ["--version"];
    const probe = await probeCommand(spec.command, versionArgs, resolvedPath);
    let versionAssessment: ProviderVersionAssessment | undefined;
    if (probe.cliPath !== undefined && spec.assessVersion) {
      try {
        versionAssessment = await spec.assessVersion(probe.version, probe.error);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        versionAssessment = {
          available: false,
          error: `version support assessment failed: ${detail}`,
          fix: spec.installHint,
        };
      }
    }
    const providerError = versionAssessment?.error ?? probe.error;
    const available = probe.cliPath !== undefined && (versionAssessment?.available ?? providerError === undefined);
    let enrichment: ProviderEnrichment | undefined;
    if (available && spec.enrich) {
      try {
        enrichment = await spec.enrich({ command: spec.command, pathEnv: resolvedPath });
      } catch {
        enrichment = undefined;
      }
    }
    providerProbes.push({
      name: spec.name,
      command: spec.command,
      available,
      cliPath: probe.cliPath,
      cliVersion: probe.version,
      error: providerError,
      enrichment,
    });

    if (probe.cliPath === undefined) {
      checks.push({
        name: `Provider: ${spec.name}`,
        status: "warn",
        message: `\`${spec.command}\` not found on PATH`,
        fix: spec.installHint,
      });
    } else if (providerError !== undefined) {
      checks.push({
        name: `Provider: ${spec.name}`,
        status: "warn",
        message: `Found at ${probe.cliPath} but ${providerError}`,
        fix: versionAssessment?.fix ?? "Check that the CLI is properly installed and authenticated",
      });
    } else {
      checks.push({
        name: `Provider: ${spec.name}`,
        status: "pass",
        message: `${probe.version ?? "available"} at ${probe.cliPath}`,
      });
    }
  }

  const askLlmPath = process.env.ASK_LLM_PATH;
  if (askLlmPath) {
    checks.push({
      name: "ASK_LLM_PATH override",
      status: "warn",
      message: `Custom PATH override is set (${askLlmPath.split(":").length} entries)`,
      fix: "Unset ASK_LLM_PATH if you want shell-resolved PATH instead",
    });
  }

  const timeoutEnv = process.env.GMCPT_TIMEOUT_MS;
  const timeoutMs = timeoutEnv ? Number.parseInt(timeoutEnv, 10) : 210_000;
  const codexTimeoutMs = resolveTimeoutMs(EXECUTION.CODEX_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CODEX_TIMEOUT_MS);
  const claudeTimeoutMs = resolveTimeoutMs(EXECUTION.CLAUDE_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CLAUDE_TIMEOUT_MS);
  const geminiTimeoutMs = resolveTimeoutMs(EXECUTION.GEMINI_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_TIMEOUT_MS);
  const grokTimeoutMs = resolveTimeoutMs(EXECUTION.GROK_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_GROK_TIMEOUT_MS);
  const cursorHarnessTimeoutMs = resolveTimeoutMs(
    EXECUTION.CURSOR_TIMEOUT_ENV_VAR,
    EXECUTION.DEFAULT_CURSOR_TIMEOUT_MS,
  );

  const hasFailure = checks.some((c) => c.status === "fail");
  const hasWarn = checks.some((c) => c.status === "warn");
  const status: OverallStatus = hasFailure ? "error" : hasWarn ? "warning" : "ok";

  return {
    status,
    generatedAt: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      nodeOk,
      platform: process.platform,
      arch: process.arch,
      resolvedPath,
      askLlmPath,
      timeoutMs,
      codexTimeoutMs,
      claudeTimeoutMs,
      geminiTimeoutMs,
      grokTimeoutMs,
      cursorHarnessTimeoutMs,
    },
    providers: providerProbes,
    checks,
  };
}

const STATUS_GLYPH: Record<CheckStatus, string> = {
  pass: "✓",
  warn: "!",
  fail: "✗",
  skip: "-",
};

const OVERALL_GLYPH: Record<OverallStatus, string> = {
  ok: "✓",
  warning: "!",
  error: "✗",
};

export function formatDiagnosticReport(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push(`${OVERALL_GLYPH[report.status]} ask-llm doctor — ${report.status.toUpperCase()}`);
  lines.push("");
  lines.push("Environment:");
  lines.push(`  Node:     ${report.environment.nodeVersion}${report.environment.nodeOk ? "" : " (TOO OLD)"}`);
  lines.push(`  Platform: ${report.environment.platform}/${report.environment.arch}`);
  lines.push(
    `  Timeouts: codex=${report.environment.codexTimeoutMs}ms, claude=${report.environment.claudeTimeoutMs}ms, grok=${report.environment.grokTimeoutMs}ms, cursor-harness=${report.environment.cursorHarnessTimeoutMs}ms, gemini=${report.environment.geminiTimeoutMs}ms`,
  );
  if (report.environment.askLlmPath) {
    lines.push(`  ASK_LLM_PATH: set (${report.environment.askLlmPath.split(":").length} entries)`);
  }
  lines.push("");
  lines.push("Checks:");
  for (const check of report.checks) {
    lines.push(`  ${STATUS_GLYPH[check.status]} ${check.name}: ${check.message}`);
    if (check.fix) lines.push(`      → ${check.fix}`);
  }

  if (report.providers.length > 0) {
    lines.push("");
    lines.push("Providers:");
    for (const provider of report.providers) {
      const status = provider.available ? "available" : "unavailable";
      const detail = provider.cliPath ? ` (${provider.cliVersion ?? "version unknown"})` : "";
      lines.push(`  - ${provider.name}: ${status}${detail}`);
      if (provider.cliPath) lines.push(`      path: ${provider.cliPath}`);
      if (provider.error) lines.push(`      ${provider.error}`);
      if (provider.enrichment) {
        const { heading, overall, checks } = provider.enrichment;
        lines.push(`      ${heading}: ${overall.toUpperCase()}`);
        for (const check of checks) {
          // Compact text view: surface only non-ok checks; the full mapped list
          // rides along in the structured report for `doctor --json`. `skip` is
          // neutral (not-applicable) and its "-" glyph collides with the
          // "  - <Provider>:" prefix, so it is suppressed alongside `pass`.
          if (check.status === "pass" || check.status === "skip") continue;
          lines.push(`        ${STATUS_GLYPH[check.status]} ${check.name}: ${check.summary}`);
          if (check.remediation) lines.push(`            → ${check.remediation}`);
        }
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}
