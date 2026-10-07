import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { machineFailureResultSchema } from "@ask-llm/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { executeCursorAgent, listCursorModels } from "../cursorAgent.js";
import { runMachineRequest } from "../machine.js";

import { CURSOR_API_STARTUP_FAILURE, CURSOR_API_STARTUP_FAILURE_ANSI } from "./fixtures/cursor-startup-failure.js";

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

  it.each([BACKEND_STARTUP_FAILURE, CURSOR_API_STARTUP_FAILURE, CURSOR_API_STARTUP_FAILURE_ANSI])(
    "reports captured startup exit as environment unavailability without retry: %s",
    async (raw) => {
      writeFileSync(join(dir, "stderr.txt"), raw);
      const message = await executeCursorAgent({ provider: "codex", model: "gpt-6-sol-high", prompt: "review" }).catch(
        (error: Error) => error.message,
      );
      expect(message).toMatch(/^Cursor Agent backend is unreachable during startup\./);
      expect(message).toMatch(/endpoint.*network.*proxy/i);
      expect(message).toContain("No fallback was attempted.");
      expect(message).not.toMatch(/safety refusal|no (?:model )?request/i);
      expect(message).not.toContain("\u001b");
      expect(readFileSync(join(dir, "invocations.txt"), "utf8").trim().split("\n")).toHaveLength(1);
    },
  );

  it.each([BACKEND_STARTUP_FAILURE, CURSOR_API_STARTUP_FAILURE, CURSOR_API_STARTUP_FAILURE_ANSI])(
    "normalizes captured catalog-discovery exit through the same classifier: %s",
    async (raw) => {
      writeFileSync(join(dir, "stderr.txt"), raw);
      await expect(listCursorModels()).rejects.toThrow(/^Cursor Agent backend is unreachable during startup\./);
    },
  );

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
    [BACKEND_STARTUP_FAILURE, "unavailable"],
    [CURSOR_API_STARTUP_FAILURE, "unavailable"],
    [CURSOR_API_STARTUP_FAILURE_ANSI, "unavailable"],
    [`${CURSOR_API_STARTUP_FAILURE_ANSI}\n401 unauthorized`, "auth_failed"],
    [`429 quota exceeded\n${CURSOR_API_STARTUP_FAILURE_ANSI}`, "rate_limited"],
    [`${BACKEND_STARTUP_FAILURE}\n401 unauthorized`, "auth_failed"],
    [`${BACKEND_STARTUP_FAILURE}\n429 quota exceeded`, "rate_limited"],
    [`${BACKEND_STARTUP_FAILURE}\nunknown model selected`, "unavailable"],
    [`${BACKEND_STARTUP_FAILURE}\nrequest refused by content policy`, "unavailable"],
  ])("preserves machine failure classification for captured detail %s", async (raw, kind) => {
    writeFileSync(join(dir, "stderr.txt"), raw);
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
    expect(JSON.stringify(result)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|\\u001b|no (?:model )?request/i);
    expect(readFileSync(join(dir, "invocations.txt"), "utf8").trim().split("\n")).toHaveLength(1);
  });
});
