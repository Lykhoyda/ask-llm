import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ERROR_MESSAGES } from "../constants.js";
import { executeAntigravityCLI } from "../utils/antigravityExecutor.js";

// Envelopes and stderr live-captured from agy 1.2.12 (issue #325).
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
const PLAN_WARNING = "warning: --mode plan has no effect while slash command expansion is disabled.\n";
const TIMEOUT_NOTE = "[agy] print timeout after 30s with turn in progress; returning partial output\n";
const PARTIAL = "By the year 1500, it is estimated";

describe("fake agy 1.2.12 print-timeout expiry", { timeout: 30_000 }, () => {
  let dir: string;
  let previousPath: string | undefined;

  const installFakeAgy = (stdout: string, stderr: string) => {
    writeFileSync(join(dir, "stdout.txt"), stdout);
    writeFileSync(join(dir, "stderr.txt"), stderr);
  };

  // One executable for the file: macOS can stall seconds scanning each newly written binary.
  beforeAll(() => {
    previousPath = process.env.PATH;
    dir = mkdtempSync(join(tmpdir(), "fake-agy-"));
    const script = [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then echo 1.2.12; exit 0; fi',
      `cat '${join(dir, "stderr.txt")}' >&2`,
      `cat '${join(dir, "stdout.txt")}'`,
      "exit 0",
    ].join("\n");
    writeFileSync(join(dir, "agy"), `${script}\n`);
    chmodSync(join(dir, "agy"), 0o755);
    process.env.PATH = `${dir}:${previousPath ?? ""}`;
  });

  afterAll(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed instead of serving the exit-0 partial answer as complete", async () => {
    installFakeAgy(envelope(PARTIAL, ZERO_USAGE), PLAN_WARNING + TIMEOUT_NOTE);
    const error = await executeAntigravityCLI({ prompt: "q", readOnly: true }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(ERROR_MESSAGES.TRUNCATED);
    expect((error as Error).message).toContain(PARTIAL);
  });

  it("reports truncation rather than NO_OUTPUT when the timeout left an empty response", async () => {
    installFakeAgy(envelope("", ZERO_USAGE), PLAN_WARNING + TIMEOUT_NOTE);
    await expect(executeAntigravityCLI({ prompt: "q", readOnly: true })).rejects.toThrow(ERROR_MESSAGES.TRUNCATED);
  });

  it("still serves a complete answer whose stderr carries only the benign plan warning", async () => {
    const usage = { input_tokens: 15734, output_tokens: 375, thinking_tokens: 374, cache_read_tokens: 0 };
    installFakeAgy(envelope("pong\n", { ...usage, total_tokens: 16109 }), PLAN_WARNING);
    const result = await executeAntigravityCLI({ prompt: "q", readOnly: true });
    expect(result.response).toBe("pong");
  });
});
