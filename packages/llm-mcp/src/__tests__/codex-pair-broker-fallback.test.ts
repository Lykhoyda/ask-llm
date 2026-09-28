import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createServer, type Socket } from "node:net";
import * as path from "node:path";
import { expect, it } from "vitest";
import {
  chooseTransport,
  createIsolatedBrokerHome,
  removeIsolatedBrokerHome,
  writeBrokerDescriptor,
} from "../../scripts/lib/broker-lifecycle.mts";
import { PLUGIN_ROOT } from "./_helpers.js";

type Scenario = "timeout" | "rejection" | "missing_id" | "start_close" | "completion_close" | { failedTurn: string };

interface EditOutcome {
  log: Array<{ verdict: string; fellBack?: boolean; durationMs?: number }>;
  methods: string[];
  execAttempts: number;
  paused: boolean;
  stderr: string;
  gates: Array<{ decision?: string; reason?: string }>;
}

interface EditOptions {
  seedAttempts?: number;
  marker?: string;
}

const STOP_GATE_PATH = path.join(PLUGIN_ROOT, "scripts", "codex-pair-stop-gate.mjs");

function runStopGate(repo: string): { decision?: string; reason?: string } {
  const result = spawnSync(process.execPath, [STOP_GATE_PATH], {
    input: JSON.stringify({ hook_event_name: "Stop" }),
    cwd: repo,
    encoding: "utf-8",
    timeout: 10_000,
  });
  return JSON.parse(result.stdout.trim() || "{}");
}

function frame(body: Buffer): Buffer {
  const header =
    body.length < 126
      ? Buffer.from([0x81, body.length])
      : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]);
  return Buffer.concat([header, body]);
}

