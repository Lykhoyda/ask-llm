import { describe, expect, it } from "vitest";
import { type DiagnosticReport, formatDiagnosticReport, type ProviderSpec, runDiagnostics } from "../doctor.js";

function makeReport(overrides: Partial<DiagnosticReport> = {}): DiagnosticReport {
  return {
    status: "ok",
    generatedAt: "2026-04-16T00:00:00.000Z",
    environment: {
      nodeVersion: "v22.10.0",
      nodeOk: true,
      platform: "darwin",
      arch: "arm64",
      resolvedPath: "/usr/local/bin:/opt/homebrew/bin",
      askLlmPath: undefined,
      timeoutMs: 210000,
      codexTimeoutMs: 800000,
      geminiTimeoutMs: 210000,
    },
    providers: [],
    checks: [
      { name: "Node.js version", status: "pass", message: "v22.10.0 (>= v20 required)" },
      { name: "PATH resolution", status: "pass", message: "Resolved PATH has 2 entries" },
    ],
    ...overrides,
  };
}

describe("formatDiagnosticReport", () => {
  it("renders header with overall status uppercased", () => {
    const out = formatDiagnosticReport(makeReport());
    expect(out).toContain("ask-llm doctor — OK");
  });

  it("uses an X glyph for error status", () => {
    const out = formatDiagnosticReport(makeReport({ status: "error" }));
    expect(out).toContain("✗ ask-llm doctor — ERROR");
  });

  it("includes platform and per-provider timeouts in environment section (#45)", () => {
    const out = formatDiagnosticReport(makeReport());
    expect(out).toContain("Platform: darwin/arm64");
    // Per-provider line replaces the old single "Timeout:" line. Diagnose
    // output is what users paste into bug reports — the provider breakdown
    // makes "why did codex time out at 210s?" answerable at a glance.
    expect(out).toContain("Timeouts: codex=800000ms, gemini=210000ms");
  });

  it("flags Node version as TOO OLD when nodeOk is false", () => {
    const out = formatDiagnosticReport(
      makeReport({
        environment: {
          nodeVersion: "v18.15.0",
          nodeOk: false,
          platform: "linux",
          arch: "x64",
          resolvedPath: "/usr/bin",
          askLlmPath: undefined,
          timeoutMs: 210000,
          codexTimeoutMs: 800000,
          geminiTimeoutMs: 210000,
        },
      }),
    );
    expect(out).toContain("v18.15.0 (TOO OLD)");
  });

  it("renders ASK_LLM_PATH only when set", () => {
    const without = formatDiagnosticReport(makeReport());
    expect(without).not.toContain("ASK_LLM_PATH");

    const withPath = formatDiagnosticReport(
      makeReport({
        environment: { ...makeReport().environment, askLlmPath: "/foo:/bar:/baz" },
      }),
    );
    expect(withPath).toContain("ASK_LLM_PATH: set (3 entries)");
  });

  it("includes fix lines only for checks that have a fix", () => {
    const out = formatDiagnosticReport(
      makeReport({
        checks: [
          { name: "ok-check", status: "pass", message: "fine" },
          { name: "warn-check", status: "warn", message: "issue", fix: "do this" },
        ],
      }),
    );
    expect(out).toContain("✓ ok-check: fine");
    expect(out).toContain("! warn-check: issue");
    expect(out).toContain("→ do this");
    expect(out.match(/→/g)).toHaveLength(1);
  });

  it("renders providers section when populated", () => {
    const out = formatDiagnosticReport(
      makeReport({
        providers: [
          {
            name: "Gemini",
            command: "gemini",
            available: true,
            cliPath: "/opt/homebrew/bin/gemini",
            cliVersion: "0.37.0",
            error: undefined,
          },
          {
            name: "Codex",
            command: "codex",
            available: false,
            cliPath: undefined,
            cliVersion: undefined,
            error: "not found on PATH",
          },
        ],
      }),
    );
    expect(out).toContain("- Gemini: available (0.37.0)");
    expect(out).toContain("path: /opt/homebrew/bin/gemini");
    expect(out).toContain("- Codex: unavailable");
  });

  it("omits providers section when empty", () => {
    const out = formatDiagnosticReport(makeReport({ providers: [] }));
    expect(out).not.toContain("Providers:");
  });
});

