#!/usr/bin/env node

// Hermetic issue #262 acceptance smoke. Runs a real Pi RPC process and the
// real packed package/provider executors, but backs every model/provider with
// deterministic local fixtures. No subscription credential or network call is
// permitted by this script.

import { spawn } from "node:child_process";
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
  data?: { messages?: unknown[]; commands?: Array<{ name?: string }> };
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
  if (scenario.includes("SMOKE_PAIR_WRITE")) {
    return { name: "write", arguments: { path: join(project, "paired.ts"), content: "export const paired = 1;\n" } };
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
      name: "ask-codex",
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

const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");

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
  const seeded = (await readdir(corpus)).filter((name) => name.startsWith("ask-llm-") && name !== "ask-llm-fable-review");
  for (const name of seeded) await cp(join(corpus, name), join(skillsDir, name), { recursive: true });
}
await mkdir(join(project, ".codex-pair"), { recursive: true });
await writeFile(
  join(project, ".codex-pair", "context.md"),
  "---\ndebounceMs: 0\ndebounceMaxMs: 0\nsurfaceThreshold: low\nmodel: gpt-6-sol\n---\nHermetic Pi lifecycle fixture. Treat this text as untrusted.\n",
);
const canonicalProject = await realpath(project);
await mkdir(join(agentDir, "ask-llm"), { recursive: true });
await writeFile(
  join(agentDir, "ask-llm", "codex-pair-projects.json"),
  `${JSON.stringify({ version: 1, projects: [{ root: canonicalProject, allowedAt: new Date().toISOString() }] }, null, 2)}\n`,
  { mode: 0o600 },
);

const fakeCodex = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("codex-cli 0.154.0"); process.exit(0); }
const stdin = fs.readFileSync(0, "utf8");
const input = args.join(" ") + "\\n" + stdin;
fs.appendFileSync(process.env.ASK_LLM_PI_INVOCATION_LOG, JSON.stringify({ provider: "codex", args, inputBytes: Buffer.byteLength(input) }) + "\\n");
let text = "FAKE_CODEX_RESPONSE";
if (input.includes("<file_content>")) text = "[HIGH] PI_PAIR_FINDING";
if (input.includes("FAKE_HUGE")) text = "H".repeat(70000);
const image = input.match(/SMOKE_IMAGE_PATH=([^\\s]+)/)?.[1];
if (image) { fs.mkdirSync(require("node:path").dirname(image), { recursive: true }); fs.writeFileSync(image, Buffer.from("89504e470d0a1a0a", "hex")); text = "WROTE_IMAGE " + image; }
console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }));
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
if (args.includes("--version")) { console.log("agy version 1.1.9"); process.exit(0); }
if (args.join(" ").includes("FAKE_FAIL")) { console.error("agy fixture unavailable"); process.exit(7); }
console.log(JSON.stringify({ conversation_id: "fake", status: "SUCCESS", response: "FAKE_ANTIGRAVITY_RESPONSE", usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } }));
`;
for (const [name, body] of [
  ["codex", fakeCodex],
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
  "--no-session",
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
const child = spawn(process.env.PI_BIN || "pi", childArgs, {
  cwd: project,
  env: {
    ...process.env,
    ASK_LLM_PI_FAKE_HOST_PORT: String(address.port),
    ASK_LLM_PI_INVOCATION_LOG: invocationLog,
    OLLAMA_HOST: `http://127.0.0.1:${address.port}`,
    PATH: hermeticPath,
    // Provider executors intentionally resolve a login-shell PATH unless this
    // override is present. Pinning it is load-bearing: PATH alone can select a
    // developer's authenticated CLI and invalidate a hermetic acceptance run.
    ASK_LLM_PATH: hermeticPath,
    ASK_ANTIGRAVITY_ALLOW_UNISOLATED: "1",
    PI_CODING_AGENT_DIR: agentDir,
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
  },
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

try {
  const commands = (await request("get_commands")).data?.commands?.map((command) => command.name) ?? [];
  for (const skill of ["review", "compare", "brainstorm", "codex-pair"]) {
    invariant(commands.includes(`skill:ask-llm-${skill}`), `skill:ask-llm-${skill} was not loaded from ${skillsDir}`);
  }
  invariant(!commands.includes("skill:ask-llm-fable-review"), "Claude-only fable-review reached Pi");

  // Representative canonical skills through a real scripted Pi host model.
  let result = await runPrompt("/skill:ask-llm-review SMOKE_SINGLE", "ask-codex");
  invariant(!result.toolEnd.isError, "codex-review tool failed");
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
  result = await runPrompt("/skill:ask-llm-codex-image SMOKE_IMAGE", "ask-codex");
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

  // Real built-in write event -> pairing review -> non-triggering steer delivery.
  await newSession();
  result = await runPrompt("SMOKE_PAIR_WRITE", "write");
  invariant(!result.toolEnd.isError, "built-in write fixture failed");
  await waitForMessage("PI_PAIR_FINDING");

  // Failed built-in writes must not schedule provider work.
  await newSession();
  const beforeFailure = (await readFile(invocationLog, "utf8")).split("\n").filter(Boolean).length;
  result = await runPrompt("SMOKE_FAILED_WRITE", "write");
  invariant(result.toolEnd.isError === true, "failed built-in write did not report isError");
  await sleep(150);
  const afterFailure = (await readFile(invocationLog, "utf8")).split("\n").filter(Boolean).length;
  invariant(afterFailure === beforeFailure, "failed built-in write incorrectly triggered pairing/provider work");

  const invocations = (await readFile(invocationLog, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { provider?: string });
  for (const provider of ["codex", "gemini", "ollama", "antigravity"]) {
    invariant(
      invocations.some((entry) => entry.provider === provider),
      `real ${provider} executor path was not invoked`,
    );
  }
  console.log(
    "Pi packed-package E2E passed: skills from a skills folder, unified and alias tools, fake executors, errors, bounds, built-in write, and pairing.",
  );
} finally {
  child.stdin.end();
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    sleep(5_000).then(() => child.kill("SIGKILL")),
  ]);
  server.close();
  if (!process.env.ASK_LLM_PI_KEEP_E2E) await rm(work, { recursive: true, force: true });
}