async function runBrokerEdit(
  scenario: Scenario,
  fakeCodexScenario: string,
  { seedAttempts = 0, marker = "timeoutMs: 750" }: EditOptions = {},
): Promise<EditOutcome> {
  const repo = fs.mkdtempSync(path.join("/tmp", "cpb-"));
  fs.writeFileSync(path.join(repo, "auth.json"), "{}");
  const home = createIsolatedBrokerHome({ sourceHome: repo });
  fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), `---\ndebounceMs: 0\n${marker}\n---\n# test`);
  const edited = path.join(repo, "edited.ts");
  fs.writeFileSync(edited, "export const value = 1;\n");
  const attempts = path.join(repo, "attempts");
  if (seedAttempts > 0) fs.writeFileSync(attempts, String(seedAttempts));
  const transportUrl = chooseTransport(home);
  const sockets = new Set<Socket>();
  const methods: string[] = [];
  const gates: EditOutcome["gates"] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    let upgraded = false;
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!upgraded) {
        const end = buffer.indexOf("\r\n\r\n");
        if (end < 0) return;
        const key = buffer
          .subarray(0, end)
          .toString()
          .match(/Sec-WebSocket-Key:\s*(.+)/i)?.[1]
          ?.trim();
        if (!key) return socket.destroy();
        const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
        );
        buffer = buffer.subarray(end + 4);
        upgraded = true;
      }
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 0x0f;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;
          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const masked = (buffer[1] & 0x80) !== 0;
        if (buffer.length < offset + (masked ? 4 : 0) + length) return;
        if (opcode !== 1) {
          buffer = buffer.subarray(offset + (masked ? 4 : 0) + length);
          continue;
        }
        const mask = masked ? buffer.subarray(offset, offset + 4) : null;
        if (mask) offset += 4;
        const payload = Buffer.from(buffer.subarray(offset, offset + length));
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        buffer = buffer.subarray(offset + length);
        const message = JSON.parse(payload.toString());
        methods.push(message.method);
        if (message.id == null) continue;
        const send = (envelope: unknown) => socket.write(frame(Buffer.from(JSON.stringify(envelope))));
        const reply = (result: unknown, error?: unknown) =>
          send({ id: message.id, ...(error ? { error } : { result }) });
        if (message.method === "initialize") reply({});
        if (message.method === "thread/start") reply({ thread: { id: "thread-1" } });
        if (message.method === "turn/start") {
          if (scenario === "rejection") reply(null, { code: -32602, message: "Invalid params" });
          else if (scenario === "missing_id") reply({ turn: {} });
          else if (scenario === "start_close") socket.destroy();
          else {
            reply({ turn: { id: "turn-1" } });
            if (scenario === "timeout" && marker.includes("blockOn")) gates.push(runStopGate(repo));
            if (scenario === "completion_close") setImmediate(() => socket.destroy());
            if (typeof scenario === "object") {
              send({
                method: "turn/completed",
                params: {
                  threadId: "thread-1",
                  turn: { id: "turn-1", status: "failed", error: { message: scenario.failedTurn }, items: [] },
                },
              });
            }
          }
        }
        if (message.method === "turn/interrupt") reply({});
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(transportUrl.slice("unix://".length), () => {
        server.off("error", reject);
        resolve();
      });
    });
    await writeBrokerDescriptor(repo, {
      pid: process.pid,
      transportUrl,
      protocolVersion: "v2",
      isolatedHome: home,
      sessionId: "broker-test",
    });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CODEX_HOME: repo,
      PATH: `${path.join(PLUGIN_ROOT, "src", "__tests__", "_fixtures")}:${process.env.PATH}`,
      FAKE_CODEX_SCENARIO: fakeCodexScenario,
      FAKE_CODEX_ATTEMPT_FILE: attempts,
      ASK_CODEX_DEBOUNCE_MS: "0",
    };
    env.ASK_CODEX_BROKER = "1";
    const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, "scripts", "codex-pair-watch.mjs")], {
      cwd: repo,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.stdout.resume();
    child.stdin.end(
      JSON.stringify({ tool_name: "Edit", tool_input: { file_path: edited }, session_id: "broker-test" }),
    );
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("hook timed out"));
      }, 10_000);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
      child.once("error", reject);
    });
    expect(exitCode).toBe(0);
    if (marker.includes("blockOn")) gates.push(runStopGate(repo));
    return {
      log: fs
        .readFileSync(path.join(repo, ".codex-pair", "log.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line)),
      methods,
      execAttempts: fs.existsSync(attempts) ? Number(fs.readFileSync(attempts, "utf8")) : 0,
      paused: fs.existsSync(path.join(repo, ".codex-pair", "state", "paused")),
      stderr,
      gates,
    };
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    removeIsolatedBrokerHome(home);
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

it.each<Scenario>(["timeout", "rejection", "missing_id", "start_close", "completion_close"])(
  "runs direct review after fake app-server %s",
  async (scenario) => {
    const { log, methods, stderr } = await runBrokerEdit(scenario, "none");
    expect(stderr).toBe("");
    expect(log.some((entry) => entry.verdict === "broker_fallback")).toBe(true);
    expect(log.some((entry) => entry.verdict === "none")).toBe(true);
    expect(methods).toContain("turn/start");
    if (scenario === "timeout") expect(methods).toContain("turn/interrupt");
  },
  15_000,
);

it("sends a broker quota error through the direct fallback-model ladder instead of pausing", async () => {
  const { log, execAttempts, paused } = await runBrokerEdit(
    { failedTurn: "You've hit your usage limit. Try again in 3 hours 25 minutes." },
    "quota-plan-recover",
    { seedAttempts: 1 },
  );
  expect(log.map((entry) => entry.verdict)).toEqual(["broker_fallback", "none"]);
  expect(log[1].fellBack).toBe(true);
  // One direct call, on the fallback model: the exhausted primary is not asked again.
  expect(execAttempts).toBe(2);
  expect(paused).toBe(false);
}, 15_000);

it("retries a transient broker provider error once through direct review", async () => {
  const recovered = await runBrokerEdit({ failedTurn: "unexpected status 503 Service Unavailable" }, "none");
  expect(recovered.log.map((entry) => entry.verdict)).toEqual(["broker_fallback", "none"]);
  const stillFailing = await runBrokerEdit({ failedTurn: "unexpected status 503 Service Unavailable" }, "transient");
  expect(stillFailing.log.map((entry) => entry.verdict)).toEqual(["broker_fallback", "error"]);
  expect(stillFailing.execAttempts).toBe(1);
}, 15_000);

it("does not re-run a genuine broker model error through direct review", async () => {
  const { log, execAttempts } = await runBrokerEdit(
    { failedTurn: "invalid_request_error: the input exceeds the model context window" },
    // Counts every direct invocation, so an unwanted re-run would show up.
    "transient",
  );
  expect(log.map((entry) => entry.verdict)).toEqual(["error"]);
  expect(execAttempts).toBe(0);
}, 15_000);

it("finishes a stalled broker turn's direct fallback within one review timeout and gates on its HIGH", async () => {
  const timeoutMs = 4000;
  const { log, gates } = await runBrokerEdit("timeout", "concerns-labeled", {
    marker: `timeoutMs: ${timeoutMs}\nblockOn: HIGH`,
  });
  expect(log.map((entry) => entry.verdict)).toEqual(["broker_fallback", "concerns"]);
  expect(log[1].durationMs).toBeLessThan(timeoutMs);
  expect(gates[0]).toMatchObject({ decision: "block", reason: expect.stringMatching(/in flight/i) });
  expect(gates[1]).toMatchObject({ decision: "block", reason: expect.stringMatching(/critical issue summary/) });
}, 15_000);
