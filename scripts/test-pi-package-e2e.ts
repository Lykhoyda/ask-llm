#!/usr/bin/env node

// Hermetic issue #262 acceptance smoke. Runs a real Pi RPC process and the
// real packed package/provider executors, but backs every model/provider with
// deterministic local fixtures. No subscription credential or network call is
// permitted by this script.

import { spawn, spawnSync } from "node:child_process";
import { appendFile, chmod, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureExtension = join(root, "scripts", "fixtures", "pi-scripted-host.ts");
const work = await mkdtemp(join(tmpdir(), "ask-llm-pi-e2e-"));
const project = join(work, "project");
const bin = join(work, "bin");
const invocationLog = join(work, "provider-invocations.jsonl");
const imagePath = join(project, "smoke-image.png");
const agentDir = process.env.PI_CODING_AGENT_DIR || join(work, "agent");
// The package ships no skills: Pi reads them from a skills folder. CI points this at the
// folder the pinned skills CLI filled; otherwise seed one from this checkout's corpus.
const skillsDir = process.env.ASK_LLM_PI_SKILLS_DIR || join(work, "skills");
// CI installs the packed package into PI_CODING_AGENT_DIR; a bare run loads this checkout's package.
const packageSource = process.env.PI_CODING_AGENT_DIR ? undefined : join(root, "packages", "llm-mcp");

interface ContentPart {
  type?: string;
  text?: unknown;
}

interface ChatMessage {
  role?: string;
  content?: unknown;
}

interface RpcEvent {
  type?: string;
  id?: string;
  success?: boolean;
  toolName?: string;
  isError?: boolean;
  result?: {
    content?: ContentPart[];
    details?: { provider?: string; structuredContent?: Record<string, unknown> };
  };
  data?: { messages?: unknown[]; commands?: Array<{ name?: string }>; sessionFile?: string; cancelled?: boolean };
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function asText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  return content
    .map((part: ContentPart | null) => (typeof part?.text === "string" ? part.text : JSON.stringify(part)))
    .join("\n");
}

function scenarioFor(messages: ChatMessage[]): string {
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  return asText(latestUser?.content);
}

function scriptedTool(scenario: string) {
  const pairing = scenario.match(/SMOKE_PAIR_WRITE(?:_(\w+))?/);
  if (pairing) {
    const suffix = pairing[1] ? `-${pairing[1].toLowerCase()}` : "";
    return {
      name: "write",
      arguments: { path: join(project, `paired${suffix}.ts`), content: "export const paired = 1;\n" },
    };
  }
  if (scenario.includes("SMOKE_FAILED_WRITE")) {
    return { name: "write", arguments: { path: "/dev/null/child", content: "must fail\n" } };
  }
  if (scenario.includes("SMOKE_SINGLE")) {
    return { name: "ask-codex", arguments: { prompt: "FAKE_SINGLE", reasoningEffort: "high" } };
  }
  if (scenario.includes("SMOKE_ASK_LLM")) {
    return {
      name: "ask-llm",
      arguments: { provider: "codex", prompt: "FAKE_ASK_LLM", reasoningEffort: "high", sandbox: "read-only" },
    };
  }
  if (scenario.includes("SMOKE_MULTI_LLM")) {
    return { name: "multi-llm", arguments: { prompt: "FAKE_MULTI_LLM", providers: ["codex", "gemini"] } };
  }
  if (scenario.includes("SMOKE_MULTI")) {
    return { name: "ask-multi", arguments: { prompt: "FAKE_MULTI", providers: ["codex", "gemini"] } };
  }
  if (scenario.includes("SMOKE_BRAINSTORM")) {
    return {
      name: "ask-multi",
      arguments: { prompt: "FAKE_BRAINSTORM", providers: ["codex", "gemini", "ollama", "antigravity"] },
    };
  }
  if (scenario.includes("SMOKE_IMAGE")) {
    return {
      name: "ask-codex-write",
      arguments: { prompt: `Create the requested image. SMOKE_IMAGE_PATH=${imagePath}`, sandbox: "workspace-write" },
    };
  }
  if (scenario.includes("SMOKE_BOUNDED")) {
    return { name: "ask-codex", arguments: { prompt: "FAKE_HUGE" } };
  }
  if (scenario.includes("SMOKE_UNAVAILABLE")) {
    return { name: "ask-antigravity", arguments: { prompt: "FAKE_FAIL" } };
  }
  return undefined;
}

function sendSse(response: ServerResponse, payload: unknown): void {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  response.end(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`);
}

function completionChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: "chatcmpl-hermetic",
    object: "chat.completion.chunk",
    created: 1,
    model: "scripted",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

const heldWrites = new Map<string, ServerResponse>();
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");

  if (request.url === "/hold-write") {
    heldWrites.set(JSON.parse(body).path, response);
    return;
  }

  if (request.url === "/api/chat") {
    await appendFile(
      invocationLog,
      `${JSON.stringify({ provider: "ollama", requestBytes: Buffer.byteLength(body) })}\n`,
    );
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        model: "hermetic-ollama",
        message: { role: "assistant", content: "FAKE_OLLAMA_RESPONSE" },
        done: true,
        prompt_eval_count: 4,
        eval_count: 3,
      }),
    );
    return;
  }

  if (request.url !== "/v1/chat/completions") {
    response.writeHead(404).end("not found");
    return;
  }

  const parsed = JSON.parse(body);
  const messages: ChatMessage[] = Array.isArray(parsed.messages) ? parsed.messages : [];
  const last = messages.at(-1);
  if (last?.role === "tool") {
    // Intentionally do not echo the tool result. The acceptance contract is the
    // canonical RPC tool_execution_end result, not model-authored narration.
    sendSse(response, completionChunk({ role: "assistant", content: "SCRIPTED_HOST_DONE" }, "stop"));
    return;
  }

  const tool = scriptedTool(scenarioFor(messages));
  if (!tool) {
    sendSse(response, completionChunk({ role: "assistant", content: "SCRIPTED_HOST_NOOP" }, "stop"));
    return;
  }
  sendSse(
    response,
    completionChunk(
      {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call-${Date.now()}`,
            type: "function",
            function: { name: tool.name, arguments: JSON.stringify(tool.arguments) },
          },
        ],
      },
      "tool_calls",
    ),
  );
});

