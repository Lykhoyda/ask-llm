import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ERROR_MESSAGES, MODELS } from "../constants.js";
import { executeAntigravityCLI } from "../utils/antigravityExecutor.js";

// Envelopes and stderr live-captured from agy 1.2.12 unless noted.
const envelope = (response: string, usage: Record<string, number>) =>
  JSON.stringify({
    conversation_id: "f8e88b1f-6678-46ab-84df-c0beff2e1347",
    status: "SUCCESS",
    response,
    duration_seconds: 0,
    num_turns: 1,
    usage,
  });
const ZERO_USAGE = { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 };
const PONG_USAGE = {
  input_tokens: 15734,
  output_tokens: 375,
  thinking_tokens: 374,
  cache_read_tokens: 0,
  total_tokens: 16109,
};
const PLAN_WARNING = "warning: --mode plan has no effect while slash command expansion is disabled.\n";
const TIMEOUT_NOTE = "[agy] print timeout after 30s with turn in progress; returning partial output\n";
const PARTIAL = "By the year 1500, it is estimated";
// agy >=1.2.6 exits 3 with this stderr line; keys are from the agy 1.2.12 binary, not a live failure.
const agyError = (payload: Record<string, unknown>) => `AGY_ERROR: ${JSON.stringify(payload)}\n`;
const STARTUP_WARNINGS = [
  "warning: settings.json uses the deprecated `unsandboxed` permission.",
  "  affected file: ~/.agy/settings.json",
  "  offending rule: terminal.unsandboxed",
  "  replace it with the sandbox allowlist; see agy help permissions",
].join("\n");
const errorEnvelope = (error: string) =>
  JSON.stringify({ conversation_id: "", status: "ERROR", response: "", error, num_turns: 1, usage: ZERO_USAGE });

type Scenario = { stdout: string; stderr: string; exit?: number };