describe("runDiagnostics", () => {
  it("returns ok status with empty providers when env is clean", async () => {
    const report = await runDiagnostics([]);
    expect(report.environment.nodeVersion).toBe(process.version);
    expect(report.environment.platform).toBe(process.platform);
    expect(report.providers).toEqual([]);
    expect(report.status).toMatch(/ok|warning/);
  });

  it("includes a Node.js version check", async () => {
    const report = await runDiagnostics([]);
    const nodeCheck = report.checks.find((c) => c.name === "Node.js version");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck?.status).toBe("pass");
  });

  it("includes a PATH resolution check", async () => {
    const report = await runDiagnostics([]);
    const pathCheck = report.checks.find((c) => c.name === "PATH resolution");
    expect(pathCheck).toBeDefined();
  });

  it("probes HTTP-based providers via probeAvailability", async () => {
    const provider: ProviderSpec = {
      key: "fake",
      name: "Fake HTTP Provider",
      command: "fake",
      probeAvailability: async () => false,
    };
    const report = await runDiagnostics([provider]);
    const probe = report.providers.find((p) => p.name === "Fake HTTP Provider");
    expect(probe).toBeDefined();
    expect(probe?.available).toBe(false);
    expect(probe?.error).toBe("endpoint unreachable");
  });

  it("returns warning status when an HTTP provider is unreachable", async () => {
    const provider: ProviderSpec = {
      key: "fake",
      name: "Fake",
      command: "fake",
      probeAvailability: async () => false,
      installHint: "install fake-cli",
    };
    const report = await runDiagnostics([provider]);
    expect(report.status).toBe("warning");
    const check = report.checks.find((c) => c.name === "Provider: Fake");
    expect(check?.status).toBe("warn");
    expect(check?.fix).toBe("install fake-cli");
  });

  it("treats probeAvailability throwing as unavailable", async () => {
    const provider: ProviderSpec = {
      key: "fake",
      name: "Fake",
      command: "fake",
      probeAvailability: async () => {
        throw new Error("network died");
      },
    };
    const report = await runDiagnostics([provider]);
    expect(report.providers[0].available).toBe(false);
  });

  it("flags unavailable CLI provider with install hint", async () => {
    const provider: ProviderSpec = {
      key: "missing",
      name: "Missing CLI",
      command: "this-command-definitely-does-not-exist-anywhere-1234567890",
      installHint: "npm install -g missing-cli",
    };
    const report = await runDiagnostics([provider]);
    const check = report.checks.find((c) => c.name === "Provider: Missing CLI");
    expect(check?.status).toBe("warn");
    expect(check?.fix).toBe("npm install -g missing-cli");
  });

  it("includes generatedAt timestamp in ISO format", async () => {
    const report = await runDiagnostics([]);
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe("formatDiagnosticReport — provider enrichment", () => {
  function codexProbe(enrichment?: DiagnosticReport["providers"][number]["enrichment"]) {
    return makeReport({
      providers: [
        {
          name: "Codex",
          command: "codex",
          available: true,
          cliPath: "/usr/bin/codex",
          cliVersion: "codex-cli 0.139.0",
          error: undefined,
          enrichment,
        },
      ],
    });
  }

  it("renders codex doctor overall status and only non-ok checks with remediation", () => {
    const out = formatDiagnosticReport(
      codexProbe({
        heading: "codex doctor",
        overall: "warning",
        checks: [
          { name: "auth.credentials", status: "pass", summary: "auth is configured" },
          {
            name: "state.rollout_db_parity",
            status: "warn",
            summary: "rollout files and state DB thread inventory differ",
            remediation: "run `codex doctor` to inspect",
          },
          { name: "git.optional", status: "skip", summary: "not applicable in this repo" },
          { name: "mcp.servers", status: "fail", summary: "1 server failed to start" },
        ],
      }),
    );
    expect(out).toContain("codex doctor: WARNING");
    // assert the warn glyph too (not just the name) — a `!`→`✗` regression must fail
    expect(out).toContain("! state.rollout_db_parity:");
    expect(out).toContain("rollout files and state DB thread inventory differ");
    expect(out).toContain("→ run `codex doctor` to inspect");
    // fail-status checks render with the ✗ glyph (non-ok, so not suppressed)
    expect(out).toContain("✗ mcp.servers: 1 server failed to start");
    // pass + skip are neutral; text mode shows only non-ok checks (full set in --json).
    // skip in particular must not render — its "-" glyph collides with the "- Codex:" prefix.
    expect(out).not.toContain("auth.credentials");
    expect(out).not.toContain("git.optional");
  });

  it("omits the enrichment block entirely when a provider has no enrichment", () => {
    const out = formatDiagnosticReport(codexProbe(undefined));
    expect(out).not.toContain("codex doctor:");
  });
});

describe("runDiagnostics — provider enrichment", () => {
  // `node` is guaranteed present + version-probeable in CI, so the provider
  // resolves to available and the enrich hook fires — no mocks needed.
  it("attaches enrichment from spec.enrich for an available provider", async () => {
    const enrichment = { heading: "codex doctor", overall: "ok" as const, checks: [] };
    const spec: ProviderSpec = {
      key: "node",
      name: "NodeEnrich",
      command: "node",
      enrich: async () => enrichment,
    };
    const report = await runDiagnostics([spec]);
    const probe = report.providers.find((p) => p.name === "NodeEnrich");
    expect(probe?.available).toBe(true);
    expect(probe?.enrichment).toEqual(enrichment);
  });

  it("degrades to undefined enrichment when spec.enrich throws", async () => {
    const spec: ProviderSpec = {
      key: "node",
      name: "NodeEnrichThrow",
      command: "node",
      enrich: async () => {
        throw new Error("doctor probe failed");
      },
    };
    const report = await runDiagnostics([spec]);
    const probe = report.providers.find((p) => p.name === "NodeEnrichThrow");
    expect(probe?.available).toBe(true);
    expect(probe?.enrichment).toBeUndefined();
  });

  it("does not run enrich for an unavailable provider", async () => {
    let called = false;
    const spec: ProviderSpec = {
      key: "missing",
      name: "MissingEnrich",
      command: "this-command-definitely-does-not-exist-1234567890",
      enrich: async () => {
        called = true;
        return { heading: "x", overall: "ok" as const, checks: [] };
      },
    };
    const report = await runDiagnostics([spec]);
    expect(called).toBe(false);
    expect(report.providers.find((p) => p.name === "MissingEnrich")?.enrichment).toBeUndefined();
  });
});