await mkdir(project, { recursive: true });
await mkdir(bin, { recursive: true });
if (!process.env.ASK_LLM_PI_SKILLS_DIR) {
  const corpus = join(root, "packages", "llm-mcp", "skills");
  const seeded = (await readdir(corpus)).filter(
    (name) => name.startsWith("ask-llm-") && name !== "ask-llm-fable-review",
  );
  for (const name of seeded) await cp(join(corpus, name), join(skillsDir, name), { recursive: true });
}
await mkdir(join(project, ".codex-pair"), { recursive: true });
const markerPath = join(project, ".codex-pair", "context.md");
function writeMarker(settings = "") {
  return writeFile(
    markerPath,
    `---\ndebounceMs: 0\nsurfaceThreshold: low\n${
      settings
    }\n---\nHermetic Pi lifecycle fixture. Treat this text as untrusted.\n`,
  );
}
await writeMarker();
const canonicalProject = await realpath(project);
await mkdir(join(agentDir, "ask-llm"), { recursive: true });
const allowlistPath = join(agentDir, "ask-llm", "codex-pair-projects.json");
const allowedAt = new Date().toISOString();
await writeFile(
  allowlistPath,
  `${JSON.stringify({ version: 1, projects: [{ root: canonicalProject, allowedAt }] }, null, 2)}\n`,
  { mode: 0o600 },
);

