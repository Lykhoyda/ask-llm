#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCommandInvocation } from "./lib/process.mjs";

export const ASK_CODEX_PACKAGE = "@ask-llm/codex-mcp";
export const ASK_CODEX_TOOL = "ask-codex";
export const SOL_MODEL = "gpt-5.6-sol";
export const TERRA_MODEL = "gpt-5.6-terra";

const scriptPath = fileURLToPath(import.meta.url);
const quotaSignals = [
  "rate_limit_exceeded",
  "quota_exceeded",
  "429",
  "insufficient_quota",
  "out of credits",
  "spend cap",
  "usage limit",
];

export function isAskCodexToolName(name) {
  return name === ASK_CODEX_TOOL || /^mcp__.+__ask-codex$/.test(name);
}

export function isAskCodexRegistration(server) {
  if (!server || typeof server !== "object") return false;
  const command = typeof server.command === "string" ? server.command : "";
  const args = Array.isArray(server.args) ? server.args.filter((arg) => typeof arg === "string") : [];
  const commandLine = typeof server.commandLine === "string" ? server.commandLine : "";
  return (
    /(?:^|[/\\])ask-codex-mcp(?:\.cmd|\.exe)?$/.test(command) ||
    args.includes(ASK_CODEX_PACKAGE) ||
    /(?:^|\s)@ask-llm\/codex-mcp(?:@[^\s]+)?(?:\s|$)/.test(commandLine) ||
    /(?:^|[/\\])ask-codex-mcp(?:\.cmd|\.exe)?(?:\s|$)/.test(commandLine)
  );
}

export function parseClaudeMcpList(output) {
  const servers = {};
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf(": ");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    const details = line.slice(separator + 2).trim();
    const statusSeparator = details.search(/ - (?=(?:✔|✘|!|⏸|cached\b|not configured\b|disabled\b))/i);
    servers[name] = {
      commandLine: statusSeparator === -1 ? details : details.slice(0, statusSeparator).trim(),
      status: statusSeparator === -1 ? "" : details.slice(statusSeparator + 3).trim(),
    };
  }
  return servers;
}

export function readActiveMcpServers({
  command = process.env.CLAUDE_BIN || "claude",
  execute = spawnSync,
  platform = process.platform,
  contextArgs = [],
} = {}) {
  const invocation = prepareCommandInvocation(
    [...contextArgs, "mcp", "list"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
    },
    platform,
  );
  const result = execute(command, invocation.args, invocation.options);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `exited ${result.status}`;
    throw new Error(`Unable to inspect active Claude MCP registrations: ${detail}.`);
  }
  return parseClaudeMcpList(result.stdout || "");
}

function expectedToolName(serverName) {
  return `mcp__${serverName.replaceAll(":", "_")}__${ASK_CODEX_TOOL}`;
}

function isAvailableMcpServer(server) {
  const status = typeof server?.status === "string" ? server.status.trim() : "";
  return !status || /^✔\s*Connected\b/i.test(status) || /^cached\b.*\bconnects on first use\b/i.test(status);
}

export function classifySolReviewTransport({
  availableTools = [],
  mcpServers = {},
  cliPath = "",
  inventoryError = null,
  mcpFailed = false,
}) {
  if (inventoryError) {
    const reason = `Ask LLM Codex MCP availability could not be determined because the active Claude MCP inventory could not be inspected: ${inventoryError}`;
    const remediation = "Run `claude mcp list`, resolve the inventory failure, then fully restart Claude Code.";
    if (!cliPath) {
      return {
        state: "inventory-unavailable",
        transport: null,
        toolName: null,
        diagnostic: `${reason} The explicit CLI fallback is also unavailable.`,
        remediation: `${remediation} Install the fallback with \`npm install -g @openai/codex\` if needed.`,
        fallbackDisclosure: null,
      };
    }
    return {
      state: "inventory-unavailable",
      transport: "cli",
      toolName: null,
      diagnostic: reason,
      remediation,
      fallbackDisclosure: `Transport disclosure: ${reason} Running the review through the explicit \`codex exec\` CLI fallback without claiming MCP registration or availability; validated findings will be relayed unchanged.`,
    };
  }

  const registrations = Object.entries(mcpServers).filter(([, server]) => isAskCodexRegistration(server));
  const availableRegistrations = registrations.filter(([, server]) => isAvailableMcpServer(server));
  const registeredToolNames = new Set(availableRegistrations.map(([name]) => expectedToolName(name)));
  const toolName = availableTools.find((name) => isAskCodexToolName(name) && registeredToolNames.has(name));
  if (toolName && !mcpFailed) {
    return {
      state: "preferred",
      transport: "mcp",
      toolName,
      diagnostic: `Ask LLM Codex transport available as ${toolName}.`,
      remediation: null,
      fallbackDisclosure: null,
    };
  }

  const registered = registrations.length > 0;
  const state = registered || mcpFailed ? "unavailable" : "missing-registration";
  const remediation =
    registered || mcpFailed
      ? "Run `npx -y @ask-llm/mcp doctor`, inspect `/mcp`, then fully restart Claude Code."
      : "Run `claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp`, fully restart Claude Code, then verify with `/mcp`.";
  const unavailableRegistration = registrations.find(([, server]) => !isAvailableMcpServer(server));
  const reason = mcpFailed
    ? "Ask LLM Codex MCP invocation failed in this session, so the preferred transport is unavailable."
    : unavailableRegistration
      ? `Ask LLM Codex MCP is registered, but active inventory reports it unavailable: ${unavailableRegistration[1].status}.`
      : registered
        ? "Ask LLM Codex MCP is registered, but its `ask-codex` tool is unavailable in this session."
        : "Ask LLM Codex MCP registration is missing from this Claude Code installation.";

  if (!cliPath) {
    return {
      state,
      transport: null,
      toolName: null,
      diagnostic: `${reason} The explicit CLI fallback is also unavailable.`,
      remediation: `${remediation} Install the fallback with \`npm install -g @openai/codex\` if needed.`,
      fallbackDisclosure: null,
    };
  }

  return {
    state,
    transport: "cli",
    toolName: null,
    diagnostic: reason,
    remediation,
    fallbackDisclosure: `Transport disclosure: ${reason} Running the review through the explicit \`codex exec\` CLI fallback; validated findings will be relayed unchanged.`,
  };
}

