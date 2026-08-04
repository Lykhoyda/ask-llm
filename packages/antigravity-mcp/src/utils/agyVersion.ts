import { executeCommand, isCommandNotFoundError } from "@ask-llm/shared";
import { ANTIGRAVITY, CLI } from "../constants.js";

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

export type AgySupportStatus = "supported" | "unsupported" | "unusable" | "missing";

export interface AgySupportProbe {
  status: AgySupportStatus;
  available: boolean;
  detected: boolean;
  version?: string;
  requiredVersion: string;
  message: string;
  remediation?: string;
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
  return "Update Antigravity CLI using the same installation method, then run `agy --version` to verify.";
}

// Unparseable input gates conservatively (false) so optional flags stay off.
export function isVersionAtLeast(version: string, minimum: string): boolean {
  const parsed = parseVersion(version);
  const min = parseVersion(minimum);
  if (!parsed || !min) return false;
  return isAtLeast(parsed, min);
}

export function assessAgyVersion(output: string | undefined, probeError?: string): AgySupportProbe {
  const requiredVersion = ANTIGRAVITY.MINIMUM_AGY_VERSION;
  if (probeError) {
    return {
      status: "unusable",
      available: false,
      detected: true,
      requiredVersion,
      message: `Antigravity CLI (agy) was detected, but its version is unknown and unusable: ${probeError}. agy >=${requiredVersion} is required.`,
      remediation: upgradeRemediation(),
    };
  }

  const version = output ? parseVersion(output) : undefined;
  const minimum = parseVersion(ANTIGRAVITY.MINIMUM_AGY_VERSION);
  if (!version || !minimum) {
    const reportedVersion = output?.trim() || "(empty output)";
    return {
      status: "unusable",
      available: false,
      detected: true,
      requiredVersion,
      message: `Antigravity CLI (agy) was detected, but version output "${reportedVersion}" is unparseable and unusable. agy >=${requiredVersion} is required.`,
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
      message: `Antigravity CLI (agy) ${detectedVersion} was detected but is unsupported; agy >=${requiredVersion} is required because ask-llm uses base model slugs with --effort.`,
      remediation: upgradeRemediation(),
    };
  }

  return {
    status: "supported",
    available: true,
    detected: true,
    version: detectedVersion,
    requiredVersion,
    message: `Antigravity CLI (agy) ${detectedVersion} is supported.`,
  };
}

export async function probeAgySupport(): Promise<AgySupportProbe> {
  try {
    const output = await executeCommand(
      CLI.COMMANDS.AGY,
      [CLI.FLAGS.VERSION],
      undefined,
      undefined,
      undefined,
      ANTIGRAVITY.VERSION_CHECK_TIMEOUT_MS,
    );
    return assessAgyVersion(output);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (isCommandNotFoundError(detail, CLI.COMMANDS.AGY)) {
      return {
        status: "missing",
        available: false,
        detected: false,
        requiredVersion: ANTIGRAVITY.MINIMUM_AGY_VERSION,
        message: "Antigravity CLI (agy) was not found on PATH.",
        remediation: `Install agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION}, then run \`agy\` once to log in.`,
      };
    }
    return assessAgyVersion(undefined, detail);
  }
}

export async function assertSupportedAgyVersion(): Promise<string> {
  const probe = await probeAgySupport();
  if (probe.available && probe.version) return probe.version;
  throw new Error([probe.message, probe.remediation].filter(Boolean).join(" "));
}
