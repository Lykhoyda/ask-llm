import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineFailureResultSchema } from "@ask-llm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executeCursorAgent, listCursorModels } from "../cursorAgent.js";
import { runMachineRequest } from "../machine.js";

// Captured from Cursor Agent 2026.09.26-dd393fe with a refused loopback API endpoint.
const BACKEND_STARTUP_FAILURE = "Failed to load models: [unavailable] connect ECONNREFUSED 127.0.0.1:54321";

describe("fake Cursor Agent exit", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "fake-cursor-agent-"));
    // Same agent transport seam used by the deterministic harness smoke adapter.
    writeFileSync(
      join(dir, "agent"),
      [
        "#!/bin/sh",
        `echo invocation >> '${join(dir, "invocations.txt")}'`,
        `cat '${join(dir, "stdout.txt")}'`,
        `cat '${join(dir, "stderr.txt")}' >&2`,
        `exit "$(cat '${join(dir, "exit.txt")}')"`,
        "",
      ].join("\n"),
      { mode: 0o700 },
    );
    vi.stubEnv("ASK_LLM_PATH", `${dir}:${process.env.PATH ?? ""}`);
  });

  beforeEach(() => {
    writeFileSync(join(dir, "invocations.txt"), "");
    writeFileSync(join(dir, "stdout.txt"), "");
    writeFileSync(join(dir, "stderr.txt"), BACKEND_STARTUP_FAILURE);
    writeFileSync(join(dir, "exit.txt"), "1");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports proven backend startup connection refusal as environment unavailability without retry", async () => {
    const message = await executeCursorAgent({ provider: "codex", model: "gpt-6-sol-high", prompt: "review" }).catch(
      (error: Error) => error.message,
    );
    expect(message).toMatch(/^Cursor Agent backend is unreachable during startup\./);
    expect(message).toMatch(/endpoint.*network.*proxy/i);
    expect(message).toContain("No fallback was attempted.");
    expect(message).not.toMatch(/safety refusal|no (?:model )?request/i);
    expect(readFileSync(join(dir, "invocations.txt"), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("normalizes the captured catalog-discovery exit through the same classifier", async () => {
    await expect(listCursorModels()).rejects.toThrow(/^Cursor Agent backend is unreachable during startup\./);
  });

  it("still serves a successful exact-model response without fallback", async () => {
    writeFileSync(join(dir, "exit.txt"), "0");
    writeFileSync(join(dir, "stderr.txt"), "");
    writeFileSync(
      join(dir, "stdout.txt"),
      JSON.stringify({ type: "result", subtype: "success", result: "Successful review" }),
    );
    const result = await executeCursorAgent({ provider: "codex", model: "gpt-6-sol-high", prompt: "review" });
    expect(result).toMatchObject({
      response: expect.stringContaining("Successful review"),
      provider: "codex",
      model: "gpt-6-sol-high",
      harness: "cursor-agent",
      usage: { fellBack: false },
    });
  });

  it.each([
    ["", "unavailable"],
    ["401 unauthorized", "auth_failed"],
    ["429 quota exceeded", "rate_limited"],
    ["unknown model selected", "unavailable"],
    ["request refused by content policy", "unavailable"],
  ])("preserves machine failure classification with mixed detail %s", async (mixed, kind) => {
    writeFileSync(join(dir, "stderr.txt"), `${BACKEND_STARTUP_FAILURE}\n${mixed}`);
    const result = await runMachineRequest(
      {
        schemaVersion: 1,
        requestId: "cursor-startup-review",
        role: "review",
        provider: "codex",
        writerProvider: "claude",
        model: "gpt-6-sol-high",
        prompt: "review",
        readOnly: true,
      },
      {
        loadExecutor: () => (options) =>
          executeCursorAgent({ provider: "codex", model: options.model ?? "gpt-6-sol-high", prompt: options.prompt }),
        now: Date.now,
        env: {},
      },
    );
    expect(result).toMatchObject({
      status: "failed",
      actualModel: null,
      payload: null,
      failure: { kind },
      fallback: { occurred: false, requestedModel: null, actualModel: null },
    });
    expect(machineFailureResultSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|no (?:model )?request/i);
    expect(readFileSync(join(dir, "invocations.txt"), "utf8").trim().split("\n")).toHaveLength(1);
  });
});