export function codexFallbackArgs(model) {
  return [
    "exec",
    "-m",
    model,
    "-c",
    'model_reasoning_effort="high"',
    "-s",
    "read-only",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
  ];
}

export function executeCodex({ command, model, prompt, spawnProcess = spawn, platform = process.platform }) {
  return new Promise((resolveRun) => {
    const invocation = prepareCommandInvocation(
      codexFallbackArgs(model),
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
      platform,
    );
    const child = spawnProcess(command, invocation.args, invocation.options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolveRun({ code: 127, stdout, stderr: `${stderr}${error.message}` });
    });
    child.on("close", (code) => {
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

export async function runCliFallback({
  prompt,
  command = process.env.ASK_CODEX_BIN || "codex",
  fallbackModel = process.env.ASK_CODEX_FALLBACK_MODEL || TERRA_MODEL,
  execute = executeCodex,
}) {
  const primary = await execute({ command, model: SOL_MODEL, prompt });
  if (primary.code === 0) {
    return { response: primary.stdout, diagnostics: primary.stderr, model: SOL_MODEL, fellBack: false };
  }

  const primaryOutput = `${primary.stderr}\n${primary.stdout}`;
  const normalizedPrimaryOutput = primaryOutput.toLowerCase();
  const quotaFailure = quotaSignals.some((signal) => normalizedPrimaryOutput.includes(signal));
  if (!quotaFailure || fallbackModel === SOL_MODEL) {
    throw new Error(primaryOutput.trim() || `codex exec exited ${primary.code}`);
  }

  const fallback = await execute({ command, model: fallbackModel, prompt });
  if (fallback.code !== 0) {
    const fallbackOutput = `${fallback.stderr}\n${fallback.stdout}`.trim();
    throw new Error(`Sol review failed and ${fallbackModel} fallback also failed: ${fallbackOutput}`);
  }

  return {
    response: fallback.stdout,
    diagnostics: fallback.stderr,
    model: fallbackModel,
    fellBack: true,
  };
}

function parseArgs(args) {
  const parsed = {
    tools: [],
    cliPath: "",
    mcpList: null,
    fallback: false,
    mcpFailed: false,
    claudeContextArgs: [],
  };
  const claudeContextValueFlags = new Set(["--plugin-dir", "--mcp-config", "--settings", "--setting-sources"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--fallback") parsed.fallback = true;
    else if (arg === "--mcp-failed") parsed.mcpFailed = true;
    else if (arg === "--tool") parsed.tools.push(args[++index] ?? "");
    else if (arg === "--cli-path") parsed.cliPath = args[++index] ?? "";
    else if (arg === "--mcp-list") parsed.mcpList = args[++index] ?? "";
    else if (arg === "--strict-mcp-config") parsed.claudeContextArgs.push(arg);
    else if (claudeContextValueFlags.has(arg)) {
      const value = args[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      parsed.claudeContextArgs.push(arg, value);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readMcpServers(parsed) {
  if (parsed.mcpList !== null) {
    return { mcpServers: parseClaudeMcpList(parsed.mcpList), inventoryError: null };
  }
  try {
    return {
      mcpServers: readActiveMcpServers({ contextArgs: parsed.claudeContextArgs }),
      inventoryError: null,
    };
  } catch (error) {
    return {
      mcpServers: {},
      inventoryError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const { mcpServers, inventoryError } = readMcpServers(parsed);
  const decision = classifySolReviewTransport({
    availableTools: parsed.tools,
    mcpServers,
    cliPath: parsed.cliPath,
    inventoryError,
    mcpFailed: parsed.mcpFailed,
  });

  if (parsed.fallback) {
    if (decision.transport !== "cli") {
      if (decision.transport === "mcp") {
        throw new Error(`Ask LLM Codex MCP is available as ${decision.toolName}; CLI fallback was not started.`);
      }
      throw new Error(`${decision.diagnostic} ${decision.remediation}`);
    }
    process.stderr.write(`${decision.fallbackDisclosure}\nRemediation: ${decision.remediation}\n`);
    let prompt = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) prompt += chunk;
    if (!prompt.trim()) throw new Error("Sol review CLI fallback requires a prompt on stdin.");
    const result = await runCliFallback({ prompt, command: parsed.cliPath });
    process.stderr.write(
      `Transport disclosure: review ran through codex exec (${result.model}, high effort, read-only).\n`,
    );
    if (result.fellBack) {
      process.stderr.write(`Model fallback disclosure: Sol hit quota; review completed on ${result.model}.\n`);
    }
    if (result.diagnostics) process.stderr.write(result.diagnostics);
    process.stdout.write(result.response);
    return;
  }

  process.stdout.write(`${JSON.stringify(decision)}\n`);
  if (!decision.transport) process.exitCode = 1;
}

if (resolve(process.argv[1] || "") === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
