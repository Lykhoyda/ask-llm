import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildLivePrompt,
  type CommandResult,
  type EvaluateInvocationOptions,
  evaluateInvocation,
  hasFallbackDisclosure,
  parseCatalog,
  RESULTS,
  type RunHarnessSuiteOptions,
  redact,
  runCommand,
  runHarnessSuite,
  SCENARIOS,
  type Scenario,
  type Selection,
  smokeMarker,
  validateCursorProviderFamily,
} from "./harness-smoke-lib.ts";

const directCodex = SCENARIOS.find(({ id }) => id === "codex-cli:/brainstorm-route");
const cursorBrainstorm = SCENARIOS.find(({ id }) => id === "cursor-agent:/brainstorm-route");
const soloBrainstorm = SCENARIOS.find(({ soloBrainstorm }) => soloBrainstorm);

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function runIsolatedSuite(options: RunHarnessSuiteOptions) {
  return runHarnessSuite({ ...options, fingerprint: async () => "stable" });
}

function fakeAdapter({ scenario, selection }: { scenario: Scenario; selection: Selection }): Promise<CommandResult> {
  return Promise.resolve({
    exitCode: 0,
    stdout: JSON.stringify({
      marker: smokeMarker(scenario, selection.model),
      provider: scenario.provider,
      model: selection.model,
      fellBack: false,
      invocations: [{ command: scenario.tool, args: ["--model", selection.model] }],
    }),
    stderr: "",
    timedOut: false,
  });
}

function evaluate(overrides: Partial<EvaluateInvocationOptions> = {}) {
  invariant(directCodex, "direct Codex scenario missing");
  return evaluateInvocation({
    scenario: directCodex,
    requestedModel: "gpt-6.2-sol",
    observedModel: "gpt-6.2-sol",
    output: smokeMarker(directCodex, "gpt-6.2-sol"),
    exitCode: 0,
    timedOut: false,
    mutated: false,
    args: ["exec", "--sandbox", "read-only", "--model", "gpt-6.2-sol"],
    ...overrides,
  } as EvaluateInvocationOptions);
}

describe("authoritative local catalog discovery", () => {
  it("parses exact Cursor, Pi, Grok, and Codex catalog IDs without normalization", () => {
    expect(parseCatalog("agent", "Available models\ngrok-4.7-high - Grok 4.7\ngpt-6.2-sol-high - GPT Sol\n")).toEqual([
      "grok-4.7-high",
      "gpt-6.2-sol-high",
    ]);
    expect(
      parseCatalog("pi", "provider model context\nopenai-codex gpt-6.2-sol 272K\nanthropic claude-opus-5-5 200K\n"),
    ).toEqual(["openai-codex/gpt-6.2-sol", "anthropic/claude-opus-5-5"]);
    expect(parseCatalog("grok", "Available models\ngrok-4.7 default\n")).toEqual(["grok-4.7"]);
    expect(
      parseCatalog("codex", JSON.stringify({ models: [{ slug: "gpt-6.2-sol" }, { id: "gpt-5.6-terra" }] })),
    ).toEqual(["gpt-6.2-sol", "gpt-5.6-terra"]);
  });

  it("fails closed when a successful catalog command parses no exact IDs", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const adapter = vi.fn(fakeAdapter);
    const report = await runIsolatedSuite({
      mode: "live",
      env: {
        ...process.env,
        ASK_LLM_HARNESS_SMOKE_AUTHORIZED: directCodex.id,
        ASK_LLM_HARNESS_SMOKE_CODEX_MODEL: "gpt-6.2-sol",
      },
      scenarios: [directCodex],
      discovery: { codex: { available: true, catalogAuthorized: false, reason: "catalog unparseable", catalog: [] } },
      deterministicAdapter: adapter,
    });
    expect(report.results).toEqual([
      { id: directCodex.id, status: RESULTS.SKIP_NOT_AUTHORIZED, reason: "catalog unparseable" },
    ]);
    expect(adapter).not.toHaveBeenCalled();
  });
});

