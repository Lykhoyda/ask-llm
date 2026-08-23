import { access, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  buildLivePrompt,
  evaluateInvocation,
  hasFallbackDisclosure,
  parseCatalog,
  RESULTS,
  redact,
  runCommand,
  runHarnessSuite,
  SCENARIOS,
  smokeMarker,
  validateCursorProviderFamily,
} from "./harness-smoke-lib.mjs";

const directCodex = SCENARIOS.find(({ id }) => id === "codex-cli:/brainstorm-route");
const cursorBrainstorm = SCENARIOS.find(({ id }) => id === "cursor-agent:/brainstorm-route");

function invariant(value, message) {
  if (!value) throw new Error(message);
}

function runIsolatedSuite(options) {
  return runHarnessSuite({ ...options, fingerprint: async () => "stable" });
}

function fakeAdapter({ scenario, selection }) {
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

function evaluate(overrides = {}) {
  invariant(directCodex, "direct Codex scenario missing");
  return evaluateInvocation({
    scenario: directCodex,
    requestedModel: "gpt-5.6-sol",
    observedModel: "gpt-5.6-sol",
    output: smokeMarker(directCodex, "gpt-5.6-sol"),
    exitCode: 0,
    timedOut: false,
    mutated: false,
    args: ["exec", "--sandbox", "read-only", "--model", "gpt-5.6-sol"],
    ...overrides,
  });
}

describe("authoritative local catalog discovery", () => {
  it("parses exact Cursor, Pi, Grok, and Codex catalog IDs without normalization", () => {
    expect(
      parseCatalog("agent", "Available models\ncursor-grok-4.6-high - Grok 4.6\ngpt-5.6-sol-high - GPT Sol\n"),
    ).toEqual(["cursor-grok-4.6-high", "gpt-5.6-sol-high"]);
    expect(
      parseCatalog("pi", "provider model context\nopenai-codex gpt-5.6-sol 272K\nanthropic claude-opus-4-7 200K\n"),
    ).toEqual(["openai-codex/gpt-5.6-sol", "anthropic/claude-opus-4-7"]);
    expect(parseCatalog("grok", "Available models\ngrok-build default\ngrok-4.6 api\n")).toEqual([
      "grok-build",
      "grok-4.6",
    ]);
    expect(
      parseCatalog("codex", JSON.stringify({ models: [{ slug: "gpt-5.6-sol" }, { id: "gpt-5.6-terra" }] })),
    ).toEqual(["gpt-5.6-sol", "gpt-5.6-terra"]);
  });

  it("fails closed when a successful catalog command parses no exact IDs", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const adapter = vi.fn(fakeAdapter);
    const report = await runIsolatedSuite({
      mode: "live",
      env: {
        ...process.env,
        ASK_LLM_HARNESS_SMOKE_AUTHORIZED: directCodex.id,
        ASK_LLM_HARNESS_SMOKE_CODEX_MODEL: "gpt-5.6-sol",
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
    expect(hasFallbackDisclosure(output)).toBe(true);
    expect(evaluate({ output: `${smokeMarker(directCodex, "gpt-5.6-sol")}\n${output}` })).toMatchObject({
      status: RESULTS.FAIL,
      reason: expect.stringContaining("forbidden fallback"),
    });
  });

  it("keeps provider identity separate from exact Cursor model identity", async () => {
    await expect(validateCursorProviderFamily("grok", "cursor-grok-4.6-high")).resolves.toBe("grok");
    await expect(validateCursorProviderFamily("grok", "gpt-5.6-sol-high")).rejects.toThrow(
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
        ASK_LLM_HARNESS_SMOKE_CURSOR_HOST_MODEL: "gpt-5.6-sol-high",
        ASK_LLM_HARNESS_SMOKE_CURSOR_GROK_MODEL: "gpt-5.6-sol-high",
        ASK_LLM_HARNESS_SMOKE_CURSOR_CODEX_MODEL: "gpt-5.6-sol-high",
      },
      scenarios: [cursorBrainstorm],
      discovery: {
        agent: {
          available: true,
          catalogAuthorized: true,
          catalog: ["gpt-5.6-sol-high"],
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
    [{ args: ["exec", "--model", "gpt-5.6-sol", "--sandbox", "WORKSPACE-WRITE"] }, /mutation\/trust flag/],
    [{ args: ["--model", "gpt-5.6-sol", "--trust"] }, /mutation\/trust flag/],
  ])("fails closed for %j", (overrides, reason) => {
    expect(evaluate(overrides)).toMatchObject({ status: RESULTS.FAIL, reason: expect.stringMatching(reason) });
  });
});

describe("exact live skill prompts", () => {
  it("pins both brainstorm participants and explicit consent", () => {
    invariant(cursorBrainstorm, "Cursor brainstorm scenario missing");
    const prompt = buildLivePrompt(cursorBrainstorm, {
      model: "cursor-grok-4.6-high",
      secondaryModel: "gpt-5.6-sol-high",
    });
    expect(prompt).toContain("/brainstorm grok@cursor-agent:cursor-grok-4.6-high,codex@cursor-agent:gpt-5.6-sol-high");
    expect(prompt).toContain("consent=confirmed");
  });

  it.each([
    ["cursor-agent:/codex-pair", "/codex-pair model=gpt-5.6-sol effort=high", "gpt-5.6-sol"],
    ["claude:/grok-pair", "/grok-pair route=grok-cli model=grok-build effort=high", "grok-build"],
  ])("pins route/model/effort/consent for %s", (id, expected, model) => {
    const scenario = SCENARIOS.find((entry) => entry.id === id);
    invariant(scenario, `scenario ${id} missing`);
    const prompt = buildLivePrompt(scenario, { model, effort: "high" });
    expect(prompt).toContain(expected);
    expect(prompt).toContain("consent=confirmed");
    expect(prompt).toContain(`provider=${scenario.provider}`);
  });
});

describe("authorization and availability accounting", () => {
  it("reports installed but unauthorized live surfaces distinctly", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const report = await runIsolatedSuite({
      mode: "live",
      env: { ...process.env, ASK_LLM_HARNESS_SMOKE_AUTHORIZED: "" },
      scenarios: [directCodex],
      discovery: { codex: { available: true, catalogAuthorized: true, catalog: ["gpt-5.6-sol"] } },
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
      reason: expect.stringContaining("deliberately excludes"),
    });
    expect(report.results.some(({ status }) => status === RESULTS.FAIL)).toBe(false);
  });
});

describe("mutation, timeout, privacy, and cleanup", () => {
  it("detects content mutation of an already-present untracked workspace file", async () => {
    invariant(directCodex, "direct Codex scenario missing");
    const report = await runIsolatedSuite({
      mode: "dry-run",
      scenarios: [directCodex],
      deterministicAdapter: async ({ workspace, ...context }) => {
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
