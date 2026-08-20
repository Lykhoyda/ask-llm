#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ASK_CODEX_PACKAGE = "@ask-llm/codex-mcp";
export const ASK_CODEX_TOOL = "ask-codex";
export const SOL_MODEL = "gpt-5.6-sol";
export const TERRA_MODEL = "gpt-5.6-terra";

const scriptPath = fileURLToPath(import.meta.url);
const defaultConfigPath = resolve(dirname(scriptPath), "..", ".mcp.json");
const quotaPattern = /(?:rate.?limit|rate_limit_exceeded|usage limit|quota|too many requests|\b429\b)/i;

export function isAskCodexToolName(name) {
  return name === ASK_CODEX_TOOL || /^mcp__.+__ask-codex$/.test(name);
}

export function isAskCodexRegistration(server) {
  if (!server || typeof server !== "object") return false;
  const command = typeof server.command === "string" ? server.command : "";
  const args = Array.isArray(server.args) ? server.args.filter((arg) => typeof arg === "string") : [];
  return command.endsWith("ask-codex-mcp") || args.includes(ASK_CODEX_PACKAGE);
}

export function classifySolReviewTransport({ availableTools = [], mcpServers = {}, cliPath = "" }) {
  const toolName = availableTools.find(isAskCodexToolName);
  if (toolName) {
    return {
      state: "preferred",
      transport: "mcp",
      toolName,
      diagnostic: `Ask LLM Codex transport available as ${toolName}.`,
      remediation: null,
      fallbackDisclosure: null,
    };
  }

  const registered = Object.values(mcpServers).some(isAskCodexRegistration);
  const state = registered ? "unavailable" : "missing-registration";
  const remediation = registered
    ? "Run `npx -y @ask-llm/mcp doctor`, inspect `/mcp`, then fully restart Claude Code."
    : "Run `claude mcp add --scope user codex -- npx -y @ask-llm/codex-mcp`, fully restart Claude Code, then verify with `/mcp`.";
  const reason = registered
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

function executeCodex({ command, model, prompt }) {
  return new Promise((resolveRun) => {
    const child = spawn(command, codexFallbackArgs(model), {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
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
  if (!quotaPattern.test(primaryOutput) || fallbackModel === SOL_MODEL) {
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
  const parsed = { tools: [], cliPath: "", configPath: defaultConfigPath, mcpJson: null, fallback: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--fallback") parsed.fallback = true;
    else if (arg === "--tool") parsed.tools.push(args[++index] ?? "");
    else if (arg === "--cli-path") parsed.cliPath = args[++index] ?? "";
    else if (arg === "--config") parsed.configPath = args[++index] ?? defaultConfigPath;
    else if (arg === "--mcp-json") parsed.mcpJson = args[++index] ?? "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readMcpServers(parsed) {
  const raw = parsed.mcpJson ?? readFileSync(parsed.configPath, "utf8");
  const config = JSON.parse(raw);
  return config?.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {};
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.fallback) {
    let prompt = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) prompt += chunk;
    if (!prompt.trim()) throw new Error("Sol review CLI fallback requires a prompt on stdin.");
    const result = await runCliFallback({ prompt });
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

  const decision = classifySolReviewTransport({
    availableTools: parsed.tools,
    mcpServers: readMcpServers(parsed),
    cliPath: parsed.cliPath,
  });
  process.stdout.write(`${JSON.stringify(decision)}\n`);
  if (!decision.transport) process.exitCode = 1;
}

if (resolve(process.argv[1] || "") === scriptPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
