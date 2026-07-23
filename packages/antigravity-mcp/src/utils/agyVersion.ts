import { executeCommand } from "@ask-llm/shared";
import { ANTIGRAVITY, CLI } from "../constants.js";

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
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

function unsupportedVersionMessage(detectedVersion: string): string {
  return (
    `Antigravity CLI (agy) ${detectedVersion} is unsupported. ` +
    `@ask-llm/antigravity-mcp requires agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION} because it uses base model slugs with --effort. ` +
    `Update Antigravity CLI using the same installation method, then run \`agy --version\` to verify.`
  );
}

export async function assertSupportedAgyVersion(): Promise<string> {
  const output = await executeCommand(
    CLI.COMMANDS.AGY,
    [CLI.FLAGS.VERSION],
    undefined,
    undefined,
    undefined,
    ANTIGRAVITY.VERSION_CHECK_TIMEOUT_MS,
  );
  const version = parseVersion(output);
  const minimum = parseVersion(ANTIGRAVITY.MINIMUM_AGY_VERSION);
  if (!version || !minimum) {
    throw new Error(
      `Unable to determine the Antigravity CLI version from \`${output.trim() || "(empty output)"}\`. ` +
        `@ask-llm/antigravity-mcp requires agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION}; update agy and run \`agy --version\` to verify.`,
    );
  }
  if (!isAtLeast(version, minimum)) {
    throw new Error(unsupportedVersionMessage(`${version.major}.${version.minor}.${version.patch}`));
  }
  return `${version.major}.${version.minor}.${version.patch}${version.prerelease ? `-${version.prerelease}` : ""}`;
}
