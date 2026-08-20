import { type DiagnosticReport, formatDiagnosticReport } from "@ask-llm/shared";
import { decode } from "@toon-format/toon";
import { describe, expect, it } from "vitest";
import {
  DOCTOR_TOON_MAX_TEXT_BYTES,
  type DoctorArgumentError,
  doctorToonDocument,
  formatDoctorCliError,
  formatDoctorOutput,
  formatDoctorToon,
  parseDoctorArguments,
  parseDoctorToon,
  requestedStructuredFormat,
} from "../toonDoctor.js";

function makeReport(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  return {
    status: "warning",
    generatedAt: "2026-08-20T00:00:00.000Z",
    environment: {
      nodeVersion: "v24.13.0",
      nodeOk: true,
      platform: "darwin",
      arch: "arm64",
      resolvedPath: "/private/bin:/usr/bin",
      askLlmPath: undefined,
      timeoutMs: 210_000,
      codexTimeoutMs: 800_000,
      claudeTimeoutMs: 600_000,
      grokTimeoutMs: 600_000,
      cursorHarnessTimeoutMs: 600_000,
      geminiTimeoutMs: 210_000,
    },
    providers: [
      {
        name: "Codex",
        command: "codex",
        available: true,
        cliPath: "/private/bin/codex",
        cliVersion: "codex-cli 0.148.0",
        error: undefined,
        enrichment: {
          heading: "codex doctor",
          overall: "warning",
          checks: [
            { name: "auth.credentials", status: "pass", summary: "auth is configured" },
            {
              name: "state.rollout_db_parity",
              status: "warn",
              summary: "rollout inventory differs",
              remediation: "Run codex doctor.",
            },
          ],
        },
      },
      {
        name: "Ollama",
        command: "ollama",
        available: false,
        cliPath: undefined,
        cliVersion: undefined,
        error: "endpoint unreachable",
      },
    ],
    checks: [
      { name: "Node.js version", status: "pass", message: "v24.13.0 (>= v20 required)" },
      {
        name: "Provider: Ollama",
        status: "warn",
        message: "endpoint unreachable",
        fix: "Start Ollama, then retry.",
      },
    ],
    ...overrides,
  };
}

describe("doctor format negotiation", () => {
  it("keeps text as default and the existing --json alias", () => {
    expect(parseDoctorArguments([])).toEqual({ format: "text", full: false, help: false });
    expect(parseDoctorArguments(["--json"])).toEqual({ format: "json", full: false, help: false });
  });

  it("preserves established text and pretty JSON bytes", () => {
    const report = makeReport();
    expect(formatDoctorOutput(report, parseDoctorArguments([]))).toBe(formatDiagnosticReport(report));
    expect(formatDoctorOutput(report, parseDoctorArguments(["--json"]))).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(formatDoctorOutput(report, parseDoctorArguments(["--format", "json"]))).toBe(
      `${JSON.stringify(report, null, 2)}\n`,
    );
  });

  it("supports explicit text, JSON, bounded TOON, and full TOON", () => {
    expect(parseDoctorArguments(["--format", "text"]).format).toBe("text");
    expect(parseDoctorArguments(["--format", "json"]).format).toBe("json");
    expect(parseDoctorArguments(["--format", "toon"])).toEqual({ format: "toon", full: false, help: false });
    expect(parseDoctorArguments(["--format", "toon", "--full"])).toEqual({
      format: "toon",
      full: true,
      help: false,
    });
  });

  it("accepts --full as a no-op for text and JSON because they are already complete", () => {
    const report = makeReport();
    expect(parseDoctorArguments(["--full"])).toEqual({ format: "text", full: true, help: false });
    expect(parseDoctorArguments(["--json", "--full"])).toEqual({ format: "json", full: true, help: false });
    expect(formatDoctorOutput(report, parseDoctorArguments(["--full"]))).toBe(formatDiagnosticReport(report));
    expect(formatDoctorOutput(report, parseDoctorArguments(["--json", "--full"]))).toBe(
      `${JSON.stringify(report, null, 2)}\n`,
    );
  });

  it.each([
    [["--format", "yaml"], "unsupported_format"],
    [["--format"], "missing_format"],
    [["--json", "--format", "toon"], "conflicting_formats"],
    [["--full", "--full"], "duplicate_flag"],
    [["--wat"], "unknown_argument"],
    [["--json", "--verbose"], "unknown_argument"],
  ] as const)("rejects invalid arguments actionably: %j", (args, code) => {
    expect(() => parseDoctorArguments([...args])).toThrowError(
      expect.objectContaining<Partial<DoctorArgumentError>>({ code }),
    );
  });

  it("renders parser-readable structured TOON errors when TOON was requested", () => {
    let thrown: DoctorArgumentError | undefined;
    try {
      parseDoctorArguments(["--format", "toon", "--wat"]);
    } catch (error) {
      thrown = error as DoctorArgumentError;
    }
    const output = formatDoctorCliError(thrown as DoctorArgumentError, "toon");
    expect(requestedStructuredFormat(["--format", "toon", "--wat"])).toBe("toon");
    expect(decode(output)).toMatchObject({
      schemaVersion: 1,
      format: "toon",
      status: "error",
      error: { code: "unknown_argument", hint: expect.stringContaining("--help") },
    });
    expect(output).not.toContain("--wat");
  });
});

