import { readdirSync, realpathSync } from "node:fs";
import type { DiagnosticReport, ProviderProbe, ProviderSpec } from "@ask-llm/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exerciseProviders } from "../doctorCli.js";
import type { ExecutorFn } from "../index.js";

function provider(name: string, overrides: Partial<ProviderProbe> = {}): ProviderProbe {
  return {
    name,
    command: name.toLowerCase(),
    available: true,
    states: { installed: "yes", authenticated: "yes", permitted: "yes", exercised: "not-run" },
    ...overrides,
  };
}

function report(providers: ProviderProbe[]): DiagnosticReport {
  return {
    status: "ok",
    generatedAt: "2026-09-29T00:00:00.000Z",
    environment: {
      nodeVersion: "v24.14.0",
      nodeOk: true,
      platform: "darwin",
      arch: "arm64",
      resolvedPath: "/usr/bin",
      timeoutMs: 210_000,
      codexTimeoutMs: 800_000,
      claudeTimeoutMs: 600_000,
      geminiTimeoutMs: 210_000,
      grokTimeoutMs: 600_000,
      cursorHarnessTimeoutMs: 600_000,
    },
    providers,
    checks: [],
  };
}

const specs: ProviderSpec[] = ["Codex", "Antigravity", "Ollama", "Gemini"].map((name) => ({
  key: name.toLowerCase(),
  name,
  command: name.toLowerCase(),
}));

describe("exerciseProviders", () => {
  it("exercises only ready providers read-only from an empty directory and records each outcome", async () => {
    const cwd = process.cwd();
    const seen: Array<{ key: string; options: Parameters<ExecutorFn>[0]; cwd: string }> = [];
    const loadExecutor = vi.fn(
      async (key: string): Promise<ExecutorFn> =>
        async (options) => {
          seen.push({ key, options, cwd: realpathSync(process.cwd()) });
          expect(readdirSync(process.cwd())).toEqual([]);
          if (key === "gemini") throw new Error("quota exhausted");
          return { response: "OK", model: `${key}-model` };
        },
    );
    const result = await exerciseProviders(
      report([
        provider("Codex"),
        provider("Antigravity", {
          states: { installed: "yes", authenticated: "unknown", permitted: "no", exercised: "not-run" },
        }),
        provider("Ollama", { available: false }),
        provider("Gemini"),
      ]),
      specs,
      loadExecutor,
    );

    expect(process.cwd()).toBe(cwd);
    expect(seen.map(({ key }) => key)).toEqual(["codex", "gemini"]);
    expect(new Set(seen.map((call) => call.cwd)).size).toBe(1);
    expect(seen[0].cwd).not.toBe(realpathSync(cwd));
    const request = { prompt: "Reply with exactly: OK", sandbox: "read-only", readOnly: true };
    expect(seen[0].options).toMatchObject({ ...request, reasoningEffort: "low", singleAttempt: true });
    expect(seen[1].options).toMatchObject({ ...request, singleAttempt: true });
    expect(seen[1].options).not.toHaveProperty("reasoningEffort");
    expect(result.providers.map((p) => p.states?.exercised)).toEqual(["yes", "no", "no", "no"]);
    expect(result.checks).toEqual([
      expect.objectContaining({ name: "Live: Codex", status: "pass", message: expect.stringContaining("codex-model") }),
      expect.objectContaining({
        name: "Live: Antigravity",
        status: "skip",
        message: expect.stringContaining("not permitted"),
      }),
      expect.objectContaining({
        name: "Live: Ollama",
        status: "skip",
        message: expect.stringContaining("not available"),
      }),
      expect.objectContaining({
        name: "Live: Gemini",
        status: "fail",
        message: expect.stringContaining("quota exhausted"),
      }),
    ]);
    expect(result.status).toBe("error");
  });

  it("does not load an executor when no provider is ready", async () => {
    const loadExecutor = vi.fn();
    const result = await exerciseProviders(report([provider("Ollama", { available: false })]), specs, loadExecutor);
    expect(loadExecutor).not.toHaveBeenCalled();
    expect(result.status).toBe("ok");
  });

  it("pins a ready Grok CLI when the API key is absent", async () => {
    const priorKey = process.env.XAI_API_KEY;
    const priorHarness = process.env.ASK_GROK_HARNESS;
    delete process.env.XAI_API_KEY;
    delete process.env.ASK_GROK_HARNESS;
    const executor = vi.fn<ExecutorFn>().mockResolvedValue({ response: "OK", model: "grok" });
    try {
      await exerciseProviders(report([provider("Grok")]), [{ key: "grok", name: "Grok", command: "grok" }], async () => executor);
      expect(executor).toHaveBeenCalledWith(expect.objectContaining({ harness: "grok-cli", singleAttempt: true }));
    } finally {
      if (priorKey === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = priorKey;
      if (priorHarness === undefined) delete process.env.ASK_GROK_HARNESS;
      else process.env.ASK_GROK_HARNESS = priorHarness;
    }
  });
});

describe("runDoctorCli --live", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("../utils/providerSpecs.js");
    vi.doUnmock("../utils/providerModules.js");
    vi.doUnmock("../hosts/detect.js");
    vi.resetModules();
  });

  async function doctor(args: string[], executor: ExecutorFn) {
    vi.resetModules();
    vi.doMock("../utils/providerSpecs.js", () => ({
      buildProviderSpecs: async () => [
        {
          key: "codex",
          name: "Codex",
          command: "node",
          localStates: async () => ({ installed: "yes", authenticated: "yes", permitted: "yes" }),
        },
      ],
    }));
    vi.doMock("../utils/providerModules.js", () => ({
      loadProviderModule: async () => ({ executeCodexCLI: executor }),
    }));
    vi.doMock("../hosts/detect.js", () => ({ detectHosts: async () => [] }));
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    const { runDoctorCli } = await import("../doctorCli.js");
    const code = await runDoctorCli(args, "/nonexistent/ask-llm.js");
    return { code, report: JSON.parse(output) as DiagnosticReport };
  }

  it("never calls an executor without --live", async () => {
    const executor = vi.fn<ExecutorFn>();
    const { report } = await doctor(["--json"], executor);
    expect(executor).not.toHaveBeenCalled();
    expect(report.providers[0].states?.exercised).toBe("not-run");
  });

  it("exercises ready providers and fails the exit code when a call fails", async () => {
    const ok = await doctor(["--live", "--json"], async () => ({ response: "OK", model: "stub-model" }));
    expect(ok.report.providers[0].states?.exercised).toBe("yes");
    expect(ok.report.checks).toContainEqual(expect.objectContaining({ name: "Live: Codex", status: "pass" }));

    const failed = await doctor(["--live", "--json"], async () => {
      throw new Error("usage limit reached");
    });
    expect(failed.code).toBe(1);
    expect(failed.report.providers[0].states?.exercised).toBe("no");
  });
});
