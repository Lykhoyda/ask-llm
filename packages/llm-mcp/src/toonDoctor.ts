import { type DiagnosticReport, formatDiagnosticReport, type ProviderProbe } from "@ask-llm/shared";
import { decode, encode } from "@toon-format/toon";

export const DOCTOR_TOON_SCHEMA = "ask-llm.doctor";
export const DOCTOR_TOON_SCHEMA_VERSION = 1;
export const DOCTOR_TOON_MAX_TEXT_BYTES = 240;
export const DOCTOR_TOON_MAX_CHECKS = 20;
export const DOCTOR_TOON_MAX_PROVIDER_CHECKS = 20;

export type DoctorOutputFormat = "text" | "json" | "toon";

export interface DoctorCliOptions {
  format: DoctorOutputFormat;
  full: boolean;
  help: boolean;
}

export interface DoctorCliErrorShape {
  schema: typeof DOCTOR_TOON_SCHEMA;
  schemaVersion: typeof DOCTOR_TOON_SCHEMA_VERSION;
  format: "json" | "toon";
  status: "error";
  error: {
    code: string;
    message: string;
    hint: string;
  };
  help: {
    command: string;
  };
}

export class DoctorArgumentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint: string,
  ) {
    super(message);
  }
}

interface TruncationRecord {
  field: string;
  originalBytes: number;
}

interface ProviderRow {
  provider: string;
  availability: "available" | "unavailable";
  version: string | null;
  detail: string | null;
  command?: string;
  path?: string | null;
}

interface CheckRow {
  name: string;
  status: string;
  message: string;
  fix: string | null;
}

interface ProviderCheckRow {
  provider: string;
  name: string;
  status: string;
  summary: string;
  remediation: string | null;
}

function error(code: string, message: string, hint: string): never {
  throw new DoctorArgumentError(code, message, hint);
}

export function parseDoctorArguments(args: string[]): DoctorCliOptions {
  let format: DoctorOutputFormat = "text";
  let formatSelected = false;
  let full = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") {
      if (formatSelected && format !== "json") {
        error(
          "conflicting_formats",
          "--json conflicts with the selected output format",
          "Choose one: --json or --format toon.",
        );
      }
      format = "json";
      formatSelected = true;
      continue;
    }
    if (argument === "--format") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        error("missing_format", "--format requires a value", "Use --format text, --format json, or --format toon.");
      }
      if (value !== "text" && value !== "json" && value !== "toon") {
        error("unsupported_format", `Unsupported doctor format: ${value}`, "Supported formats: text, json, toon.");
      }
      if (formatSelected && format !== value) {
        error(
          "conflicting_formats",
          "Multiple doctor output formats were selected",
          "Choose exactly one output format.",
        );
      }
      format = value;
      formatSelected = true;
      index += 1;
      continue;
    }
    if (argument === "--full") {
      if (full) error("duplicate_flag", "--full was provided more than once", "Provide --full once.");
      full = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    error("unknown_argument", "Unknown doctor argument", "Run ask-llm-mcp doctor --help.");
  }

  if (full && format !== "toon") {
    error("full_requires_toon", "--full is only valid with the bounded TOON pilot", "Use doctor --format toon --full.");
  }
  return { format, full, help };
}

export function requestedStructuredFormat(args: string[]): "json" | "toon" {
  const formatIndex = args.lastIndexOf("--format");
  if (formatIndex >= 0 && args[formatIndex + 1] === "toon") return "toon";
  return "json";
}

export function doctorHelp(): string {
  return [
    "Usage: ask-llm-mcp doctor [--json | --format <text|json|toon>] [--full]",
    "",
    "Formats:",
    "  text          Human-readable diagnostics (default)",
    "  json          Existing full DiagnosticReport contract (--json remains supported)",
    "  toon          Versioned, bounded agent-facing provider diagnostics pilot",
    "",
    "Options:",
    "  --full        Include paths, passing checks, and unbounded text (TOON only)",
    "  -h, --help    Show this help",
    "",
  ].join("\n");
}

function truncateUtf8(value: string, field: string, truncations: TruncationRecord[]): string {
  const originalBytes = Buffer.byteLength(value, "utf8");
  if (originalBytes <= DOCTOR_TOON_MAX_TEXT_BYTES) return value;

  const suffix = "…";
  const budget = DOCTOR_TOON_MAX_TEXT_BYTES - Buffer.byteLength(suffix, "utf8");
  const buffer = Buffer.from(value, "utf8");
  let end = budget;
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1;
  truncations.push({ field, originalBytes });
  return `${buffer.subarray(0, end).toString("utf8")}${suffix}`;
}

function boundedText(
  value: string | undefined,
  field: string,
  full: boolean,
  truncations: TruncationRecord[],
): string | null {
  if (value === undefined) return null;
  return full ? value : truncateUtf8(value, field, truncations);
}

function providerRow(
  provider: ProviderProbe,
  index: number,
  full: boolean,
  truncations: TruncationRecord[],
): ProviderRow {
  const detail =
    provider.error ??
    (provider.enrichment ? `${provider.enrichment.heading}: ${provider.enrichment.overall}` : undefined);
  const row: ProviderRow = {
    provider: provider.name,
    availability: provider.available ? "available" : "unavailable",
    version: boundedText(provider.cliVersion, `providers[${index}].version`, full, truncations),
    detail: boundedText(detail, `providers[${index}].detail`, full, truncations),
  };
  if (full) {
    row.command = provider.command;
    row.path = provider.cliPath ?? null;
  }
  return row;
}

