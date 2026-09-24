import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createServer, type Socket } from "node:net";
import { expect, it } from "vitest";
import {
  chooseTransport,
  createIsolatedBrokerHome,
  removeIsolatedBrokerHome,
  writeBrokerDescriptor,
} from "../../scripts/lib/broker-lifecycle.mjs";
import { PLUGIN_ROOT } from "./_helpers.js";

type Scenario = "timeout" | "rejection" | "missing_id" | "start_close" | "completion_close";

it.each<Scenario>(["timeout", "rejection", "missing_id", "start_close", "completion_close"])(
  "runs direct review after fake app-server %s",
  async (scenario) => {
    const repo = fs.mkdtempSync(path.join("/tmp", "cpb-"));
    const home = createIsolatedBrokerHome({ sourceHome: repo });
    const stateDir = path.join(repo, ".codex-pair", "state");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(repo, ".codex-pair", "context.md"), "---\ndebounceMs: 0\ntimeoutMs: 750\n---\n# test");
    const edited = path.join(repo, "edited.ts");
    fs.writeFileSync(edited, "export const value = 1;\n");
    const transportUrl = chooseTransport(repo);
    const sockets = new Set<Socket>();
    const methods: string[] = [];
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
          const reply = (result: unknown, error?: unknown) => {
            const body = Buffer.from(JSON.stringify({ id: message.id, ...(error ? { error } : { result }) }));
            socket.write(
              Buffer.concat([
                body.length < 126
                  ? Buffer.from([0x81, body.length])
                  : Buffer.from([0x81, 126, body.length >> 8, body.length & 255]),
                body,
              ]),
            );
          };
          if (message.method === "initialize") reply({});
          if (message.method === "thread/start") reply({ thread: { id: "thread-1" } });
          if (message.method === "turn/start") {
            if (scenario === "rejection") reply(null, { code: -32602, message: "Invalid params" });
            else if (scenario === "missing_id") reply({ turn: {} });
            else if (scenario === "start_close") socket.destroy();
            else {
              reply({ turn: { id: "turn-1" } });
              if (scenario === "completion_close") setImmediate(() => socket.destroy());
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
      const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, "scripts", "codex-pair-watch.mjs")], {
        cwd: repo,
        env: {
          ...process.env,
          PATH: `${path.join(PLUGIN_ROOT, "src", "__tests__", "_fixtures")}:${process.env.PATH}`,
          FAKE_CODEX_SCENARIO: "none",
          ASK_CODEX_DEBOUNCE_MS: "0",
        },
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
      expect(stderr).toBe("");
      const log = fs
        .readFileSync(path.join(repo, ".codex-pair", "log.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      expect(log.some((entry) => entry.verdict === "broker_fallback")).toBe(true);
      expect(log.some((entry) => entry.verdict === "none")).toBe(true);
      expect(methods).toContain("turn/start");
      if (scenario === "timeout") expect(methods).toContain("turn/interrupt");
    } finally {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      removeIsolatedBrokerHome(home);
      fs.rmSync(repo, { recursive: true, force: true });
    }
  },
  15_000,
);
