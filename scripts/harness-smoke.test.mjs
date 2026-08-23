import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  evaluateInvocation,
  parseCatalog,
  RESULTS,
  redact,
  runCommand,
  runHarnessSuite,
} from "./harness-smoke-lib.mjs";

const scenario = {
  id: "codex-cli:/brainstorm-route",
  host: "codex-cli",
  surface: "/brainstorm direct Codex participant",
};

function runIsolatedSuite(options) {
  return runHarnessSuite({ ...options, fingerprint: async () => "stable" });
}

function evaluate(overrides = {}) {
  return evaluateInvocation({
    scenario,
    requestedModel: "gpt-5.6-sol",
    observedModel: "gpt-5.6-sol",
    output: "ASK_LLM_SMOKE_OK host=codex-cli model=gpt-5.6-sol fallback=false",
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
});

describe("routing, attribution, and fail-closed evaluation", () => {
  it("passes an exact read-only selection with truthful selected-only attribution", () => {
    expect(evaluate()).toEqual({
      status: RESULTS.PASS,
      reason: expect.stringContaining("attribution=selected-unverified; fallback=false"),
    });
  });

  it.each([
    [{ timedOut: true }, /timed out/],
    [{ exitCode: 9 }, /nonzero/],
    [{ observedModel: "gpt-5.6-terra" }, /model mismatch/],
    [{ output: "fellBack=true" }, /forbidden fallback/],
    [{ mutated: true }, /repository changed/],
    [{ args: ["exec", "--sandbox", "read-only"] }, /model option was lost/],
    [{ args: ["exec", "--model", "gpt-5.6-sol", "--sandbox", "workspace-write"] }, /mutation\/trust flag/],
    [{ args: ["--model", "gpt-5.6-sol", "--trust"] }, /mutation\/trust flag/],
  ])("fails closed for %j", (overrides, reason) => {
    expect(evaluate(overrides)).toMatchObject({ status: RESULTS.FAIL, reason: expect.stringMatching(reason) });
  });
});

describe("authorization and availability accounting", () => {
  it("reports installed but unauthorized live surfaces distinctly", async () => {
    const report = await runIsolatedSuite({
      mode: "live",
      env: { ...process.env, ASK_LLM_HARNESS_SMOKE_AUTHORIZED: "" },
      scenarios: [{ ...scenario, tool: "codex", modelKey: "CODEX" }],
      discovery: { codex: { available: true, catalogAuthorized: true, catalog: ["gpt-5.6-sol"] } },
    });
    expect(report.results).toEqual([expect.objectContaining({ id: scenario.id, status: RESULTS.SKIP_NOT_AUTHORIZED })]);
  });

  it("reports an optional missing harness as unavailable, never PASS", async () => {
    const report = await runIsolatedSuite({
      mode: "live",
      env: {
        ...process.env,
        ASK_LLM_HARNESS_SMOKE_AUTHORIZED: "missing:/surface",
        ASK_LLM_HARNESS_SMOKE_CODEX_MODEL: "gpt-5.6-sol",
      },
      scenarios: [{ id: "missing:/surface", host: "missing", surface: "/surface", tool: "missing", modelKey: "CODEX" }],
      discovery: { missing: { available: false, reason: "missing is not installed", catalog: [] } },
    });
    expect(report.results).toEqual([
      { id: "missing:/surface", status: RESULTS.SKIP_UNAVAILABLE, reason: "missing is not installed" },
    ]);
  });

  it("reports deliberate host exclusions as unavailable in deterministic mode", async () => {
    const report = await runIsolatedSuite({ mode: "dry-run" });
    expect(report.results.find(({ id }) => id === "pi:/grok-pair")).toMatchObject({
      status: RESULTS.SKIP_UNAVAILABLE,
      reason: expect.stringContaining("deliberately excludes"),
    });
    expect(report.results.filter(({ status }) => status === RESULTS.PASS)).toHaveLength(13);
    expect(report.results.some(({ status }) => status === RESULTS.FAIL)).toBe(false);
  });
});

describe("timeout boundary", () => {
  it("terminates a wedged local command and reports the timeout", async () => {
    const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], { timeoutMs: 25 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("privacy and cleanup", () => {
  it("redacts configured credentials and key-shaped values", () => {
    const secret = "xai-secret-value-123";
    const output = redact(`Authorization ${secret} token sk-live-123456789`, { XAI_API_KEY: secret });
    expect(output).toBe("Authorization [REDACTED] token [REDACTED]");
    expect(output).not.toContain(secret);
  });

  it("removes private prompts and outputs after every suite run", async () => {
    const report = await runIsolatedSuite({
      mode: "dry-run",
      scenarios: [{ ...scenario, tool: "codex", modelKey: "CODEX" }],
    });
    await expect(access(report.tempRoot)).rejects.toThrow();
  });
});