describe("fake agy 1.2.12", { timeout: 30_000 }, () => {
  let dir: string;
  let previousPath: string | undefined;

  const writeScenario = (name: string, { stdout, stderr, exit = 0 }: Scenario) => {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, "stdout.txt"), stdout);
    writeFileSync(join(dir, name, "stderr.txt"), stderr);
    writeFileSync(join(dir, name, "exit.txt"), String(exit));
  };
  const installFakeAgy = (primary: Scenario, fallback: Scenario = primary, quota?: Scenario) => {
    writeScenario("primary", primary);
    writeScenario("fallback", fallback);
    writeScenario("quota", quota ?? { stdout: "", stderr: "unexpected /quota call", exit: 1 });
  };

  // One executable for the file: macOS can stall seconds scanning each newly written binary.
  beforeAll(() => {
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", "1");
    previousPath = process.env.PATH;
    dir = mkdtempSync(join(tmpdir(), "fake-agy-"));
    const script = [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo 1.2.12; exit 0; fi',
      `d='${join(dir, "primary")}'`,
      `for a; do case "$a" in ${MODELS.FALLBACK}) d='${join(dir, "fallback")}';; /quota) d='${join(dir, "quota")}';; esac; done`,
      'cat "$d/stderr.txt" >&2',
      'cat "$d/stdout.txt"',
      'exit "$(cat "$d/exit.txt")"',
    ].join("\n");
    writeFileSync(join(dir, "agy"), `${script}\n`);
    chmodSync(join(dir, "agy"), 0o755);
    vi.stubEnv("ASK_LLM_PATH", `${dir}:${previousPath ?? ""}`);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });
  });

  describe("print-timeout expiry (#325)", () => {
    it("fails closed instead of serving the exit-0 partial answer as complete", async () => {
      installFakeAgy({ stdout: envelope(PARTIAL, ZERO_USAGE), stderr: PLAN_WARNING + TIMEOUT_NOTE });
      const error = await executeAntigravityCLI({ prompt: "q", readOnly: true }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(ERROR_MESSAGES.TRUNCATED);
      expect((error as Error).message).toContain(PARTIAL);
    });

    it("reports truncation rather than NO_OUTPUT when the timeout left an empty response", async () => {
      installFakeAgy({ stdout: envelope("", ZERO_USAGE), stderr: PLAN_WARNING + TIMEOUT_NOTE });
      await expect(executeAntigravityCLI({ prompt: "q", readOnly: true })).rejects.toThrow(ERROR_MESSAGES.TRUNCATED);
    });

    it("still serves a complete answer whose stderr carries only the benign plan warning", async () => {
      installFakeAgy({ stdout: envelope("pong\n", PONG_USAGE), stderr: PLAN_WARNING });
      const result = await executeAntigravityCLI({ prompt: "q", readOnly: true });
      expect(result.response).toBe("pong");
    });
  });

  describe("structured AGY_ERROR stderr (#335)", () => {
    const rateLimited = agyError({
      status: "RATE_LIMITED",
      http_status: 429,
      retryable: true,
      error_id: "e-1",
      short_error: "Too many requests",
    });

    it("falls back to Flash when a 429 AGY_ERROR follows multi-line startup warnings", async () => {
      installFakeAgy(
        { stdout: errorEnvelope("Too many requests"), stderr: `${STARTUP_WARNINGS}\n${rateLimited}`, exit: 3 },
        { stdout: envelope("flash answer\n", PONG_USAGE), stderr: "" },
      );
      const result = await executeAntigravityCLI({ prompt: "q" });
      expect(result.response).toBe("flash answer");
      expect(result.model).toBe(MODELS.FALLBACK);
    });

    it("surfaces a non-quota AGY_ERROR without falling back", async () => {
      const internal = agyError({ status: "INTERNAL", http_status: 500, retryable: false, error_id: "e-2" });
      installFakeAgy(
        { stdout: errorEnvelope("internal"), stderr: `${STARTUP_WARNINGS}\n${internal}`, exit: 3 },
        { stdout: envelope("must not be used\n", PONG_USAGE), stderr: "" },
      );
      const error = await executeAntigravityCLI({ prompt: "q" }).catch((err: unknown) => err);
      expect((error as Error).message).toContain('"status":"INTERNAL"');
      expect((error as Error).message).not.toContain("must not be used");
    });
  });

  describe("rate-limit quota diagnostics (#268)", () => {
    const rateLimited = {
      stdout: errorEnvelope("Too many requests"),
      stderr: agyError({ status: "RESOURCE_EXHAUSTED", http_status: 429, retryable: true }),
      exit: 3,
    };
    // Live-captured `agy -p /quota --output-format json` response on agy 1.2.12 (command.data omitted).
    const quota = {
      stdout: JSON.stringify({
        conversation_id: "",
        status: "SUCCESS",
        response:
          "Gemini Models\tWeekly Limit Remaining\t100%\t2026-09-29T12:23:29Z\n" +
          "Gemini Models\tFive Hour Limit Remaining\t0%\t2026-09-27T20:10:40Z\n",
        duration_seconds: 0,
        num_turns: 0,
        usage: ZERO_USAGE,
      }),
      stderr: "",
    };

    it("appends agy's live quota and reset times when primary and Flash are both rate limited", async () => {
      installFakeAgy(rateLimited, rateLimited, quota);
      const error = await executeAntigravityCLI({ prompt: "q" }).catch((err: unknown) => err);
      expect((error as Error).message.startsWith(ERROR_MESSAGES.RATE_LIMITED)).toBe(true);
      expect((error as Error).message).toContain(
        "Gemini Models Five Hour Limit Remaining: 0% (resets 2026-09-27T20:10:40Z)",
      );
    });

    it("keeps the plain rate-limit message when the quota probe fails", async () => {
      installFakeAgy(rateLimited, rateLimited);
      await expect(executeAntigravityCLI({ prompt: "q" })).rejects.toThrow(ERROR_MESSAGES.RATE_LIMITED);
    });
  });
});
