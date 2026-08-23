#!/usr/bin/env node
// Deterministic adapter probe: real Ask LLM adapters, fake local transports.
// This process never reads credentials or reaches a provider network.

import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";

interface Scenario {
  id: string;
  host: "claude" | "cursor-agent" | "pi" | "codex-cli" | "grok-cli";
  surface: string;
  provider?: "codex" | "grok";
  harness?: "cursor-agent" | "codex-cli" | "grok-cli";
}

interface ProbeConfig {
  root: string;
  scenario: Scenario;
  model: string;
  secondaryModel?: string;
  effort?: string;
  livePrompt: string;
  marker: string;
}

const configPath = process.argv[2];
if (!configPath) throw new Error("adapter probe requires a private config path");
const config = JSON.parse(await readFile(configPath, "utf8")) as ProbeConfig;
const work = await mkdtemp(join(tmpdir(), "ask-llm-real-adapter-"));
const bin = join(work, "bin");
const invocationLog = join(work, "invocations.jsonl");

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function installFake(name: string, source: string): Promise<void> {
  const script = join(bin, `${name}.cjs`);
  await writeFile(script, source, { mode: 0o700 });
  const unix = join(bin, name);
  await writeFile(unix, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o700 });
  await chmod(unix, 0o700);
  await writeFile(join(bin, `${name}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`, { mode: 0o700 });
}

function fakePreamble(): string {
  return `const fs = require("node:fs");
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
fs.appendFileSync(process.env.ASK_LLM_SMOKE_INVOCATIONS, JSON.stringify({ command: require("node:path").basename(process.argv[1], ".cjs"), args, stdin }) + "\\n");
const marker = process.env.ASK_LLM_SMOKE_MARKER;
`;
}

async function installFakes(): Promise<void> {
  await mkdir(bin, { recursive: true });
  await installFake(
    "agent",
    `${fakePreamble()}
if (args.includes("--help")) { console.log("--output-format --mode --model"); process.exit(0); }
if (args.includes("--list-models")) {
  console.log("Available models\\n${config.model} - Fixture primary\\n${config.secondaryModel ?? "gpt-5.6-sol-high"} - Fixture secondary");
  process.exit(0);
}
const model = args[args.indexOf("--model") + 1];
const family = /grok/i.test(model) ? "grok" : /(?:gpt|codex|o[134])/i.test(model) ? "codex" : "unknown";
console.log(JSON.stringify({ type: "system", subtype: "init", model: family === "grok" ? "Cursor Grok 4.6" : "GPT-5.6 Sol High", session_id: "fixture-session" }));
console.log(JSON.stringify({ type: "result", result: marker, usage: { input_tokens: 2, output_tokens: 1 } }));
`,
  );
  await installFake(
    "codex",
    `${fakePreamble()}
const modelIndex = args.indexOf("--model") >= 0 ? args.indexOf("--model") : args.indexOf("-m");
const model = args[modelIndex + 1];
console.log(JSON.stringify({ type: "thread.started", thread_id: "fixture-thread" }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: marker } }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 2, output_tokens: 1 } }));
`,
  );
  await installFake(
    "grok",
    `${fakePreamble()}
if (args.includes("--help")) { console.log("-p --output-format --model --effort --sandbox --prompt-file"); process.exit(0); }
if (args[0] === "models") { console.log("${config.model} fixture"); process.exit(0); }
const model = args[args.indexOf("--model") + 1];
console.log(JSON.stringify({ model, response: marker, usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 } }));
`,
  );
  await installFake(
    "gemini",
    `${fakePreamble()}
console.log(JSON.stringify({ response: marker, stats: { models: { fixture: { tokens: { input: 2, candidates: 1, cached: 0, thoughts: 0 } } } } }));
`,
  );
}