describe("real deterministic adapter probes", () => {
  it("preserves a child's early failure when it closes stdin without reading the prompt", async () => {
    const result = await runCommand(process.execPath, ["-e", 'console.error("fixture preflight"); process.exit(17)'], {
      stdin: "synthetic prompt ".repeat(100_000),
    });
    expect(result).toMatchObject({ exitCode: 17, stderr: "fixture preflight\n", timedOut: false });
  });

  it("runs the solo transport matrix over packed MCP, marketplace, native Pi and direct CLI", async () => {
    invariant(soloBrainstorm, "solo brainstorm scenario missing");
    const { results } = await runIsolatedSuite({ mode: "dry-run", scenarios: [soloBrainstorm] });
    expect(results[0], results[0]?.detail).toMatchObject({
      id: soloBrainstorm.id,
      status: RESULTS.PASS,
      detail: expect.stringContaining("Codex CLI · selected gpt-6.2-astra · reasoning effort configured high"),
    });
    for (const count of [
      "marketplace:1/1",
      "stale-split:1/1",
      "cli-only:0/1",
      "split-quota:1/1",
      "cli-auto:0/0",
      "cli-multiple:0/0",
      "cli-effort:0/0",
      "no-binary:0/0",
    ]) {
      expect(results[0]?.detail).toContain(count);
    }
  }, 35_000);

  it("runs the real exact-panel/Cursor adapters against fake transports", async () => {
    invariant(cursorBrainstorm, "adapter scenario missing");
    const report = await runIsolatedSuite({ mode: "dry-run", scenarios: [cursorBrainstorm] });
    expect(report.results).toEqual([
      expect.objectContaining({
        id: cursorBrainstorm.id,
        status: RESULTS.PASS,
        detail: expect.stringContaining("invocations"),
      }),
    ]);
  }, 30_000);

  it("runs the real Codex adapter on the Sol factory default against fake transports", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const report = await runIsolatedSuite({ mode: "dry-run", scenarios: [directCodex] });
    expect(report.results).toEqual([
      expect.objectContaining({
        id: directCodex.id,
        status: RESULTS.PASS,
        reason: expect.stringContaining("gpt-6.2-sol"),
        detail: expect.stringContaining("invocations"),
      }),
    ]);
  }, 30_000);

  it("fails if the adapter never reaches a fake transport", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const report = await runIsolatedSuite({
      mode: "dry-run",
      scenarios: [directCodex],
      deterministicAdapter: async () => ({ exitCode: 1, stdout: "", stderr: "adapter did not run", timedOut: false }),
    });
    expect(report.results[0]).toMatchObject({ status: RESULTS.FAIL, reason: expect.stringContaining("nonzero") });
  });
});