describe("bounded doctor TOON schema", () => {
  it("round-trips through the official strict parser", () => {
    const document = doctorToonDocument(makeReport());
    expect(parseDoctorToon(formatDoctorToon(makeReport()))).toEqual(document);
  });

  it("is versioned, attributable, stably ordered, and truthful for partial availability", () => {
    const document = doctorToonDocument(makeReport());

    expect(document).toMatchObject({
      schema: "ask-llm.doctor",
      schemaVersion: 1,
      mode: "bounded",
      status: "warning",
      summary: {
        providersTotal: 2,
        providersAvailable: 1,
        providersUnavailable: 1,
        providersOmitted: 0,
      },
    });
    expect(document.providers.map((provider) => provider.provider)).toEqual(["Codex", "Ollama"]);
    expect(document.providers[0]).toMatchObject({
      provider: "Codex",
      availability: "available",
      detail: "codex doctor: warning",
    });
    expect(document.providers[1]).toEqual({
      provider: "Ollama",
      availability: "unavailable",
      version: null,
      detail: "endpoint unreachable",
    });
    expect(document.providerChecks[0]).toMatchObject({
      provider: "Codex",
      name: "state.rollout_db_parity",
      status: "warn",
    });
  });

  it("distinguishes omitted detail from unavailable providers and stays complete when only filtering", () => {
    const document = doctorToonDocument(makeReport());

    expect(document.summary.providersOmitted).toBe(0);
    expect(document.completeness).toBe("complete");
    expect(document.omissions).toEqual({
      checks: { filtered: 1, capped: 0 },
      providerChecks: { filtered: 1, capped: 0 },
      pathFields: 2,
    });
  });

  it("omits only direct path fields in bounded mode and leaves check text unchanged", () => {
    const report = makeReport({
      environment: { ...makeReport().environment, askLlmPath: "/private/override" },
      checks: [
        {
          name: "Provider: Codex",
          status: "warn",
          message: "Found at /private/bin/codex but version probe failed",
          fix: "Reinstall Codex.",
        },
      ],
    });
    const document = doctorToonDocument(report);
    const encoded = formatDoctorToon(report);

    expect(document.environment).not.toHaveProperty("resolvedPath");
    expect(document.environment).not.toHaveProperty("askLlmPath");
    expect(document.providers.every((provider) => !("path" in provider))).toBe(true);
    expect(document.omissions.pathFields).toBe(3);
    expect(encoded).not.toContain("/private/bin:/usr/bin");
    expect(encoded).not.toContain("/private/override");
    expect(document.checks[0].message).toBe("Found at /private/bin/codex but version probe failed");
  });

  it("has definitive empty arrays and zero aggregates", () => {
    const report = makeReport({ status: "ok", providers: [], checks: [] });
    const document = parseDoctorToon(formatDoctorToon(report));

    expect(document.summary).toMatchObject({
      providersTotal: 0,
      providersAvailable: 0,
      providersUnavailable: 0,
      checksShown: 0,
      providerChecksShown: 0,
    });
    expect(document.completeness).toBe("complete");
    expect(document.providers).toEqual([]);
    expect(document.checks).toEqual([]);
    expect(document.providerChecks).toEqual([]);
    expect(document.truncations).toEqual([]);
  });

  it("preserves actionable failure status, message, and fix", () => {
    const report = makeReport({
      status: "error",
      checks: [{ name: "Node.js version", status: "fail", message: "Node is too old", fix: "Install Node 22." }],
    });
    const document = doctorToonDocument(report);

    expect(document.status).toBe("error");
    expect(document.checks).toEqual([
      { name: "Node.js version", status: "fail", message: "Node is too old", fix: "Install Node 22." },
    ]);
  });

  it("bounds UTF-8 text and discloses original byte sizes", () => {
    const longMessage = "é".repeat(400);
    const report = makeReport({
      checks: [{ name: "long", status: "warn", message: longMessage, fix: longMessage }],
    });
    const document = doctorToonDocument(report);

    expect(Buffer.byteLength(document.checks[0].message, "utf8")).toBeLessThanOrEqual(DOCTOR_TOON_MAX_TEXT_BYTES);
    expect(document.checks[0].message).not.toContain("�");
    expect(document.truncations).toEqual([
      { field: "checks[0].message", originalBytes: 800 },
      { field: "checks[0].fix", originalBytes: 800 },
    ]);
    expect(document.completeness).toBe("partial");
    expect(document.help.full).toContain("--full");
  });

  it("caps record counts and does not emit truncation metadata for omitted records", () => {
    const enrichmentChecks = Array.from({ length: 25 }, (_, index) => ({
      name: `check-${index}`,
      status: "warn" as const,
      summary: `detail-${index} ${"x".repeat(300)}`,
    }));
    const base = makeReport();
    const report = makeReport({
      providers: [
        {
          ...base.providers[0],
          enrichment: { heading: "doctor", overall: "warning", checks: enrichmentChecks },
        },
      ],
    });
    const document = doctorToonDocument(report);

    expect(document.providerChecks).toHaveLength(20);
    expect(document.omissions.providerChecks).toEqual({ filtered: 0, capped: 5 });
    expect(document.completeness).toBe("partial");
    expect(document.truncations).toHaveLength(20);
    expect(document.truncations.some((item) => item.field.includes("[20]"))).toBe(false);
  });

  it("separates checks filtered by design from actionable checks lost to the cap", () => {
    const passChecks = Array.from({ length: 3 }, (_, index) => ({
      name: `pass-${index}`,
      status: "pass" as const,
      message: "fine",
    }));
    const warnChecks = Array.from({ length: 25 }, (_, index) => ({
      name: `warn-${index}`,
      status: "warn" as const,
      message: `detail-${index}`,
    }));
    const document = doctorToonDocument(makeReport({ checks: [...passChecks, ...warnChecks] }));

    expect(document.summary.checksShown).toBe(20);
    expect(document.checks.map((check) => check.name)).toEqual(warnChecks.slice(0, 20).map((check) => check.name));
    expect(document.omissions.checks).toEqual({ filtered: 3, capped: 5 });
    expect(document.completeness).toBe("partial");
  });

  it("provides a full escape hatch with paths, pass checks, and untruncated text", () => {
    const longMessage = "detail ".repeat(100);
    const report = makeReport({
      checks: [
        { name: "pass", status: "pass", message: "fine" },
        { name: "warn", status: "warn", message: longMessage },
      ],
    });
    const document = doctorToonDocument(report, true);

    expect(document.mode).toBe("full");
    expect(document.environment).toMatchObject({
      defaultTimeoutMs: 210_000,
      resolvedPath: "/private/bin:/usr/bin",
      askLlmPath: null,
    });
    expect(document.providers[0]).toMatchObject({ command: "codex", path: "/private/bin/codex" });
    expect(document.checks.map((check) => check.name)).toEqual(["pass", "warn"]);
    expect(document.checks[1].message).toBe(longMessage);
    expect(document.completeness).toBe("complete");
    expect(document.omissions).toEqual({
      checks: { filtered: 0, capped: 0 },
      providerChecks: { filtered: 0, capped: 0 },
      pathFields: 0,
    });
    expect(document.truncations).toEqual([]);
  });

  it("strict parsing rejects a truncated tabular provider row", () => {
    const encoded = formatDoctorToon(makeReport());
    const corrupted = encoded.replace("Ollama,unavailable,null,endpoint unreachable", "Ollama,unavailable");
    expect(() => decode(corrupted)).toThrow();
  });
});