async function validateSkillAdapter(): Promise<void> {
  const plugin = join(config.root, "packages", "claude-plugin");
  const skillHost = ["claude", "cursor-agent", "pi"].includes(config.scenario.host);
  const skillName = !skillHost
    ? undefined
    : config.scenario.surface.includes("brainstorm")
      ? "brainstorm"
      : config.scenario.surface.includes("codex-pair")
        ? "codex-pair"
        : config.scenario.surface.includes("grok-pair")
          ? "grok-pair"
          : undefined;
  if (!skillName) return;
  const skill = await readFile(join(plugin, "skills", skillName, "SKILL.md"), "utf8");
  invariant(skill.includes(`name: ${skillName}`), `${skillName} skill adapter is not discoverable`);
  if (config.scenario.host === "cursor-agent" && skillName !== "brainstorm") {
    const manifest = JSON.parse(await readFile(join(plugin, ".cursor-plugin", "plugin.json"), "utf8")) as {
      skills?: string[];
    };
    invariant(
      manifest.skills?.some((entry) => entry.endsWith(`/skills/${skillName}`) || entry.endsWith(`skills/${skillName}`)),
      `Cursor manifest does not expose ${skillName}`,
    );
  } else if (config.scenario.host === "pi") {
    const manifest = JSON.parse(await readFile(join(plugin, "package.json"), "utf8")) as { pi?: { skills?: string[] } };
    invariant(
      manifest.pi?.skills?.some((entry) => entry.includes(`/skills/${skillName}/`)),
      `Pi manifest excludes ${skillName}`,
    );
  }
  if (skillName === "brainstorm") {
    invariant(skill.includes("provider@harness:exact-model-id"), "brainstorm adapter lost routed participant syntax");
    invariant(config.livePrompt.includes(config.model), "brainstorm prompt lost the exact primary model");
    if (config.secondaryModel)
      invariant(config.livePrompt.includes(config.secondaryModel), "brainstorm prompt lost Sol");
  }
  if (skillName === "codex-pair") {
    for (const token of [`model=${config.model}`, `effort=${config.effort}`, "consent=confirmed"]) {
      invariant(config.livePrompt.includes(token), `codex-pair prompt lost ${token}`);
    }
  }
  if (skillName === "grok-pair") {
    for (const token of [
      `route=${config.scenario.harness}`,
      `model=${config.model}`,
      `effort=${config.effort}`,
      "consent=confirmed",
    ]) {
      invariant(config.livePrompt.includes(token), `grok-pair prompt lost ${token}`);
    }
  }
}

async function runCursor(provider: "codex" | "grok", model: string) {
  const { executeCursorAgent } = await import("@ask-llm/mcp/cursor");
  return executeCursorAgent({ prompt: `${config.livePrompt}\nprobe=${Date.now()}`, provider, model });
}

async function runCodex() {
  const { executeCodexCLI } = await import("@ask-llm/codex-mcp/executor");
  return executeCodexCLI({
    prompt: `${config.livePrompt}\nprobe=${Date.now()}`,
    model: config.model,
    reasoningEffort: (config.effort ?? "high") as "low" | "medium" | "high" | "xhigh" | "max",
    sessionId: "",
    sandbox: "read-only",
  });
}

async function runGrok() {
  const { executeGrok } = await import("@ask-llm/grok-mcp/executor");
  return executeGrok({
    prompt: `${config.livePrompt}\nprobe=${Date.now()}`,
    model: config.model,
    harness: "grok-cli",
    reasoningEffort: (config.effort ?? "high") as "low" | "medium" | "high" | "xhigh",
  });
}

async function runBrainstorm() {
  invariant(config.secondaryModel, "exact brainstorm panel requires a secondary Sol model");
  const { parseBrainstormParticipant, runBrainstormPanel } = await import(
    "../packages/claude-plugin/src/brainstorm-panel.js"
  );
  const report = await runBrainstormPanel({
    prompt: `${config.livePrompt}\nprobe=${Date.now()}`,
    participants: [
      parseBrainstormParticipant(`grok@cursor-agent:${config.model}`),
      parseBrainstormParticipant(`codex@cursor-agent:${config.secondaryModel}`),
    ],
  });
  invariant(report.status === "complete" && report.consensusEligible, "real brainstorm panel did not complete");
  invariant(report.participants[0]?.provider === "grok", "brainstorm lost Grok provider identity");
  invariant(report.participants[1]?.provider === "codex", "brainstorm lost Codex provider identity");
  return report;
}