describe("structured fallback, routing, and attribution", () => {
  it.each([
    '{"fellBack":true}',
    '{"fallback":true}',
    '{"usage":{"fellBack":true}}',
    '{"response":"{\\"usage\\":{\\"fellBack\\":true}}"}',
    '{"type":"result"}\n{"usage":{"fallback":true}}',
    "fallback used",
  ])("detects fallback disclosure %s", (output) => {
    invariant(directCodex, "direct Codex scenario missing");
    expect(hasFallbackDisclosure(output)).toBe(true);
    expect(evaluate({ output: `${smokeMarker(directCodex, "gpt-6.2-sol")}\n${output}` })).toMatchObject({
      status: RESULTS.FAIL,
      reason: expect.stringContaining("forbidden fallback"),
    });
  });

  it("keeps provider identity separate from exact Cursor model identity", async () => {
    await expect(validateCursorProviderFamily("grok", "grok-4.7-high")).resolves.toBe("grok");
    await expect(validateCursorProviderFamily("grok", "gpt-6.2-sol-high")).rejects.toThrow(
      /belongs to provider codex, not grok/,
    );
  });

  it("rejects a catalog-present cross-family Cursor route before a live invocation", async () => {
    invariant(cursorBrainstorm, "Cursor brainstorm scenario missing");
    const commandRunner = vi.fn();
    const report = await runIsolatedSuite({
      mode: "live",
      env: {
        ...process.env,
        ASK_LLM_HARNESS_SMOKE_AUTHORIZED: cursorBrainstorm.id,
        ASK_LLM_HARNESS_SMOKE_CURSOR_HOST_MODEL: "gpt-6.2-sol-high",
        ASK_LLM_HARNESS_SMOKE_CURSOR_GROK_MODEL: "gpt-6.2-sol-high",
        ASK_LLM_HARNESS_SMOKE_CURSOR_CODEX_MODEL: "gpt-6.2-sol-high",
      },
      scenarios: [cursorBrainstorm],
      discovery: {
        agent: {
          available: true,
          catalogAuthorized: true,
          catalog: ["gpt-6.2-sol-high"],
          reason: "fixture catalog",
        },
      },
      commandRunner,
    });
    expect(report.results[0]).toMatchObject({
      status: RESULTS.FAIL,
      reason: expect.stringContaining("provider codex"),
    });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it.each([
    [{ timedOut: true }, /timed out/],
    [{ exitCode: 9 }, /nonzero/],
    [{ observedModel: "gpt-5.6-terra" }, /model mismatch/],
    [{ mutated: true }, /repository changed/],
    [{ args: ["exec", "--sandbox", "read-only"] }, /model option was lost/],
    [{ args: ["exec", "--model", "gpt-6.2-sol", "--sandbox", "WORKSPACE-WRITE"] }, /mutation\/trust flag/],
    [{ args: ["--model", "gpt-6.2-sol", "--trust"] }, /mutation\/trust flag/],
  ])("fails closed for %j", (overrides, reason) => {
    expect(evaluate(overrides)).toMatchObject({ status: RESULTS.FAIL, reason: expect.stringMatching(reason) });
  });
});

describe("exact live skill prompts", () => {
  it("pins both brainstorm participants and explicit consent", () => {
    invariant(cursorBrainstorm, "Cursor brainstorm scenario missing");
    const prompt = buildLivePrompt(cursorBrainstorm, {
      model: "grok-4.7-high",
      secondaryModel: "gpt-6.2-sol-high",
    });
    expect(prompt).toContain("/brainstorm grok@cursor-agent:grok-4.7-high,codex@cursor-agent:gpt-6.2-sol-high");
    expect(prompt).toContain("consent=confirmed");
  });

  it.each([
    ["cursor-agent:/codex-pair", "/codex-pair model=gpt-6.2-sol effort=high", "gpt-6.2-sol"],
    ["claude:/grok-pair", "/grok-pair route=grok-cli model=grok-4.7 effort=high", "grok-4.7"],
  ])("pins route/model/effort/consent for %s", (id, expected, model) => {
    const scenario = SCENARIOS.find((entry) => entry.id === id);
    invariant(scenario, `scenario ${id} missing`);
    const prompt = buildLivePrompt(scenario, { model, effort: scenario.effort });
    expect(prompt).toContain(expected);
    expect(prompt).toContain("consent=confirmed");
    expect(prompt).toContain(`provider=${scenario.provider}`);
  });
});

describe("authorization and availability accounting", () => {
  it.each(["dry-run", "live"] as const)("excludes Google routes from the generic %s matrix", async (mode) => {
    invariant(directCodex, "direct Codex scenario missing");
    const codex = directCodex;
    const home = await mkdtemp(join(tmpdir(), "ask-llm-harness-google-exclusion-"));
    const google = /(?:^|[^a-z])(?:agy|antigravity|gemini)(?:$|[^a-z])/i;
    const argv: Array<[string, string[]]> = [];
    const adapter = vi.fn(fakeAdapter);
    try {
      for (const tool of ["codex", "gemini", "agy"]) {
        await writeFile(join(home, tool), "#!/bin/sh\nexit 97\n", { mode: 0o755 });
      }
      await writeFile(join(home, "models_cache.json"), JSON.stringify({ models: [{ slug: "gpt-6.2-sol" }] }));
      const report = await runIsolatedSuite({
        mode,
        env: {
          HOME: home,
          CODEX_HOME: home,
          PATH: home,
          ASK_LLM_HARNESS_SMOKE_LIVE: "1",
          ASK_LLM_HARNESS_SMOKE_AUTHORIZED: "all",
          ASK_LLM_HARNESS_SMOKE_CODEX_MODEL: "gpt-6.2-sol",
          ASK_LLM_HARNESS_SMOKE_CODEX_EFFORT: "high",
          ASK_LLM_HARNESS_SMOKE_GEMINI_MODEL: "gemini-4-argon",
          ASK_LLM_HARNESS_SMOKE_ANTIGRAVITY_MODEL: "gemini-4-neon",
          ASK_ANTIGRAVITY_ALLOW_UNISOLATED: "1",
        },
        deterministicAdapter: adapter,
        commandRunner: async (tool, args) => {
          argv.push([tool, args]);
          const stdout = tool === "codex" && args[0] === "exec" ? smokeMarker(codex, "gpt-6.2-sol") : "1.5.9";
          return { exitCode: 0, stdout, stderr: "", timedOut: false };
        },
      });

      expect(report.results).toContainEqual(expect.objectContaining({ id: codex.id, status: RESULTS.PASS }));
      expect(report.results.some(({ id }) => google.test(id))).toBe(false);
      if (mode === "live") expect(argv).toContainEqual(["codex", ["--version"]]);
      else expect(adapter).toHaveBeenCalled();
      expect(argv.some(([tool, args]) => google.test([tool, ...args].join(" ")))).toBe(false);
      for (const [{ scenario }] of adapter.mock.calls) {
        const { tool, provider, harness, modelKey, hostModelKey, secondaryModelKey } = scenario;
        expect([tool, provider, harness, modelKey, hostModelKey, secondaryModelKey].join(" ")).not.toMatch(google);
      }
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports installed but unauthorized live surfaces distinctly", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const report = await runIsolatedSuite({
      mode: "live",
      env: { ...process.env, ASK_LLM_HARNESS_SMOKE_AUTHORIZED: "" },
      scenarios: [directCodex],
      discovery: { codex: { available: true, catalogAuthorized: true, catalog: ["gpt-6.2-sol"] } },
    });
    expect(report.results).toEqual([
      expect.objectContaining({ id: directCodex.id, status: RESULTS.SKIP_NOT_AUTHORIZED }),
    ]);
  });

  it("marks Pi codex-pair unavailable in unsupported one-shot live mode", async () => {
    const pair = SCENARIOS.find(({ id }) => id === "pi:/codex-pair");
    invariant(pair, "Pi pair scenario missing");
    const report = await runIsolatedSuite({ mode: "live", scenarios: [pair] });
    expect(report.results).toEqual([
      expect.objectContaining({
        id: pair.id,
        status: RESULTS.SKIP_UNAVAILABLE,
        reason: expect.stringContaining("TUI/RPC"),
      }),
    ]);
  });

  it("reports deliberate host exclusions as unavailable, never green", async () => {
    const report = await runIsolatedSuite({ mode: "dry-run", deterministicAdapter: fakeAdapter });
    expect(report.results.find(({ id }) => id === "pi:/grok-pair")).toMatchObject({
      status: RESULTS.SKIP_UNAVAILABLE,
      reason: expect.stringContaining("grok-pair refuses on Pi"),
    });
    expect(report.results.some(({ status }) => status === RESULTS.FAIL)).toBe(false);
  });
});

describe("mutation, timeout, privacy, and cleanup", () => {
  it("attributes a repository mutation only to the scenario that introduced it", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const first = { ...directCodex, id: "fixture:first" };
    const second = { ...directCodex, id: "fixture:second" };
    const fingerprints = ["clean", "clean", "mutated", "mutated", "mutated", "mutated"];
    const fingerprint = vi.fn(async () => fingerprints.shift() ?? "mutated");
    const report = await runHarnessSuite({
      mode: "dry-run",
      scenarios: [first, second],
      fingerprint,
      deterministicAdapter: fakeAdapter,
    });
    expect(report.results).toEqual([
      expect.objectContaining({ id: first.id, status: RESULTS.FAIL, reason: expect.stringContaining("changed") }),
      expect.objectContaining({ id: second.id, status: RESULTS.PASS }),
    ]);
  });

  it("detects content mutation of an already-present untracked workspace file", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const report = await runIsolatedSuite({
      mode: "dry-run",
      scenarios: [directCodex],
      deterministicAdapter: async ({
        workspace,
        ...context
      }: {
        workspace: string;
        scenario: Scenario;
        selection: Selection;
      }) => {
        await writeFile(`${workspace}/README.md`, "silently mutated\n");
        return fakeAdapter(context);
      },
    });
    expect(report.results[0]).toMatchObject({ status: RESULTS.FAIL, reason: expect.stringContaining("changed") });
  });

  it("terminates a wedged local command and reports the timeout", async () => {
    const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], { timeoutMs: 25 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it("redacts configured credentials and key-shaped values", () => {
    const secret = "xai-secret-value-123";
    const output = redact(`Authorization ${secret} token sk-live-123456789`, { XAI_API_KEY: secret });
    expect(output).toBe("Authorization [REDACTED] token [REDACTED]");
    expect(output).not.toContain(secret);
  });

  it("removes private prompts and outputs after every suite run", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const report = await runIsolatedSuite({
      mode: "dry-run",
      scenarios: [directCodex],
      deterministicAdapter: fakeAdapter,
    });
    await expect(access(report.tempRoot)).rejects.toThrow();
  });
});