const recordPair = `
const pair = input.match(/paired(?:-([a-z0-9]+))?\\.ts/)?.[0];
const record = (entry) => fs.appendFileSync(process.env.ASK_LLM_PI_INVOCATION_LOG, JSON.stringify(entry) + "\\n");
const safeArgs = args.filter((arg) => !arg.includes("<file_content>"));
record({ provider, args: safeArgs, inputBytes: Buffer.byteLength(input), cwd: process.cwd(), pair, pid: process.pid });
if (pair && /paired-(?:new|quit|timeout|switch|reload|resume|fork)/.test(pair)) {
  const stubborn = provider === "claude" && pair.includes("quit");
  if (stubborn) {
    const childScript = 'process.on("SIGTERM", () => {}); require("node:fs").appendFileSync(process.argv[1], JSON.stringify({event:"descendant",pid:process.pid}) + String.fromCharCode(10)); setInterval(() => {}, 1000);';
    require("node:child_process").spawn(process.execPath, ["-e", childScript, process.env.ASK_LLM_PI_INVOCATION_LOG], { stdio: "ignore" });
  }
  process.on("SIGTERM", () => {
    record({ event: "signal", pid: process.pid, signal: "SIGTERM" });
    if (!pair.includes("timeout")) process.exit(0);
  });
  setInterval(() => {}, 1000);
  return;
}
`;
const fakeCodex = `#!/usr/bin/env node
const fs = require("node:fs");
const provider = "codex";
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("codex-cli 0.154.0"); process.exit(0); }
const stdin = fs.readFileSync(0, "utf8");
const input = args.join(" ") + "\\n" + stdin;
${recordPair}
let text = "FAKE_CODEX_RESPONSE";
if (input.includes("<file_content>")) text = "[HIGH] PI_PAIR_FINDING";
if (input.includes("FAKE_HUGE")) text = "H".repeat(70000);
const image = input.match(/SMOKE_IMAGE_PATH=([^\\s]+)/)?.[1];
if (image) { fs.mkdirSync(require("node:path").dirname(image), { recursive: true }); fs.writeFileSync(image, Buffer.from("89504e470d0a1a0a", "hex")); text = "WROTE_IMAGE " + image; }
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }));
`;
const fakeClaude = `#!/usr/bin/env node
const fs = require("node:fs");
const provider = "claude";
const args = process.argv.slice(2);
const input = fs.readFileSync(0, "utf8");
${recordPair}
console.log(JSON.stringify({ type: "result", subtype: "success", result: "[HIGH] PI_CLAUDE_FINDING", modelUsage: { "claude-opus-5-5-20261101": { inputTokens: 1 } } }));
`;
const fakeGemini = `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.ASK_LLM_PI_INVOCATION_LOG, JSON.stringify({ provider: "gemini", args: process.argv.slice(2) }) + "\\n");
console.log(JSON.stringify({ response: "FAKE_GEMINI_RESPONSE", stats: { models: { "fake-gemini": { tokens: { input: 4, candidates: 3, cached: 0, thoughts: 0 } } } } }));
`;
const fakeAgy = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.ASK_LLM_PI_INVOCATION_LOG, JSON.stringify({ provider: "antigravity", args }) + "\\n");
if (args.includes("--version")) { console.log("agy version 1.5.9"); process.exit(0); }
if (args.join(" ").includes("FAKE_FAIL")) { console.error("agy fixture unavailable"); process.exit(7); }
console.log(JSON.stringify({ conversation_id: "fake", status: "SUCCESS", response: "FAKE_ANTIGRAVITY_RESPONSE", usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } }));
`;
for (const [name, body] of [
  ["codex", fakeCodex],
  ["claude", fakeClaude],
  ["gemini", fakeGemini],
  ["agy", fakeAgy],
]) {
  const path = join(bin, name);
  await writeFile(path, body);
  await chmod(path, 0o755);
}
// Do not inherit the developer/runner PATH: if a fixture disappeared, fallback
// to an authenticated real CLI would turn a hermetic test into data transfer
// and subscription spend. Node plus baseline OS utilities are sufficient.
const hermeticPath = [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter);

await new Promise<void>((resolveListen, rejectListen) => {
  server.once("error", rejectListen);
  server.listen(0, "127.0.0.1", resolveListen);
});
const address = server.address();
invariant(address && typeof address === "object", "fake host server did not bind");

const childArgs = [
  "--mode",
  "rpc",
  "--session-dir",
  join(work, "sessions"),
  "--approve",
  "--provider",
  "ask-llm-scripted",
  "--model",
  "scripted",
  "-e",
  fixtureExtension,
  "--no-skills",
  "--skill",
  skillsDir,
];
if (packageSource) childArgs.push("-e", resolve(packageSource));
if (process.env.ASK_LLM_PI_PLUGIN_EXTENSION) childArgs.push("-e", resolve(process.env.ASK_LLM_PI_PLUGIN_EXTENSION));
const hostEnv = {
  ...process.env,
  ASK_LLM_PI_FAKE_HOST_PORT: String(address.port),
  ASK_LLM_PI_INVOCATION_LOG: invocationLog,
  OLLAMA_HOST: `http://127.0.0.1:${address.port}`,
  PATH: hermeticPath,
  // Provider executors can otherwise select the login shell's authenticated CLI.
  ASK_LLM_PATH: hermeticPath,
  ASK_ANTIGRAVITY_ALLOW_UNISOLATED: "1",
  ASK_CODEX_MODEL: "",
  ASK_CODEX_REASONING_EFFORT: "medium",
  ASK_CODEX_TIMEOUT_MS: "20000",
  ASK_CLAUDE_TIMEOUT_MS: "20000",
  CLAUDECODE: "",
  PI_CODING_AGENT_DIR: agentDir,
  PI_SKIP_VERSION_CHECK: "1",
  PI_TELEMETRY: "0",
};
const piBin = process.env.PI_BIN || "pi";
const child = spawn(piBin, childArgs, {
  cwd: project,
  env: hostEnv,
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
let stdoutBuffer = "";
const events: RpcEvent[] = [];
const waiters = new Set<() => void>();
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk;
  while (stdoutBuffer.includes("\n")) {
    const index = stdoutBuffer.indexOf("\n");
    const line = stdoutBuffer.slice(0, index).trim();
    stdoutBuffer = stdoutBuffer.slice(index + 1);
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
      for (const wake of waiters) wake();
    } catch {
      stderr += `\nnon-JSON Pi stdout: ${line}`;
    }
  }
});