async function runPiAdapter() {
  const { registerProviderTools } = await import("../packages/claude-plugin/pi/extensions/provider-tools.js");
  type ToolResult = { content: unknown; details: Record<string, unknown> };
  type RegisteredTool = {
    name: string;
    execute: (id: string, params: Record<string, unknown>) => Promise<ToolResult>;
  };
  const tools = new Map<string, RegisteredTool>();
  const extensionStub = {
    registerTool(tool: unknown) {
      const registered = tool as RegisteredTool;
      tools.set(registered.name, registered);
    },
  };
  registerProviderTools(extensionStub as never);
  const requiredTool = (name: string) => {
    const tool = tools.get(name);
    invariant(tool, `Pi adapter did not register ${name}`);
    return tool;
  };
  if (config.scenario.surface.includes("brainstorm")) {
    invariant(config.secondaryModel, "Pi brainstorm requires the Sol participant");
    const tool = requiredTool("ask-cursor-agent");
    const first = await tool.execute("grok", { prompt: config.livePrompt, provider: "grok", model: config.model });
    const second = await tool.execute("codex", {
      prompt: config.livePrompt,
      provider: "codex",
      model: config.secondaryModel,
    });
    invariant(first.details.provider === "grok" && second.details.provider === "codex", "Pi lost provider identity");
    return { first, second };
  }
  if (config.scenario.surface.includes("ask-multi")) {
    const result = await requiredTool("ask-multi").execute("multi", {
      prompt: config.livePrompt,
      providers: ["codex", "gemini"],
      options: { codex: { model: config.model, reasoningEffort: config.effort, sessionId: "" } },
    });
    invariant(Array.isArray(result.details.results), "Pi ask-multi returned no result list");
    invariant(result.details.results.length === 2, "Pi ask-multi did not exercise both real adapters");
    return result;
  }
  const result = await requiredTool("ask-codex").execute("pair", {
    prompt: config.livePrompt,
    model: config.model,
    reasoningEffort: config.effort,
    sessionId: "",
    sandbox: "read-only",
  });
  invariant(result.details.provider === "codex", "Pi codex-pair lost provider identity");
  return result;
}

await installFakes();
const hermeticPath = [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter);
process.env.ASK_LLM_PATH = hermeticPath;
process.env.PATH = hermeticPath;
process.env.ASK_LLM_SMOKE_INVOCATIONS = invocationLog;
process.env.ASK_LLM_SMOKE_MARKER = config.marker;
process.env.ASK_CODEX_TIMEOUT_MS = "5000";
process.env.ASK_GROK_TIMEOUT_MS = "5000";
process.env.ASK_CURSOR_TIMEOUT_MS = "5000";

try {
  await validateSkillAdapter();
  let result: unknown;
  if (config.scenario.host === "pi") result = await runPiAdapter();
  else if (
    config.scenario.surface.includes("brainstorm") &&
    config.scenario.host !== "codex-cli" &&
    config.scenario.host !== "grok-cli"
  ) {
    result = await runBrainstorm();
  } else if (config.scenario.provider === "codex") result = await runCodex();
  else if (config.scenario.provider === "grok") result = await runGrok();
  else result = await runCursor("grok", config.model);

  const invocations = (await readFile(invocationLog, "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  invariant(invocations.length > 0, "real adapter never reached a fake transport");
  const unsafe = invocations.some((entry) =>
    entry.args.some((arg: string) => ["--force", "--trust", "--yolo", "workspace-write"].includes(arg.toLowerCase())),
  );
  invariant(!unsafe, "real adapter selected a writable/trust option");
  const selectedExactModel = invocations.some((entry) => {
    const index = entry.args.findIndex((arg: string) => arg === "--model" || arg === "-m");
    return index >= 0 && entry.args[index + 1] === config.model;
  });
  invariant(selectedExactModel, "real adapter lost the exact primary model option");
  if (config.effort) {
    const selectedEffort = invocations.some(
      (entry) =>
        entry.args.includes(`model_reasoning_effort="${config.effort}"`) ||
        entry.args.some((arg: string, index: number) => arg === "--effort" && entry.args[index + 1] === config.effort),
    );
    invariant(selectedEffort, "real adapter lost the exact effort option");
  }
  const serialized = JSON.stringify(result);
  invariant(!/["'](?:fallback|fellBack)["']\s*:\s*true/i.test(serialized), "real adapter disclosed fallback");
  invariant(serialized.includes(config.marker), "real adapter result lost the deterministic marker");
  console.log(
    JSON.stringify({
      marker: config.marker,
      provider: config.scenario.provider,
      model: config.model,
      harness: config.scenario.harness,
      fellBack: false,
      invocations: invocations.map((entry) => ({ command: entry.command, args: entry.args })),
    }),
  );
} finally {
  await rm(work, { recursive: true, force: true });
}
