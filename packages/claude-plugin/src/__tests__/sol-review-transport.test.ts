import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  ASK_CODEX_PACKAGE,
  classifySolReviewTransport,
  codexFallbackArgs,
  executeCodex,
  parseClaudeMcpList,
  readActiveMcpServers,
  runCliFallback,
  SOL_MODEL,
  TERRA_MODEL,
} from "../../scripts/sol-review-transport.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

const userScopedServers = {
  codex: { command: "npx", args: ["-y", ASK_CODEX_PACKAGE] },
};
const pluginServers = {
  "plugin:ask-llm:codex": { commandLine: `npx -y ${ASK_CODEX_PACKAGE}`, status: "✔ Connected" },
};
const connectedPluginList = "plugin:ask-llm:codex: npx -y @ask-llm/codex-mcp - ✔ Connected\n";
const disconnectedPluginList = "plugin:ask-llm:codex: npx -y @ask-llm/codex-mcp - ✘ Failed to connect - ECONNREFUSED\n";
const cliFixture = path.join(
  PLUGIN_ROOT,
  "src",
  "__tests__",
  "_fixtures",
  process.platform === "win32" ? "codex.cmd" : "codex",
);

describe("sol-review transport selection", () => {
  it("selects the authoritative ask-codex MCP tool when available", () => {
    const decision = classifySolReviewTransport({
      availableTools: ["mcp__plugin_ask-llm_codex__ask-codex"],
      mcpServers: pluginServers,
      cliPath: "/usr/local/bin/codex",
    });

    expect(decision).toMatchObject({
      state: "preferred",
      transport: "mcp",
      toolName: "mcp__plugin_ask-llm_codex__ask-codex",
      fallbackDisclosure: null,
    });
  });

  it("does not mistake sibling Codex tools for the review transport", () => {
    const decision = classifySolReviewTransport({
      availableTools: ["mcp__codex__ask-codex-edit"],
      mcpServers: userScopedServers,
      cliPath: "/usr/local/bin/codex",
    });

    expect(decision).toMatchObject({ state: "unavailable", transport: "cli", toolName: null });
  });

  it("rejects an exact leaf tool from an unrelated server", () => {
    const decision = classifySolReviewTransport({
      availableTools: ["mcp__other__ask-codex"],
      mcpServers: userScopedServers,
      cliPath: "/usr/local/bin/codex",
    });

    expect(decision).toMatchObject({ state: "unavailable", transport: "cli", toolName: null });
  });

  it("distinguishes missing registration and gives the executable registration command", () => {
    const decision = classifySolReviewTransport({
      availableTools: [],
      mcpServers: {},
      cliPath: "/usr/local/bin/codex",
    });

    expect(decision.state).toBe("missing-registration");
    expect(decision.transport).toBe("cli");
    expect(decision.remediation).toContain("claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp");
    expect(decision.fallbackDisclosure).toContain("registration is missing");
  });

  it("distinguishes an unavailable registered service from missing registration", () => {
    const decision = classifySolReviewTransport({
      availableTools: [],
      mcpServers: userScopedServers,
      cliPath: "/usr/local/bin/codex",
    });

    expect(decision.state).toBe("unavailable");
    expect(decision.transport).toBe("cli");
    expect(decision.remediation).toContain("@ask-llm/mcp doctor");
    expect(decision.fallbackDisclosure).toContain("registered, but");
  });

  it("rejects a stale tool when active inventory reports its server disconnected", () => {
    const decision = classifySolReviewTransport({
      availableTools: ["mcp__plugin_ask-llm_codex__ask-codex"],
      mcpServers: {
        "plugin:ask-llm:codex": {
          commandLine: `npx -y ${ASK_CODEX_PACKAGE}`,
          status: "✘ Failed to connect - ECONNREFUSED",
        },
      },
      cliPath: "/usr/local/bin/codex",
    });

    expect(decision).toMatchObject({ state: "unavailable", transport: "cli", toolName: null });
    expect(decision.diagnostic).toContain("active inventory reports it unavailable");
    expect(decision.fallbackDisclosure).toContain("codex exec");
    expect(decision.remediation).toContain("@ask-llm/mcp doctor");
  });

  it("routes a preferred MCP invocation failure through the disclosed CLI fallback", () => {
    const decision = classifySolReviewTransport({
      availableTools: ["mcp__plugin_ask-llm_codex__ask-codex"],
      mcpServers: pluginServers,
      cliPath: "/usr/local/bin/codex",
      mcpFailed: true,
    });

    expect(decision).toMatchObject({ state: "unavailable", transport: "cli", toolName: null });
    expect(decision.diagnostic).toContain("invocation failed");
    expect(decision.remediation).toContain("@ask-llm/mcp doctor");
  });

  it("uses the disclosed CLI fallback when MCP inventory is unavailable", () => {
    const decision = classifySolReviewTransport({
      availableTools: [],
      mcpServers: {},
      cliPath: "/usr/local/bin/codex",
      inventoryError: "configuration error",
    });

    expect(decision).toMatchObject({
      state: "inventory-unavailable",
      transport: "cli",
      toolName: null,
    });
    expect(decision.diagnostic).toContain("availability could not be determined");
    expect(decision.fallbackDisclosure).toContain("without claiming MCP registration or availability");
    expect(decision.remediation).toContain("claude mcp list");
  });

  it("blocks with an install command when neither transport is usable", () => {
    const decision = classifySolReviewTransport({
      availableTools: [],
      mcpServers: {},
      cliPath: "",
    });

    expect(decision.state).toBe("missing-registration");
    expect(decision.transport).toBeNull();
    expect(decision.remediation).toContain("npm install -g @openai/codex");
  });
});

