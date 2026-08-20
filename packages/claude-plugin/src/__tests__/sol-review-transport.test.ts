import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ASK_CODEX_PACKAGE,
  classifySolReviewTransport,
  codexFallbackArgs,
  runCliFallback,
  SOL_MODEL,
  TERRA_MODEL,
} from "../../scripts/sol-review-transport.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

const bundledServers = {
  codex: { command: "npx", args: ["-y", ASK_CODEX_PACKAGE] },
};

describe("sol-review transport selection", () => {
  it("selects the authoritative ask-codex MCP tool when available", () => {
    const decision = classifySolReviewTransport({
      availableTools: ["mcp__plugin_ask-llm_codex__ask-codex"],
      mcpServers: bundledServers,
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
      mcpServers: bundledServers,
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
      mcpServers: bundledServers,
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

  it("observes the bundled registration through the executable preflight", () => {
    const result = spawnSync(
      process.execPath,
      [script, "--tool", "mcp__plugin_ask-llm_codex__ask-codex", "--cli-path", "/fake/codex"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "preferred", transport: "mcp" });
  });

  it("classifies a disconnected clean-install server as unavailable rather than unregistered", () => {
    const result = spawnSync(process.execPath, [script, "--cli-path", "/fake/codex"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ state: "unavailable", transport: "cli" });
  });

  it("reproduces the pre-fix missing-registration state with an empty install manifest", () => {
    const result = spawnSync(
      process.execPath,
      [script, "--mcp-json", '{"mcpServers":{}}', "--cli-path", "/fake/codex"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      state: "missing-registration",
      transport: "cli",
    });
  });
});