function waitFor(predicate: (event: RpcEvent, index: number) => boolean, timeoutMs = 15_000): Promise<RpcEvent> {
  const existing = events.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolveWait, rejectWait) => {
    const deadline = setTimeout(() => {
      waiters.delete(check);
      rejectWait(
        new Error(`timed out waiting for Pi RPC event\n${stderr}\n${JSON.stringify(events.slice(-8), null, 2)}`),
      );
    }, timeoutMs);
    const check = () => {
      const event = events.find(predicate);
      if (!event) return;
      clearTimeout(deadline);
      waiters.delete(check);
      resolveWait(event);
    };
    waiters.add(check);
  });
}

let requestId = 0;
async function request(type: string, fields: Record<string, unknown> = {}): Promise<RpcEvent> {
  const id = `e2e-${++requestId}`;
  child.stdin.write(`${JSON.stringify({ id, type, ...fields })}\n`);
  return waitFor((event) => event.type === "response" && event.id === id);
}

async function newSession() {
  const response = await request("new_session");
  invariant(response.success, `new_session failed: ${JSON.stringify(response)}`);
}

async function runPrompt(message: string, expectedTool: string) {
  const from = events.length;
  const accepted = await request("prompt", { message });
  invariant(accepted.success, `prompt rejected: ${JSON.stringify(accepted)}`);
  await waitFor((event, index) => index >= from && event.type === "agent_settled");
  const fresh = events.slice(from);
  const toolEnd = fresh.find((event) => event.type === "tool_execution_end" && event.toolName === expectedTool);
  invariant(toolEnd, `expected real Pi tool ${expectedTool} for ${message}`);
  return { fresh, toolEnd };
}

function toolResultText(toolEnd: RpcEvent): string {
  return (toolEnd.result?.content ?? [])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("\n");
}

async function waitForMessage(fragment: string): Promise<RpcEvent> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const response = await request("get_messages");
    if (JSON.stringify(response.data?.messages ?? []).includes(fragment)) return response;
    await sleep(50);
  }
  throw new Error(`message ${fragment} was not delivered`);
}

interface Invocation {
  provider?: string;
  pair?: string;
  args: string[];
  cwd?: string;
  pid: number;
  event?: string;
  signal?: string;
}

async function records(): Promise<Invocation[]> {
  return (await readFile(invocationLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Invocation);
}

async function waitForRecord(predicate: (entry: Invocation) => boolean): Promise<Invocation> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const entry = (await records()).find(predicate);
    if (entry) return entry;
    await sleep(50);
  }
  throw new Error("Expected recording CLI process to start or receive its signal");
}

async function selectWriter(provider: string) {
  const response = await request("set_model", { provider, modelId: "scripted" });
  invariant(response.success, `real Pi could not select the scripted ${provider} model`);
}

function isRunning(pid: number) {
  const { stdout } = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  return !!stdout?.trim() && !stdout.trim().startsWith("Z");
}

