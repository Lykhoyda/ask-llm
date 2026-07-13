import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { machineJsonSchemaBundle } from "../machine.js";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const requestPath = fileURLToPath(new URL("./fixtures/review-request.json", import.meta.url));
const successPayloadPath = fileURLToPath(new URL("./fixtures/review-success.json", import.meta.url));
const successExecutorPath = fileURLToPath(new URL("./fixtures/machine-success-executor.mjs", import.meta.url));
const largeSuccessExecutorPath = fileURLToPath(
  new URL("./fixtures/machine-large-success-executor.mjs", import.meta.url),
);
const failureExecutorPath = fileURLToPath(new URL("./fixtures/machine-failure-executor.mjs", import.meta.url));

const request = JSON.parse(readFileSync(requestPath, "utf8")) as Record<string, unknown>;
const successPayload = JSON.parse(readFileSync(successPayloadPath, "utf8"));
const temporaryFiles: string[] = [];

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface ClosedStdoutCliResult {
  status: number | null;
  stdoutBytesBeforeClose: number;
  stderr: string;
}

function markerPath(): string {
  const path = join(tmpdir(), `ask-llm-machine-${randomUUID()}.marker`);
  temporaryFiles.push(path);
  return path;
}

function runCli(args: string[], input = "", options: { executorPath?: string; marker?: string } = {}): CliResult {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ASK_LLM_LOG_LEVEL: "debug",
      ...(options.executorPath ? { ASK_LLM_MACHINE_EXECUTOR_MODULE: pathToFileURL(options.executorPath).href } : {}),
      ...(options.marker ? { ASK_LLM_MACHINE_FIXTURE_LOAD_MARKER: options.marker } : {}),
    },
    input,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 5_000,
  });

  expect(result.error).toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function runCliWithClosedStdout(input: string, executorPath: string): Promise<ClosedStdoutCliResult> {
  const child = spawn(process.execPath, [cliPath, "machine"], {
    env: {
      ...process.env,
      ASK_LLM_LOG_LEVEL: "debug",
      ASK_LLM_MACHINE_EXECUTOR_MODULE: pathToFileURL(executorPath).href,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let stdoutBytesBeforeClose = 0;

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.once("data", (chunk: Buffer) => {
    stdoutBytesBeforeClose = chunk.byteLength;
    child.stdout.destroy();
  });
  child.stdin.end(input);

  const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
  const [status] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
  clearTimeout(timeout);

  return { status, stdoutBytesBeforeClose, stderr };
}

afterEach(() => {
  for (const file of temporaryFiles.splice(0)) rmSync(file, { force: true });
});

describe("ask-llm-mcp machine", () => {
  it("writes exactly one typed success document for one stdin request", () => {
    const result = runCli(["machine"], JSON.stringify(request), { executorPath: successExecutorPath });
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify(output)}\n`);
    expect(output).toMatchObject({
      schemaVersion: 1,
      requestId: request.requestId,
      status: "success",
      role: "review",
      provider: "codex",
      actualModel: "gpt-fixture",
      payload: successPayload,
      usage: { inputTokens: 21, outputTokens: 13, totalTokens: 34 },
      fallback: { occurred: false, requestedModel: "gpt-fixture", actualModel: "gpt-fixture" },
      session: { sessionId: "thread-fixture-001", transcriptPath: null },
      quotaSignal: { kind: "runtime_proxy_required" },
      failure: null,
    });
    expect(result.stderr).toContain("fixture executor dispatched");
  });

  it("returns a typed provider failure document with exit 0", () => {
    const result = runCli(["machine"], JSON.stringify(request), { executorPath: failureExecutorPath });
    const output = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify(output)}\n`);
    expect(output).toMatchObject({
      schemaVersion: 1,
      requestId: request.requestId,
      status: "failed",
      role: "review",
      provider: "codex",
      payload: null,
      failure: {
        kind: "rate_limited",
        message: "Provider rate limit or quota was reached",
      },
    });
    expect(result.stdout).not.toContain("fixture-secret");
    expect(result.stderr).toContain("fixture provider reported a quota failure");
  });

  it("flushes one complete result when stdout applies backpressure", () => {
    const result = runCli(["machine"], JSON.stringify(request), { executorPath: largeSuccessExecutorPath });
    const output = JSON.parse(result.stdout);
    const evidence = output.payload.findings[0].evidence as string;

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${JSON.stringify(output)}\n`);
    expect(Buffer.byteLength(evidence)).toBeGreaterThan(2 * 1024 * 1024);
    expect(evidence.startsWith("begin-")).toBe(true);
    expect(evidence.endsWith("-end")).toBe(true);
  });

  it("reports a closed output pipe as a generic infrastructure failure", async () => {
    const result = await runCliWithClosedStdout(JSON.stringify(request), largeSuccessExecutorPath);

    expect(result.stdoutBytesBeforeClose).toBeGreaterThan(0);
    expect(result.stderr).toBe("machine dispatcher failed\n");
    expect(result.status).toBe(3);
  });

  it("rejects malformed and concatenated JSON with exit 2 and empty stdout", () => {
    for (const input of ["{", `${JSON.stringify(request)}${JSON.stringify(request)}`]) {
      const result = runCli(["machine"], input, { executorPath: successExecutorPath });

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("machine input rejected");
    }
  });

  it("rejects schema-invalid input with exit 2 before loading a provider", () => {
    const marker = markerPath();
    const result = runCli(["machine"], JSON.stringify({ ...request, readOnly: false }), {
      executorPath: successExecutorPath,
      marker,
    });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("machine input rejected");
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects more than 150 KiB before loading a provider", () => {
    const marker = markerPath();
    const oversized = JSON.stringify({ ...request, prompt: "x".repeat(150 * 1024) });
    const result = runCli(["machine"], oversized, { executorPath: successExecutorPath, marker });

    expect(Buffer.byteLength(oversized)).toBeGreaterThan(150 * 1024);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("machine input rejected");
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects argv prompt input without echoing it", () => {
    const argvPrompt = JSON.stringify({ ...request, prompt: "private issue content must stay off argv" });
    const result = runCli(["machine", argvPrompt], "", { executorPath: successExecutorPath });

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("machine input rejected");
    expect(result.stderr).not.toContain("private issue content");
  });
});

describe("ask-llm-mcp machine-schema", () => {
  it("writes the stable canonical bundle without loading a provider", () => {
    const marker = markerPath();
    const first = runCli(["machine-schema"], "", { executorPath: successExecutorPath, marker });
    const second = runCli(["machine-schema"], "", { executorPath: failureExecutorPath, marker });
    const expected = machineJsonSchemaBundle();

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout).toBe(`${JSON.stringify(expected)}\n`);
    expect(second.stdout).toBe(first.stdout);
    expect(first.stderr).toBe("");
    expect(second.stderr).toBe("");
    expect(existsSync(marker)).toBe(false);
  });
});
