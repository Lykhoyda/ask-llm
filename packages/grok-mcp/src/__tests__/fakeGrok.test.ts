import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ERROR_MESSAGES } from "../constants.js";
import { executeGrokCLI } from "../utils/grokCliExecutor.js";

// A read-only sandbox whose backend socket is unreachable fails before any model turn.
const SANDBOX_STARTUP_FAILURE =
  "Error: failed to start read-only sandbox: dial unix /var/run/docker.sock: connect: connection refused\n";
const SAFETY_REFUSAL = "Error: request refused by content policy\n";

describe("fake grok CLI exit", { timeout: 30_000 }, () => {
  let dir: string;

  const install = (stderr: string, exit: number) => {
    writeFileSync(join(dir, "stderr.txt"), stderr);
    writeFileSync(join(dir, "exit.txt"), String(exit));
  };

  beforeAll(() => {
    vi.stubEnv("ASK_GROK_MODEL", undefined);
    vi.stubEnv("ASK_GROK_REASONING_EFFORT", undefined);
    vi.stubEnv("ASK_GROK_TIMEOUT_MS", undefined);
    dir = mkdtempSync(join(tmpdir(), "fake-grok-"));
    const script = ["#!/bin/sh", `cat '${join(dir, "stderr.txt")}' >&2`, `exit "$(cat '${join(dir, "exit.txt")}')"`];
    writeFileSync(join(dir, "grok"), `${script.join("\n")}\n`);
    chmodSync(join(dir, "grok"), 0o755);
    vi.stubEnv("ASK_LLM_PATH", `${dir}:${process.env.PATH ?? ""}`);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports a read-only sandbox that cannot start as a harness environment failure, not a safety refusal", async () => {
    install(SANDBOX_STARTUP_FAILURE, 1);
    const message = await executeGrokCLI({ prompt: "review" }).catch((error: Error) => error.message);
    expect(message).not.toContain(ERROR_MESSAGES.SAFETY_REFUSAL);
    expect(message).toMatch(/^Grok CLI harness failed: the read-only sandbox could not start/);
    expect(message).toContain("docker.sock: connect: connection refused");
    expect(message).toMatch(/No fallback was attempted\.$/);
  });

  it("still reports a genuine content-policy refusal as a safety refusal", async () => {
    install(SAFETY_REFUSAL, 1);
    await expect(executeGrokCLI({ prompt: "review" })).rejects.toThrow(ERROR_MESSAGES.SAFETY_REFUSAL);
  });
});