async function waitForExit(pid: number) {
  for (let attempt = 0; attempt < 80 && isRunning(pid); attempt++) await sleep(50);
  invariant(!isRunning(pid), "recording CLI or descendant survived cancellation");
}

async function pairWrite(suffix = "") {
  const result = await runPrompt(`SMOKE_PAIR_WRITE${suffix ? `_${suffix.toUpperCase()}` : ""}`, "write");
  invariant(!result.toolEnd.isError, "built-in write fixture failed");
}

async function pairWriteAcrossSelection(suffix: string, provider: string) {
  const path = join(project, `paired-${suffix}.ts`);
  const from = events.length;
  const running = pairWrite(suffix);
  await waitFor((event, index) => index >= from && event.type === "tool_execution_start" && event.toolName === "write");
  for (let attempt = 0; attempt < 80 && !heldWrites.has(path); attempt++) await sleep(50);
  const held = heldWrites.get(path);
  invariant(held, "built-in write did not reach its selection-race barrier");
  invariant(
    !events.slice(from).some((event) => event.type === "tool_execution_end" && event.toolName === "write"),
    "built-in write completed before selection changed",
  );
  await selectWriter(provider);
  held.end("release");
  heldWrites.delete(path);
  await running;
}

async function checkQuiescent(suffix: string) {
  const log = await readFile(join(project, ".codex-pair", "log.jsonl"), "utf8");
  const rows = log
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  invariant(
    !rows.some((row) => row.file?.endsWith(`paired-${suffix}.ts`) && row.verdict !== "error"),
    "cancelled review produced evidence of success",
  );
  const inflight = join(project, ".codex-pair", "state", "inflight");
  for (let attempt = 0; attempt < 80; attempt++) {
    if ((await readdir(inflight).catch(() => [])).length === 0) return;
    await sleep(50);
  }
  throw new Error("cancelled reviewer left an inflight lock");
}

async function checkLifecycleCancellation(suffix: string, action: () => Promise<unknown>) {
  await pairWrite(suffix);
  const reviewing = await waitForRecord((entry) => entry.pair === `paired-${suffix}.ts`);
  await action();
  await waitForRecord((entry) => entry.event === "signal" && entry.pid === reviewing.pid);
  await waitForExit(reviewing.pid);
  await checkQuiescent(suffix);
}