export function doctorToonDocument(report: DiagnosticReport, full = false) {
  const truncations: TruncationRecord[] = [];
  const candidateChecks = full ? report.checks : report.checks.filter((check) => check.status !== "pass");
  const shownChecks = full ? candidateChecks : candidateChecks.slice(0, DOCTOR_TOON_MAX_CHECKS);
  const checks: CheckRow[] = shownChecks.map((check, index) => ({
    name: check.name,
    status: check.status,
    message: boundedText(check.message, `checks[${index}].message`, full, truncations) ?? "",
    fix: boundedText(check.fix, `checks[${index}].fix`, full, truncations),
  }));

  const candidateProviderChecks = report.providers.flatMap((provider) =>
    (provider.enrichment?.checks ?? [])
      .filter((check) => full || (check.status !== "pass" && check.status !== "skip"))
      .map((check) => ({ provider: provider.name, check })),
  );
  const selectedProviderChecks = full
    ? candidateProviderChecks
    : candidateProviderChecks.slice(0, DOCTOR_TOON_MAX_PROVIDER_CHECKS);
  const providerChecks: ProviderCheckRow[] = selectedProviderChecks.map(({ provider, check }, checkIndex) => ({
    provider,
    name: check.name,
    status: check.status,
    summary: boundedText(check.summary, `providerChecks[${checkIndex}].summary`, full, truncations) ?? "",
    remediation: boundedText(check.remediation, `providerChecks[${checkIndex}].remediation`, full, truncations),
  }));

  const providers = report.providers.map((provider, index) => providerRow(provider, index, full, truncations));
  const availableProviders = providers.filter((provider) => provider.availability === "available").length;
  const omittedChecks = report.checks.length - checks.length;
  const totalProviderChecks = report.providers.reduce(
    (total, provider) => total + (provider.enrichment?.checks.length ?? 0),
    0,
  );
  const omittedProviderChecks = totalProviderChecks - providerChecks.length;
  const pathValuesOmitted = full
    ? 0
    : Number(report.environment.resolvedPath.length > 0) +
      Number(report.environment.askLlmPath !== undefined) +
      report.providers.filter((provider) => provider.cliPath !== undefined).length;

  const environment: Record<string, unknown> = {
    node: report.environment.nodeVersion,
    nodeOk: report.environment.nodeOk,
    platform: `${report.environment.platform}/${report.environment.arch}`,
    pathResolution: report.environment.resolvedPath.length > 0 ? "available" : "empty",
    askLlmPathOverride: report.environment.askLlmPath !== undefined,
    timeoutsMs: {
      codex: report.environment.codexTimeoutMs,
      claude: report.environment.claudeTimeoutMs,
      gemini: report.environment.geminiTimeoutMs,
    },
  };
  if (full) {
    environment.defaultTimeoutMs = report.environment.timeoutMs;
    environment.resolvedPath = report.environment.resolvedPath;
    environment.askLlmPath = report.environment.askLlmPath ?? null;
  }

  return {
    schema: DOCTOR_TOON_SCHEMA,
    schemaVersion: DOCTOR_TOON_SCHEMA_VERSION,
    format: "toon",
    mode: full ? "full" : "bounded",
    status: report.status,
    generatedAt: report.generatedAt,
    summary: {
      providersTotal: providers.length,
      providersAvailable: availableProviders,
      providersUnavailable: providers.length - availableProviders,
      providersOmitted: 0,
      checksShown: checks.length,
      providerChecksShown: providerChecks.length,
    },
    environment,
    providers,
    checks,
    providerChecks,
    omissions: {
      checks: omittedChecks,
      providerChecks: omittedProviderChecks,
      pathValues: pathValuesOmitted,
    },
    truncations,
    help: {
      full: "ask-llm-mcp doctor --format toon --full",
      json: "ask-llm-mcp doctor --json",
      docs: "https://lykhoyda.github.io/ask-llm/resources/troubleshooting",
    },
  };
}

export function formatDoctorToon(report: DiagnosticReport, full = false): string {
  return `${encode(doctorToonDocument(report, full))}\n`;
}

export function formatDoctorOutput(report: DiagnosticReport, options: DoctorCliOptions): string {
  if (options.format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (options.format === "toon") return formatDoctorToon(report, options.full);
  return formatDiagnosticReport(report);
}

export function parseDoctorToon(value: string): ReturnType<typeof doctorToonDocument> {
  return decode(value) as unknown as ReturnType<typeof doctorToonDocument>;
}

export function doctorCliError(error: DoctorArgumentError, format: "json" | "toon"): DoctorCliErrorShape {
  return {
    schema: DOCTOR_TOON_SCHEMA,
    schemaVersion: DOCTOR_TOON_SCHEMA_VERSION,
    format,
    status: "error",
    error: { code: error.code, message: error.message, hint: error.hint },
    help: { command: "ask-llm-mcp doctor --help" },
  };
}

export function formatDoctorCliError(error: DoctorArgumentError, format: "json" | "toon"): string {
  const document = doctorCliError(error, format);
  return format === "toon" ? `${encode(document)}\n` : `${JSON.stringify(document)}\n`;
}
