import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ASK_CODEX_PACKAGE,
  classifySolReviewTransport,
  codexFallbackArgs,
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
const connectedPluginList =
  "plugin:ask-llm:codex: npx -y @ask-llm/codex-mcp - ✔ Connected\n";

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
          "other: npx -y unrelated-server - ✘ Failed to connect",
        ].join("\n"),
      ),
    ).toEqual({
      "plugin:ask-llm:codex": {
        commandLine: "npx -y @ask-llm/codex-mcp",
        status: "✔ Connected",
      },
      other: { commandLine: "npx -y unrelated-server", status: "✘ Failed to connect" },
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

  it("fails closed when the active inventory cannot be inspected", () => {
    const execute = vi.fn().mockReturnValue({ status: 1, stdout: "", stderr: "configuration error" });

    expect(() => readActiveMcpServers({ execute })).toThrow(/claude mcp list/);
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
});

describe("clean Claude installation reproduction", () => {
  const script = path.join(PLUGIN_ROOT, "scripts", "sol-review-transport.mjs");

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

  it("classifies a disconnected active server as unavailable rather than unregistered", () => {
    const result = spawnSync(
      process.execPath,
      [script, "--mcp-list", connectedPluginList, "--cli-path", "/fake/codex"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "unavailable", transport: "cli" });
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
});
