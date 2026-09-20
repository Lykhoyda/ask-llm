import { executeCommand, isCommandNotFoundError } from "@ask-llm/shared";
import { ASTRA_MIN_CODEX_VERSION, CLI, CODEX_VERSION_CHECK_TIMEOUT_MS } from "../constants.js";

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export type CodexSupportStatus = "supported" | "unsupported" | "unusable" | "missing";

export interface CodexSupportProbe {
  status: CodexSupportStatus;
  available: boolean;
  detected: boolean;
  version?: string;
  requiredVersion: string;
  message: string;
  remediation?: string;
}

export function isAstraModel(model: string): boolean {
  return model === "gpt-6-astra";
}

function parseVersion(value: string): SemanticVersion | undefined {
  const match = value.match(/\bv?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?\b/);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(match[4] ? { prerelease: match[4] } : {}),
  };
}

function isAtLeast(version: SemanticVersion, minimum: SemanticVersion): boolean {
  for (const key of ["major", "minor", "patch"] as const) {
    if (version[key] > minimum[key]) return true;
    if (version[key] < minimum[key]) return false;
  }
  return minimum.prerelease !== undefined || version.prerelease === undefined;
}

function normalizeVersion(version: SemanticVersion): string {
  return `${version.major}.${version.minor}.${version.patch}${version.prerelease ? `-${version.prerelease}` : ""}`;
}

function upgradeRemediation(): string {
  return `Update Codex CLI to ${ASTRA_MIN_CODEX_VERSION} or later, or pin ASK_CODEX_MODEL=gpt-5.6-sol.`;
}

// Unparseable input gates conservatively (false) so optional floors stay off.
export function isVersionAtLeast(version: string, minimum: string): boolean {
  const parsed = parseVersion(version);
  const min = parseVersion(minimum);
  if (!parsed || !min) return false;
  return isAtLeast(parsed, min);
}

export function assessCodexVersion(output: string | undefined, probeError?: string): CodexSupportProbe {
  const requiredVersion = ASTRA_MIN_CODEX_VERSION;
  if (probeError) {
    return {
      status: "unusable",
      available: false,
      detected: true,
      requiredVersion,
      message: `Codex CLI was detected, but its version is unknown and unusable: ${probeError}. codex >=${requiredVersion} is required for gpt-6-astra.`,
      remediation: upgradeRemediation(),
    };
  }

  const version = output ? parseVersion(output) : undefined;
  const minimum = parseVersion(ASTRA_MIN_CODEX_VERSION);
  if (!version || !minimum) {
    const reportedVersion = output?.trim() || "(empty output)";
    return {
      status: "unusable",
      available: false,
      detected: true,
      requiredVersion,
      message: `Codex CLI was detected, but version output "${reportedVersion}" is unparseable and unusable. codex >=${requiredVersion} is required for gpt-6-astra.`,
      remediation: upgradeRemediation(),
    };
  }

  const detectedVersion = normalizeVersion(version);
  if (!isAtLeast(version, minimum)) {
    return {
      status: "unsupported",
      available: false,
      detected: true,
      version: detectedVersion,
      requiredVersion,
      message: `Codex CLI ${detectedVersion} was detected but is too old for gpt-6-astra; codex >=${requiredVersion} is required because Astra's catalog floor is 0.153.0.`,
      remediation: upgradeRemediation(),
    };
  }

  return {
    status: "supported",
    available: true,
    detected: true,
    version: detectedVersion,
    requiredVersion,
    message: `Codex CLI ${detectedVersion} supports gpt-6-astra.`,
  };
}

export async function probeCodexSupport(signal?: AbortSignal): Promise<CodexSupportProbe> {
  try {
    const output = await executeCommand(
      CLI.COMMANDS.CODEX,
      [CLI.FLAGS.VERSION],
      undefined,
      undefined,
      undefined,
      CODEX_VERSION_CHECK_TIMEOUT_MS,
      undefined,
      signal,
    );
    return assessCodexVersion(output);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isCommandNotFoundError(detail, CLI.COMMANDS.CODEX)) {
      return {
        status: "missing",
        available: false,
        detected: false,
        requiredVersion: ASTRA_MIN_CODEX_VERSION,
        message: "Codex CLI was not found on PATH.",
        remediation: `Install Codex CLI >=${ASTRA_MIN_CODEX_VERSION} (\`npm install -g @openai/codex\`), then authenticate once.`,
      };
    }
    return assessCodexVersion(undefined, detail);
  }
}

export async function assertCodexSupportsModel(model: string, signal?: AbortSignal): Promise<string | undefined> {
  if (!isAstraModel(model)) return undefined;
  const probe = await probeCodexSupport(signal);
  if (probe.available && probe.version) return probe.version;
  throw new Error([probe.message, probe.remediation].filter(Boolean).join(" "));
}