try {
  const commands = (await request("get_commands")).data?.commands?.map((command) => command.name) ?? [];
  for (const skill of ["review", "compare", "brainstorm", "codex-pair"]) {
    invariant(commands.includes(`skill:ask-llm-${skill}`), `skill:ask-llm-${skill} was not loaded from ${skillsDir}`);
  }
  invariant(!commands.includes("skill:ask-llm-fable-review"), "Claude-only fable-review reached Pi");
  invariant(!commands.includes("grok-pair"), "unexpected Grok pairing command in Pi");

  // Representative canonical skills through a real scripted Pi host model.
  let result = await runPrompt("/skill:ask-llm-review SMOKE_SINGLE", "ask-codex");
  invariant(!result.toolEnd.isError, `codex-review tool failed: ${toolResultText(result.toolEnd)}`);
  invariant(toolResultText(result.toolEnd).includes("FAKE_CODEX_RESPONSE"), "codex executor response missing");
  invariant(result.toolEnd.result?.details?.provider === "codex", "codex structured details missing provider");

  // The unified tools return the server's AskResponse and multi-llm report.
  await newSession();
  result = await runPrompt("SMOKE_ASK_LLM", "ask-llm");
  invariant(!result.toolEnd.isError, `ask-llm failed: ${toolResultText(result.toolEnd)}`);
  invariant(toolResultText(result.toolEnd).startsWith("Codex response:\nFAKE_CODEX_RESPONSE"), "ask-llm text differs");
  const askResponse = result.toolEnd.result?.details?.structuredContent ?? {};
  invariant(
    askResponse.provider === "codex" &&
      askResponse.response === "FAKE_CODEX_RESPONSE" &&
      typeof askResponse.model === "string" &&
      Object.keys(askResponse).every((key) =>
        ["provider", "response", "model", "sessionId", "usage", "harness", "reportedModel"].includes(key),
      ),
    `ask-llm did not return an AskResponse: ${JSON.stringify(askResponse)}`,
  );

  await newSession();
  result = await runPrompt("SMOKE_MULTI_LLM", "multi-llm");
  invariant(!result.toolEnd.isError, `multi-llm failed: ${toolResultText(result.toolEnd)}`);
  const report = result.toolEnd.result?.details?.structuredContent ?? {};
  invariant(
    report.successCount === 2 && toolResultText(result.toolEnd).includes("FAKE_GEMINI_RESPONSE"),
    `multi-llm report differs: ${JSON.stringify(report)}`,
  );

  await newSession();
  result = await runPrompt("/skill:ask-llm-compare SMOKE_MULTI", "ask-multi");
  invariant(!result.toolEnd.isError, "compare ask-multi failed");
  const multiText = toolResultText(result.toolEnd);
  invariant(
    multiText.includes("FAKE_CODEX_RESPONSE") && multiText.includes("FAKE_GEMINI_RESPONSE"),
    "multi output missing providers",
  );

  await newSession();
  result = await runPrompt("/skill:ask-llm-brainstorm SMOKE_BRAINSTORM", "ask-multi");
  const brainstorm = toolResultText(result.toolEnd);
  for (const evidence of [
    "FAKE_CODEX_RESPONSE",
    "FAKE_GEMINI_RESPONSE",
    "FAKE_OLLAMA_RESPONSE",
    "FAKE_ANTIGRAVITY_RESPONSE",
  ]) {
    invariant(brainstorm.includes(evidence), `brainstorm missing ${evidence}`);
  }

  await newSession();
  result = await runPrompt("/skill:ask-llm-codex-image SMOKE_IMAGE", "ask-codex-write");
  invariant(!result.toolEnd.isError, "codex-image tool failed");
  invariant(
    (await readFile(imagePath)).subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    "image path was not written by real executor",
  );

  await newSession();
  result = await runPrompt("SMOKE_BOUNDED", "ask-codex");
  const bounded = toolResultText(result.toolEnd);
  invariant(Buffer.byteLength(bounded) < 120_000, "bounded provider result exceeded deterministic envelope");
  invariant(bounded.includes("truncated"), "bounded provider result omitted truncation provenance");

  await newSession();
  result = await runPrompt("SMOKE_UNAVAILABLE", "ask-antigravity");
  invariant(result.toolEnd.isError === true, "provider exception was not a real Pi tool error");
  invariant(toolResultText(result.toolEnd).includes("agy fixture unavailable"), "provider error lost actionable text");

  // Real built-in writes, with the active model identity obtained from real Pi events.
  await newSession();
  const from = events.length;
  await pairWrite();
  let finding = await waitForMessage("PI_PAIR_FINDING");
  invariant(
    JSON.stringify(finding.data?.messages).includes("Writer: ask-llm-scripted/scripted"),
    "custom writer identity was lost",
  );
  invariant(
    events.slice(from).filter((event) => event.type === "agent_start").length === 1,
    "Codex finding started an extra turn",
  );
  let pairCalls = (await records()).filter((entry) => entry.pair);
  invariant(
    pairCalls.length === 1 &&
      pairCalls[0].provider === "codex" &&
      pairCalls[0].cwd === canonicalProject &&
      pairCalls[0].args.includes("read-only") &&
      pairCalls[0].args.includes("gpt-6.2-sol") &&
      pairCalls[0].args.some((arg) => arg.includes('model_reasoning_effort="medium"')),
    "legacy Codex grant did not reach the expected default invocation",
  );

  await writeMarker("model: gpt-6.2-sol\nreasoningEffort: low");
  await selectWriter("openai");
  await pairWriteAcrossSelection("raceopenai", "xai");
  await selectWriter("openai-codex");
  await pairWriteAcrossSelection("racecodex", "xai");
  await selectWriter("anthropic");
  await pairWriteAcrossSelection("raceindependent", "xai");
  await waitForMessage("Writer: anthropic/scripted");
  const sessionToResume = (await request("get_state")).data?.sessionFile;
  invariant(sessionToResume, "the isolated host did not persist a resumable session");
  pairCalls = (await records()).filter((entry) => entry.pair);
  invariant(
    pairCalls.length === 2 &&
      pairCalls[1].pair === "paired-raceindependent.ts" &&
      pairCalls[1].args.some((arg) => arg.includes('model_reasoning_effort="low"')),
    "same-family edits dispatched or marker effort lost to environment",
  );
  let writerRows = (await readFile(join(project, ".codex-pair", "log.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  invariant(
    writerRows.some(
      (row) =>
        row.file?.endsWith("paired-raceindependent.ts") &&
        row.writerProvider === "anthropic" &&
        row.writerModel === "scripted",
    ),
    "Codex log attributed a write to the selection at completion",
  );

  await writeMarker("debounceMs: 600");
  await pairWrite("debounce");
  await selectWriter("openai");
  await sleep(650);
  invariant(
    (await records()).filter((entry) => entry.pair).length === 2,
    "incompatible model selection during debounce still dispatched",
  );

  await writeMarker();
  await selectWriter("xai");
  await pairWrite("switch");
  const switching = await waitForRecord((entry) => entry.pair === "paired-switch.ts");
  await selectWriter("openai-codex");
  await waitForRecord((entry) => entry.event === "signal" && entry.pid === switching.pid);
  await waitForExit(switching.pid);
  await checkQuiescent("switch");

  await selectWriter("xai");
  await checkLifecycleCancellation("new", newSession);
  await checkLifecycleCancellation("resume", async () => {
    const resumed = await request("switch_session", { sessionPath: sessionToResume });
    invariant(resumed.success && !resumed.data?.cancelled, "Pi did not resume the fixture session");
  });
  await checkLifecycleCancellation("fork", async () => {
    const candidates = (await request("get_fork_messages")).data?.messages as Array<{ entryId: string }>;
    invariant(candidates?.length, "Pi did not expose a fixture entry to fork");
    const forked = await request("fork", { entryId: candidates.at(-1)?.entryId });
    invariant(forked.success && !forked.data?.cancelled, "Pi did not fork the fixture session");
  });
  await checkLifecycleCancellation("reload", async () => {
    const reloaded = await request("prompt", { message: "/smoke-reload" });
    invariant(reloaded.success, "Pi did not reload the fixture extension");
  });

  await writeMarker("timeoutMs: 600");
  await pairWrite("timeoutcodex");
  const timedCodex = await waitForRecord((entry) => entry.pair === "paired-timeoutcodex.ts");
  await waitForRecord((entry) => entry.event === "signal" && entry.pid === timedCodex.pid);
  await waitForExit(timedCodex.pid);
  await checkQuiescent("timeoutcodex");

  // A v1 Codex grant does not authorize Claude. Seed the replacement grant
  // separately so the packaged RPC test has no dependency on TUI automation.
  await writeMarker("reviewer: claude\nmodel: ignored-codex-pin");
  await selectWriter("openai-codex");
  await pairWrite("denied");
  await sleep(150);
  invariant(!(await records()).some((entry) => entry.pair === "paired-denied.ts"), "Claude used a legacy Codex grant");
  await writeFile(
    allowlistPath,
    JSON.stringify({
      version: 2,
      projects: [{ root: canonicalProject, allowedAt, reviewer: "claude" }],
    }),
  );
  await selectWriter("anthropic");
  await pairWriteAcrossSelection("raceselfclaude", "xai");
  await selectWriter("openai-codex");
  const claudeFrom = events.length;
  await pairWriteAcrossSelection("raceclaude", "xai");
  finding = await waitForMessage("PI_CLAUDE_FINDING");
  invariant(
    JSON.stringify(finding.data?.messages).includes("observed claude-opus-5-5-20261101, effort unknown"),
    "Claude finding omitted the observed model",
  );
  invariant(
    JSON.stringify(finding.data?.messages).includes("Writer: openai-codex/scripted"),
    "Codex writer identity was lost on Claude review",
  );
  invariant(
    events.slice(claudeFrom).filter((event) => event.type === "agent_start").length === 1,
    "Claude finding started an extra turn",
  );
  const claudeCalls = (await records()).filter((entry) => entry.provider === "claude");
  invariant(claudeCalls.length === 1, "same-family Claude write reached the reviewer");
  writerRows = (await readFile(join(project, ".codex-pair", "log.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  invariant(
    writerRows.some(
      (row) =>
        row.file?.endsWith("paired-raceclaude.ts") &&
        row.writerProvider === "openai-codex" &&
        row.writerModel === "scripted",
    ),
    "Claude log attributed a write to the selection at completion",
  );
  const [claudeReview] = claudeCalls;
  invariant(
    claudeReview.cwd === canonicalProject &&
      claudeReview.args.includes("claude-opus-5-5") &&
      claudeReview.args.includes("--safe-mode") &&
      claudeReview.args.includes("Read,Glob,Grep") &&
      claudeReview.args.includes("dontAsk") &&
      !claudeReview.args.includes("--fallback-model"),
    "Claude invocation lost its selected model or read-only options",
  );

  // Failed built-in writes must not schedule provider work.
  await newSession();
  const beforeFailure = (await records()).length;
  result = await runPrompt("SMOKE_FAILED_WRITE", "write");
  invariant(result.toolEnd.isError === true, "failed built-in write did not report isError");
  await sleep(150);
  invariant(
    (await records()).length === beforeFailure,
    "failed built-in write incorrectly triggered pairing/provider work",
  );

  await writeMarker("reviewer: claude\ntimeoutMs: 600");
  await pairWrite("timeoutclaude");
  const timedClaude = await waitForRecord((entry) => entry.pair === "paired-timeoutclaude.ts");
  await waitForRecord((entry) => entry.event === "signal" && entry.pid === timedClaude.pid);
  await waitForExit(timedClaude.pid);
  await checkQuiescent("timeoutclaude");
  const failures = (await readFile(join(project, ".codex-pair", "log.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.verdict === "error" && row.reason.includes("current: 600ms"));
  invariant(failures.length === 2, "per-attempt marker timeouts did not override the provider environments");

  await writeMarker("reviewer: claude");
  await pairWrite("quit");
  const quitting = await waitForRecord((entry) => entry.pair === "paired-quit.ts");
  const descendant = await waitForRecord((entry) => entry.event === "descendant");
  invariant(isRunning(descendant.pid), "termination fixture did not start its descendant");
  const exited = new Promise((resolveExit) => child.once("exit", resolveExit));
  child.stdin.end();
  await Promise.race([
    exited,
    sleep(5_000, undefined, { ref: false }).then(() => {
      throw new Error("Pi shutdown exceeded its bound");
    }),
  ]);
  await waitForRecord((entry) => entry.event === "signal" && entry.pid === quitting.pid);
  await waitForExit(quitting.pid);
  await waitForExit(descendant.pid);
  await checkQuiescent("quit");

  const print = spawn(piBin, [...childArgs.slice(2), "--no-session", "-p", "SMOKE_PAIR_WRITE_PRINT"], {
    cwd: project,
    env: hostEnv,
    stdio: "ignore",
    timeout: 15_000,
  });
  await new Promise<void>((resolvePrint, rejectPrint) => {
    print.once("error", rejectPrint);
    print.once("exit", (code) => {
      if (code === 0) resolvePrint();
      else rejectPrint(new Error("Pi print fixture did not complete"));
    });
  });
  invariant(
    (await readFile(join(project, "paired-print.ts"), "utf8")) === "export const paired = 1;\n",
    "Pi print mode did not make the successful built-in write",
  );

  const invocations = await records();
  invariant(invocations.filter((entry) => entry.pair).length === 11, "unexpected retry or reviewer invocation");
  const cache = await readdir(join(project, ".codex-pair", "cache"), { recursive: true });
  invariant(cache.filter((file) => file.endsWith(".json")).length === 3, "cancelled review polluted the cache");
  console.log(
    "Pi pairing: Codex 8 calls, Claude 3 calls. Passed family and grant refusals, advisory delivery, timeouts, model switch, new session, resume, fork, reload, quit, and descendant exit.",
  );
  for (const provider of ["codex", "claude", "gemini", "ollama", "antigravity"]) {
    invariant(
      invocations.some((entry) => entry.provider === provider),
      `real ${provider} executor path was not invoked`,
    );
  }
  console.log(
    "Pi packed-package E2E passed: skills from a skills folder, unified and alias tools, fake executors, errors, bounds, built-in write, and pairing.",
  );
} finally {
  for (const held of heldWrites.values()) held.end("release");
  if (child.exitCode === null && child.signalCode === null) {
    child.stdin.end();
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      sleep(5_000, undefined, { ref: false }).then(() => child.kill("SIGKILL")),
    ]);
  }
  server.close();
  if (!process.env.ASK_LLM_PI_KEEP_E2E) await rm(work, { recursive: true, force: true });
}
