import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./harness-smoke-lib.ts";

const ENTRY = fileURLToPath(new URL("./antigravity-smoke.ts", import.meta.url));
const ARGS = ["--model", "gemini-4-neon", "--effort", "medium", "--confirm-included-only"];
const PRIVATE_TEXT = "private-test-text.example/contact";
const SUCCESS = { status: "SUCCESS", response: "OK\n", num_turns: 1, conversation_id: PRIVATE_TEXT };

describe("local included-quota Antigravity smoke", () => {
  let root: string;
  let repo: string;
  let bin: string;
  let temp: string;
  let log: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "ask-llm-agy-smoke-test-"));
    repo = join(root, "repo");
    bin = join(root, "bin");
    temp = join(root, "scratch-parent");
    log = join(root, "invocations");
    await Promise.all([mkdir(repo), mkdir(bin), mkdir(temp), writeFile(log, "")]);
    const gitEnv = { PATH: "/usr/bin:/bin", HOME: root };
    execFileSync("git", ["init", "-q"], { cwd: repo, env: gitEnv });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture", "--allow-empty"],
      {
        cwd: repo,
        env: gitEnv,
      },
    );
    const fake = `#!${process.execPath}
const { appendFileSync, writeFileSync } = require("node:fs");
const { basename, join } = require("node:path");
const argv = process.argv.slice(2);
const tool = basename(process.argv[1]);
appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool, argv, cwd: process.cwd() }) + "\\n");
if (tool !== "agy") process.exit(99);
if (argv[0] === "--version") {
  process.stdout.write(process.env.FAKE_VERSION);
  process.stderr.write(process.env.FAKE_VERSION_STDERR || "");
} else {
  if (process.env.FAKE_MUTATE_SCRATCH) writeFileSync("unexpected", "write");
  if (process.env.FAKE_MUTATE_REPO) writeFileSync(join(process.env.FAKE_REPO, process.env.FAKE_MUTATE_REPO), "updated");
  process.stdout.write(process.env.FAKE_STDOUT);
  process.stderr.write(process.env.FAKE_STDERR || "");
  if (process.env.FAKE_HANG) setInterval(() => {}, 1000);
  process.exitCode = Number(process.env.FAKE_EXIT || "0");
}
`;
    await Promise.all(
      ["agy", "gemini", "codex", "claude", "ollama", "grok", "agent", "pi"].map((tool) =>
        writeFile(join(bin, tool), fake, { mode: 0o755 }),
      ),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function smoke(overrides: NodeJS.ProcessEnv = {}, args = ARGS, nodeArgs: string[] = []) {
    const env = {
      HOME: root,
      TMPDIR: temp,
      PATH: `${bin}:/usr/bin:/bin`,
      ASK_LLM_PATH: bin,
      GMCPT_LOG_LEVEL: "debug",
      ASK_LLM_HARNESS_SMOKE_LIVE: "1",
      ASK_LLM_HARNESS_SMOKE_AUTHORIZED: "mcp:antigravity-included",
      ASK_ANTIGRAVITY_ALLOW_UNISOLATED: "1",
      ASK_ANTIGRAVITY_SANDBOX: "0",
      ASK_ANTIGRAVITY_MODEL: "gemini-4-hydrogen",
      ASK_ANTIGRAVITY_EFFORT: "low",
      FAKE_LOG: log,
      FAKE_REPO: repo,
      FAKE_VERSION: "1.5.9\n",
      FAKE_STDOUT: JSON.stringify(SUCCESS),
      ...overrides,
    };
    const result = await runCommand(process.execPath, [...nodeArgs, ENTRY, ...args], {
      cwd: repo,
      env,
      timeoutMs: 15_000,
    });
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(PRIVATE_TEXT);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    const report = JSON.parse(result.stdout);
    expect(
      Object.keys(report).every((key) => ["status", "reason", "model", "effort", "agyVersion"].includes(key)),
    ).toBe(true);
    const records = (await readFile(log, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line): { tool: string; argv: string[]; cwd: string } => JSON.parse(line));
    expect(records.every(({ tool }) => tool === "agy")).toBe(true);
    return { report, exitCode: result.exitCode, records };
  }

  it("calls the pinned model once through MCP with just the read-only argv and cleans up", async () => {
    const { report, exitCode, records } = await smoke();
    expect(exitCode).toBe(0);
    expect(report).toMatchObject({ status: "PASS", model: "gemini-4-neon", effort: "medium", agyVersion: "1.5.9" });
    expect(report.reason).toContain("Funding user-attested. Served model identity unverified.");
    expect(records.map(({ argv }) => argv)).toEqual([
      ["--version"],
      [
        "-p",
        expect.stringMatching(/\n\nReply with exactly OK\. Do not use tools\.$/),
        "--model",
        "gemini-4-neon",
        "--effort",
        "medium",
        "--print-timeout",
        "295s",
        "--output-format",
        "json",
        "--disable-slash-commands",
        "--sandbox",
        "--settings",
        '{"agentMode":"","permissions":{"deny":["write_file(*)","command(*)"]}}',
      ],
    ]);
    expect(records[0].cwd).toBe(records[1].cwd);
    expect(records[1].cwd).toContain("/scratch-parent/ask-llm-agy-smoke-");
    expect(await readdir(temp)).toEqual([]);
  });

  it.each([
    { ASK_LLM_HARNESS_SMOKE_LIVE: undefined },
    { ASK_LLM_HARNESS_SMOKE_AUTHORIZED: "all" },
    { ASK_LLM_HARNESS_SMOKE_AUTHORIZED: "mcp:antigravity-included,other" },
    { ASK_ANTIGRAVITY_ALLOW_UNISOLATED: "true" },
    { GEMINI_API_KEY: PRIVATE_TEXT },
    { AGY_ADC_AUTH: "" },
    { GOOGLE_CLOUD_QUOTA_PROJECT: PRIVATE_TEXT },
  ])("skips before spawning even a version probe with missing consent or a conflicting environment", async (env) => {
    const { report, exitCode, records } = await smoke(env);
    expect({ status: report.status, exitCode, records }).toEqual({
      status: "SKIP_NOT_AUTHORIZED",
      exitCode: 2,
      records: [],
    });
  });

  it.each([
    ARGS.slice(0, -1),
    ["--model", "auto", ...ARGS.slice(2)],
    ["--model", "gemini-4-neon-high", ...ARGS.slice(2)],
    ["--model", PRIVATE_TEXT, ...ARGS.slice(2)],
    ["--effort", "medium", "--confirm-included-only"],
    ["--model", "gemini-4-neon", "--confirm-included-only"],
    ["--model", "gemini-4-neon", "--effort", "MEDIUM", "--confirm-included-only"],
    [...ARGS, "--model", "gemini-4-hydrogen"],
    [...ARGS, "--", PRIVATE_TEXT],
  ])("skips invalid or unattested tuples before starting agy", async (...args) => {
    const { report, exitCode, records } = await smoke({}, args);
    expect({ status: report.status, exitCode, records }).toEqual({
      status: "SKIP_NOT_AUTHORIZED",
      exitCode: 2,
      records: [],
    });
  });

  it("skips a missing agy with no probe or model call", async () => {
    await rm(join(bin, "agy"));
    const { report, exitCode, records } = await smoke({ PATH: bin });
    expect({ status: report.status, exitCode, records }).toEqual({
      status: "SKIP_UNAVAILABLE",
      exitCode: 2,
      records: [],
    });
  });

  it.each(["1.5.8", PRIVATE_TEXT, `1.5.9 ${PRIVATE_TEXT}`])(
    "skips unsupported and unparseable versions before the model call",
    async (version) => {
      const { report, exitCode, records } = await smoke({ FAKE_VERSION: version });
      expect({ status: report.status, exitCode, argv: records.map(({ argv }) => argv) }).toEqual({
        status: "SKIP_UNAVAILABLE",
        exitCode: 2,
        argv: [["--version"]],
      });
      expect(await readdir(temp)).toEqual([]);
    },
  );

  it("skips when agy discloses conflicting funding before dispatch", async () => {
    const { report, exitCode, records } = await smoke({ FAKE_VERSION_STDERR: `AI credits enabled: ${PRIVATE_TEXT}` });
    expect({ status: report.status, exitCode, argv: records.map(({ argv }) => argv) }).toEqual({
      status: "SKIP_NOT_AUTHORIZED",
      exitCode: 2,
      argv: [["--version"]],
    });
  });

  it.each([
    [
      "quota",
      {
        FAKE_EXIT: "3",
        FAKE_STDERR: `AGY_ERROR: {"http_status":429,"short_error":"quota exhausted","error_id":"${PRIVATE_TEXT}"}`,
      },
    ],
    ["refusal", { FAKE_EXIT: "3", FAKE_STDERR: `permission denied ${PRIVATE_TEXT}` }],
    ["model rejection", { FAKE_EXIT: "1", FAKE_STDERR: "invalid model selection" }],
    ["process timeout", { FAKE_HANG: "1", ASK_ANTIGRAVITY_TIMEOUT_MS: "500" }],
    ["print timeout", { FAKE_STDERR: `[agy] print timeout: ${PRIVATE_TEXT}` }],
    ["plain stdout", { FAKE_STDOUT: "OK" }],
    ["truncated JSON", { FAKE_STDOUT: '{"response":"OK"' }],
    ...[
      { status: "ERROR" },
      { response: "OK " },
      { num_turns: 0 },
      { num_turns: undefined },
      { num_turns: 1.5 },
      { num_turns: "1" },
      { finished_reason: "interrupted" },
      { truncated: true },
      { denied_actions: [PRIVATE_TEXT] },
      { usage: { fellBack: true } },
    ].map((fields) => [JSON.stringify(fields), { FAKE_STDOUT: JSON.stringify({ ...SUCCESS, ...fields }) }] as const),
  ] as const)(
    "fails %s with one attempt and no quota prompt or fallback",
    async (_label, env) => {
      const { report, exitCode, records } = await smoke(env);
      expect({ status: report.status, exitCode }).toEqual({ status: "FAIL", exitCode: 1 });
      expect(records.map(({ argv }) => argv[0])).toEqual(["--version", "-p"]);
      expect(await readdir(temp)).toEqual([]);
    },
    20_000,
  );

  it.each([{ FAKE_MUTATE_SCRATCH: "1" }, { FAKE_MUTATE_REPO: "ignored-local-file" }])(
    "fails and cleans scratch when either workspace changes",
    async (env) => {
      await writeFile(join(repo, ".gitignore"), "ignored-local-file\n");
      await writeFile(join(repo, "ignored-local-file"), "before!");
      const { report, exitCode, records } = await smoke(env);
      expect({ status: report.status, reason: report.reason, exitCode }).toEqual({
        status: "FAIL",
        reason: "Scratch workspace or repository changed",
        exitCode: 1,
      });
      expect(records.map(({ argv }) => argv[0])).toEqual(["--version", "-p"]);
      expect(await readdir(temp)).toEqual([]);
    },
  );

  it("reports cleanup failure without exposing exceptions or process output", async () => {
    const preload = join(root, "cleanup-failure.mjs");
    await writeFile(
      preload,
      `import { createRequire, syncBuiltinESMExports } from "node:module";
const fs = createRequire(import.meta.url)("node:fs/promises");
fs.rm = async () => { throw new Error(${JSON.stringify(PRIVATE_TEXT)}); };
syncBuiltinESMExports();`,
    );
    const { report, exitCode, records } = await smoke({}, ARGS, ["--import", preload]);
    expect({ status: report.status, reason: report.reason, exitCode }).toEqual({
      status: "FAIL",
      reason: "Scratch cleanup failed",
      exitCode: 1,
    });
    expect(records.map(({ argv }) => argv[0])).toEqual(["--version", "-p"]);
  });
});