describe("active Claude MCP inventory", () => {
  it("normalizes the public claude mcp list output", () => {
    expect(
      parseClaudeMcpList(
        [
          "Checking MCP server health…",
          "plugin:ask-llm:codex: npx -y @ask-llm/codex-mcp - ✔ Connected",
          "other: npx -y unrelated-server - ✘ Failed to connect - ECONNREFUSED",
        ].join("\n"),
      ),
    ).toEqual({
      "plugin:ask-llm:codex": {
        commandLine: "npx -y @ask-llm/codex-mcp",
        status: "✔ Connected",
      },
      other: { commandLine: "npx -y unrelated-server", status: "✘ Failed to connect - ECONNREFUSED" },
    });
  });

  it("queries Claude's active registration inventory", () => {
    const execute = vi.fn().mockReturnValue({ status: 0, stdout: connectedPluginList, stderr: "" });

    const servers = readActiveMcpServers({ command: "/usr/local/bin/claude", execute });

    expect(execute).toHaveBeenCalledWith(
      "/usr/local/bin/claude",
      ["mcp", "list"],
      expect.objectContaining({ encoding: "utf8" }),
    );
    expect(servers).toEqual(pluginServers);
  });

  it("uses shell resolution for Claude's Windows command shim", () => {
    const execute = vi.fn().mockReturnValue({ status: 0, stdout: connectedPluginList, stderr: "" });

    readActiveMcpServers({ command: "claude.cmd", execute, platform: "win32" });

    expect(execute).toHaveBeenCalledWith("claude.cmd", ["mcp", "list"], expect.objectContaining({ shell: true }));
  });

  it("preserves session-local Claude discovery context", () => {
    const execute = vi.fn().mockReturnValue({ status: 0, stdout: connectedPluginList, stderr: "" });
    const contextArgs = [
      "--plugin-dir",
      "/source/plugin",
      "--mcp-config",
      "/tmp/session-mcp.json",
      "--settings",
      "/tmp/session-settings.json",
      "--setting-sources",
      "user,project,local",
      "--strict-mcp-config",
    ];

    readActiveMcpServers({ execute, contextArgs });

    expect(execute).toHaveBeenCalledWith(
      "claude",
      [...contextArgs, "mcp", "list"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("reports active inventory command failures to the caller", () => {
    const execute = vi.fn().mockReturnValue({ status: 1, stdout: "", stderr: "configuration error" });

    expect(() => readActiveMcpServers({ execute })).toThrow(
      "Unable to inspect active Claude MCP registrations: configuration error.",
    );
  });
});

describe("sol-review CLI fallback", () => {
  it("uses the pinned codex exec contract and relays the review result unchanged", async () => {
    const review = "BLOCKING sample.js:2 — divide multiplies; restore total / count.\n";
    const execute = vi.fn().mockResolvedValue({ code: 0, stdout: review, stderr: "" });

    const result = await runCliFallback({ prompt: "review this diff", execute });

    expect(execute).toHaveBeenCalledWith({
      command: "codex",
      model: SOL_MODEL,
      prompt: "review this diff",
    });
    expect(codexFallbackArgs(SOL_MODEL)).toEqual([
      "exec",
      "-m",
      "gpt-5.6-sol",
      "-c",
      'model_reasoning_effort="high"',
      "-s",
      "read-only",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
    ]);
    expect(result).toEqual({ response: review, diagnostics: "", model: SOL_MODEL, fellBack: false });
  });

  it("uses Terra only for a quota failure and still relays the fallback result", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "rate_limit_exceeded" })
      .mockResolvedValueOnce({ code: 0, stdout: "validated Terra finding\n", stderr: "" });

    const result = await runCliFallback({ prompt: "review", execute });

    expect(execute).toHaveBeenNthCalledWith(2, {
      command: "codex",
      model: TERRA_MODEL,
      prompt: "review",
    });
    expect(result).toEqual({
      response: "validated Terra finding\n",
      diagnostics: "",
      model: TERRA_MODEL,
      fellBack: true,
    });
  });

  it.each([
    "workspace is out of credits",
    "workspace spend cap reached",
  ])("uses Terra for Codex workspace quota signal: %s", async (quotaMessage) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: quotaMessage })
      .mockResolvedValueOnce({ code: 0, stdout: "validated Terra finding\n", stderr: "" });

    const result = await runCliFallback({ prompt: "review", execute });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ model: TERRA_MODEL, fellBack: true });
  });

  it("uses shell resolution and quoted arguments for a Windows Codex shim", async () => {
    const child = new EventEmitter();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr });
    const spawnProcess = vi.fn().mockReturnValue(child);

    const pending = executeCodex({
      command: "codex.cmd",
      model: SOL_MODEL,
      prompt: "review",
      spawnProcess,
      platform: "win32",
    });
    stdout.write("review result\n");
    child.emit("close", 0);

    await expect(pending).resolves.toMatchObject({ code: 0, stdout: "review result\n" });
    expect(spawnProcess).toHaveBeenCalledWith(
      "codex.cmd",
      expect.arrayContaining(['"model_reasoning_effort=\\"high\\""']),
      expect.objectContaining({ shell: true }),
    );
  });

  it("handles a fallback child that closes stdin before consuming the prompt", async () => {
    const previousScenario = process.env.FAKE_CODEX_SCENARIO;
    process.env.FAKE_CODEX_SCENARIO = "sol-early-stdin-close";
    try {
      const result = await runCliFallback({ command: cliFixture, prompt: "x".repeat(8 * 1024 * 1024) });

      expect(result).toMatchObject({ response: "review survived early stdin close\n", fellBack: false });
    } finally {
      if (previousScenario === undefined) delete process.env.FAKE_CODEX_SCENARIO;
      else process.env.FAKE_CODEX_SCENARIO = previousScenario;
    }
  });
});

