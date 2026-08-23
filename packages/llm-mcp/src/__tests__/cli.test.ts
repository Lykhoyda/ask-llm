import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../../package.json", import.meta.url));
const packageVersion = (JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string }).version;

const CLI_HELP = [
  "Usage:",
  "  ask-llm-mcp                         Start the MCP server on stdio",
  "  ask-llm-mcp <command> [options]     Run a CLI command",
  "",
  "Commands:",
  "  doctor          Report provider and environment diagnostics",
  "  repl            Start the interactive multi-provider REPL",
  "  machine         Process one machine request from stdin",
  "  machine-schema  Print the machine protocol schema bundle",
  "",
  "Options:",
  "  -h, --help      Show this help",
  "  -V, --version   Show the package version",
  "",
  "Run ask-llm-mcp doctor --help for doctor options.",
  "",
].join("\n");
const UNSUPPORTED_ARGUMENT_OUTPUT = `Error: unsupported command or argument.\n\n${CLI_HELP}`;
const SERVER_START_MARKER = `@ask-llm/mcp v${packageVersion} — 6 tools`;
const EMPTY_PATH_DIR = mkdtempSync(join(tmpdir(), "ask-llm-cli-empty-path-"));
const UNREACHABLE_OLLAMA_HOST = "http://127.0.0.1:9";

afterAll(() => {
  rmSync(EMPTY_PATH_DIR, { force: true, recursive: true });
});

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], input = "", isolateProviders = false): CliResult {
  const env = { ...process.env, ASK_LLM_LOG_LEVEL: "debug" };
  if (isolateProviders) {
    env.PATH = "";
    env.ASK_LLM_PATH = EMPTY_PATH_DIR;
    env.OLLAMA_HOST = UNREACHABLE_OLLAMA_HOST;
    delete env.XAI_API_KEY;
    delete env.ASK_GROK_HARNESS;
  }

  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8",
    env,
    input,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000,
  });

  expect(result.error).toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("ask-llm-mcp root arguments", () => {
  it.each(["--help", "-h"])("prints help for %s and exits without starting the server", (argument) => {
    const result = runCli([argument]);

    expect(result).toEqual({ status: 0, stdout: CLI_HELP, stderr: "" });
    expect(result.stderr).not.toContain(SERVER_START_MARKER);
  });

  it.each([
    "--version",
    "-V",
  ])("prints the package version for %s and exits without starting the server", (argument) => {
    const result = runCli([argument]);

    expect(result).toEqual({ status: 0, stdout: `${packageVersion}\n`, stderr: "" });
    expect(result.stderr).not.toContain(SERVER_START_MARKER);
  });

  it.each([
    ["unknown"],
    ["--unknown"],
    ["--help", "extra"],
    ["machine-schema", "extra"],
    ["repl", "extra"],
  ])("rejects unsupported argv %j with usage and without starting the server", (args) => {
    const result = runCli(args);

    expect(result).toEqual({ status: 2, stdout: "", stderr: UNSUPPORTED_ARGUMENT_OUTPUT });
    expect(result.stderr).not.toContain(SERVER_START_MARKER);
  });

  it("preserves the intentional no-argument MCP server start", () => {
    const result = runCli([], "", true);

    // Closing stdin masks a long-running stdio server as a clean process exit;
    // the startup banner proves this path reached the real server boundary.
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(SERVER_START_MARKER);
  }, 20_000);
});

describe("ask-llm-mcp supported command routing", () => {
  it("keeps doctor help provider-independent", () => {
    const result = runCli(["doctor", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Usage: ask-llm-mcp doctor /);
    expect(result.stderr).toBe("");
    expect(result.stderr).not.toContain(SERVER_START_MARKER);
  });

  it("keeps doctor argument errors command-specific and server-free", () => {
    const result = runCli(["doctor", "--unknown"]);
    const error = JSON.parse(result.stderr) as { error: { code: string; hint: string } };

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(error.error).toEqual({
      code: "unknown_argument",
      message: "Unknown doctor argument",
      hint: "Run ask-llm-mcp doctor --help.",
    });
    expect(result.stderr).not.toContain(SERVER_START_MARKER);
  });

  it("keeps machine input on stdin and reports its command usage", () => {
    const result = runCli(["machine", "unexpected-argv"]);

    expect(result).toEqual({
      status: 2,
      stdout: "",
      stderr: "machine input rejected: expected one valid JSON request on stdin\nUsage: ask-llm-mcp machine\n",
    });
    expect(result.stderr).not.toContain(SERVER_START_MARKER);
  });

  it("keeps machine-schema provider-independent", () => {
    const result = runCli(["machine-schema"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ digest: expect.any(String), request: expect.any(Object) });
    expect(result.stderr).toBe("");
  });

  it("routes repl without falling through to the MCP server", () => {
    const result = runCli(["repl"], "", true);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      "Detecting providers...\n\nNo providers available. Run `npx @ask-llm/mcp doctor` for diagnostics.\n",
    );
    expect(result.stderr).not.toContain(SERVER_START_MARKER);
  }, 20_000);
});