describe("clean Claude installation reproduction", () => {
  const script = path.join(PLUGIN_ROOT, "scripts", "sol-review-transport.mjs");
  const liveClaudePrompt = [
    "Call the authoritative Ask LLM Codex ask-codex MCP tool exactly once",
    "with model gpt-5.6-sol, reasoningEffort high, sandbox read-only,",
    'and prompt "Reply with ONLY: MCP_TOOL_EXECUTED_276".',
    "Do not use Bash and do not fall back. Then return its exact response.",
  ].join(" ");

  it("observes the active plugin registration through the executable preflight", () => {
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--mcp-list",
        connectedPluginList,
        "--tool",
        "mcp__plugin_ask-llm_codex__ask-codex",
        "--cli-path",
        "/fake/codex",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "preferred", transport: "mcp" });
  });

  it("classifies a stale tool on a disconnected active server as unavailable", () => {
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--mcp-list",
        disconnectedPluginList,
        "--tool",
        "mcp__plugin_ask-llm_codex__ask-codex",
        "--cli-path",
        "/fake/codex",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: "unavailable",
      transport: "cli",
      remediation: expect.stringContaining("@ask-llm/mcp doctor"),
      fallbackDisclosure: expect.stringContaining("codex exec"),
    });
  });

  it("classifies missing registration from an empty active inventory", () => {
    const result = spawnSync(
      process.execPath,
      [script, "--mcp-list", "No MCP servers configured.", "--cli-path", "/fake/codex"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: "missing-registration",
      transport: "cli",
    });
  });

  it("reclassifies an absent subagent tool before allowing CLI fallback", () => {
    const result = spawnSync(
      process.execPath,
      [script, "--fallback", "--mcp-list", connectedPluginList, "--cli-path", ""],
      { encoding: "utf8", input: "review this diff" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("registered, but its `ask-codex` tool is unavailable");
    expect(result.stderr).toContain("@ask-llm/mcp doctor");
  });

  it("runs the disclosed CLI fallback when active MCP inventory inspection fails", () => {
    const result = spawnSync(process.execPath, [script, "--fallback", "--cli-path", cliFixture], {
      encoding: "utf8",
      input: "review this diff",
      env: {
        ...process.env,
        CLAUDE_BIN: cliFixture,
        FAKE_CODEX_SCENARIO: "sol-inventory-failure-fallback",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("validated review after inventory failure\n");
    expect(result.stderr).toContain("availability could not be determined");
    expect(result.stderr).toContain("without claiming MCP registration or availability");
    expect(result.stderr).toContain("Remediation: Run `claude mcp list`");
    expect(result.stderr).not.toContain("registration is missing");
    expect(result.stderr).not.toContain("registered, but");
  });

  it("preserves source-plugin and session-local configuration during executable discovery", () => {
    const contextArgs = [
      "--plugin-dir",
      PLUGIN_ROOT,
      "--mcp-config",
      "/tmp/session-mcp.json",
      "--settings",
      "/tmp/session-settings.json",
      "--setting-sources",
      "user,project,local",
      "--strict-mcp-config",
    ];
    const result = spawnSync(
      process.execPath,
      [script, ...contextArgs, "--tool", "mcp__plugin_ask-llm_codex__ask-codex", "--cli-path", "/fake/codex"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CLAUDE_BIN: cliFixture,
          FAKE_CODEX_SCENARIO: "sol-context-inventory",
          FAKE_CLAUDE_CONTEXT_ARGS: JSON.stringify(contextArgs),
        },
      },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "preferred", transport: "mcp" });
  });

  it("executes the disclosed CLI fallback after an MCP invocation failure", () => {
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--fallback",
        "--mcp-failed",
        "--mcp-list",
        connectedPluginList,
        "--tool",
        "mcp__plugin_ask-llm_codex__ask-codex",
        "--cli-path",
        cliFixture,
      ],
      {
        encoding: "utf8",
        input: "review this diff",
        env: {
          ...process.env,
          FAKE_CODEX_RAW_STDOUT: "validated review after MCP transport failure\n",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("validated review after MCP transport failure\n");
    expect(result.stderr).toContain("MCP invocation failed");
    expect(result.stderr).toContain("codex exec");
    expect(result.stderr).toContain("@ask-llm/mcp doctor");
  });

  it.runIf(process.env.ASK_LLM_CLAUDE_E2E === "1")(
    "exposes and invokes the preferred tool in a clean Claude reviewer session",
    () => {
      const consumerDir = fs.mkdtempSync(path.join(os.tmpdir(), "ask-llm-sol-review-"));
      try {
        const result = spawnSync(
          process.env.CLAUDE_BIN || "claude",
          [
            "--plugin-dir",
            PLUGIN_ROOT,
            "--setting-sources",
            "",
            "--no-session-persistence",
            "--dangerously-skip-permissions",
            "--max-budget-usd",
            "0.75",
            "--allowedTools",
            "mcp__plugin_ask-llm_codex",
            "--output-format",
            "stream-json",
            "--verbose",
            "--agent",
            "ask-llm:sol-reviewer",
            "-p",
            liveClaudePrompt,
          ],
          {
            cwd: consumerDir,
            encoding: "utf8",
            timeout: 90_000,
            maxBuffer: 10 * 1024 * 1024,
          },
        );

        expect(result.status, result.stderr || result.stdout).toBe(0);
        const events = result.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        const toolUses = events.flatMap((event) => {
          const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
          return message?.content?.filter((content) => content.type === "tool_use") ?? [];
        });
        const askCodexCall = toolUses.find((content) => content.name === "mcp__plugin_ask-llm_codex__ask-codex");

        expect(askCodexCall, result.stdout).toMatchObject({
          input: {
            model: SOL_MODEL,
            reasoningEffort: "high",
            sandbox: "read-only",
          },
        });
        const toolResult = events
          .flatMap((event) => {
            const message = event.message as { content?: Array<Record<string, unknown>> } | undefined;
            return message?.content?.filter((content) => content.type === "tool_result") ?? [];
          })
          .find((content) => content.tool_use_id === askCodexCall?.id);
        expect(toolResult, result.stdout).toBeDefined();
        const payload = JSON.parse(String(toolResult?.content)) as Record<string, unknown>;
        expect(payload).toMatchObject({
          provider: "codex",
          model: SOL_MODEL,
          usage: { fellBack: false },
        });
        expect(payload.response).toContain("MCP_TOOL_EXECUTED_276");
      } finally {
        fs.rmSync(consumerDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
