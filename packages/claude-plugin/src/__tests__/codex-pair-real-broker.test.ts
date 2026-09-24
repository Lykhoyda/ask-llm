import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it } from "vitest";
import { initializeBroker } from "../../scripts/lib/broker.mjs";
import {
  chooseTransport,
  createIsolatedBrokerHome,
  pollSocketReachable,
  removeIsolatedBrokerHome,
  spawnBroker,
} from "../../scripts/lib/broker-lifecycle.mjs";

const enabled =
  process.env.CODEX_PAIR_REAL_BROKER_TEST === "1" &&
  spawnSync("codex", ["--version"], { stdio: "ignore" }).status === 0;

it.skipIf(!enabled)(
  "keeps real app-server hooks and MCP servers out while completing an authenticated turn",
  async () => {
    const root = fs.mkdtempSync(path.join("/tmp", "cp-real-broker-"));
    const controlHome = path.join(root, "control-home");
    const controlRepo = path.join(root, "control-repo");
    const isolatedRepo = path.join(root, "isolated-repo");
    const sourceHome = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
    const authFile = path.join(sourceHome, "auth.json");
    const children: ChildProcess[] = [];
    let isolatedHome: string | undefined;
    try {
      expect(fs.existsSync(authFile)).toBe(true);
      for (const dir of [controlHome, controlRepo, isolatedRepo]) fs.mkdirSync(dir);
      for (const repo of [controlRepo, isolatedRepo]) {
        fs.mkdirSync(path.join(repo, ".codex-pair", "state"), { recursive: true });
      }
      fs.symlinkSync(fs.realpathSync(authFile), path.join(controlHome, "auth.json"));
      fs.writeFileSync(
        path.join(controlHome, "hooks.json"),
        JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "true" }] }] } }),
      );
      fs.writeFileSync(
        path.join(controlHome, "config.toml"),
        '[features]\napps = false\n[mcp_servers.marker]\ncommand = "/nonexistent-codex-pair-marker"\n',
      );
      isolatedHome = createIsolatedBrokerHome({ sourceHome });
      const controlUrl = chooseTransport(controlRepo);
      const isolatedUrl = chooseTransport(isolatedRepo);
      const control = spawn("codex", ["--dangerously-bypass-hook-trust", "app-server", "--listen", controlUrl], {
        env: { ...process.env, CODEX_HOME: controlHome },
        stdio: "ignore",
      });
      children.push(control);
      const isolated = spawnBroker(isolatedRepo, isolatedUrl, isolatedHome);
      children.push(isolated);
      expect(await pollSocketReachable(controlUrl, 10_000)).toBe(true);
      expect(await pollSocketReachable(isolatedUrl, 10_000)).toBe(true);
      const clientInfo = { name: "codex-pair-isolation-test", title: "codex-pair isolation test", version: "1" };
      const controlRpc = await initializeBroker(controlUrl, clientInfo);
      const isolatedRpc = await initializeBroker(isolatedUrl, clientInfo);
      try {
        expect(fs.realpathSync(isolatedRpc.initializeResult.codexHome)).toBe(fs.realpathSync(isolatedHome));
        const controlHooks = await controlRpc.rpc.request("hooks/list", { cwds: [controlRepo] });
        const isolatedHooks = await isolatedRpc.rpc.request("hooks/list", { cwds: [isolatedRepo] });
        const controlMcp = await controlRpc.rpc.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly" });
        const isolatedMcp = await isolatedRpc.rpc.request("mcpServerStatus/list", { detail: "toolsAndAuthOnly" });
        expect(controlHooks.data.flatMap((entry: { hooks: unknown[] }) => entry.hooks)).toHaveLength(1);
        expect(controlMcp.data).toHaveLength(1);
        expect(isolatedHooks.data.flatMap((entry: { hooks: unknown[] }) => entry.hooks)).toHaveLength(0);
        expect(isolatedMcp.data).toHaveLength(0);
        const thread = await isolatedRpc.rpc.request("thread/start", {
          ephemeral: true,
          cwd: isolatedRepo,
          model: "gpt-6-sol",
          approvalPolicy: "never",
          sandbox: "read-only",
        });
        const threadId = thread.thread.id;
        const completed = isolatedRpc.rpc.waitFor(
          "turn/completed",
          (notice: { params?: { threadId?: string } }) => notice.params?.threadId === threadId,
          90_000,
        );
        await isolatedRpc.rpc.request("turn/start", {
          threadId,
          input: [{ type: "text", text: "Reply with the word ready. Do not call tools." }],
          model: "gpt-6-sol",
          effort: "low",
          sandboxPolicy: { type: "readOnly", networkAccess: false },
          approvalPolicy: "never",
        });
        const turn = (await completed).params.turn;
        expect(turn.status).toBe("completed");
        expect(turn.items.some((item: { type: string; text?: string }) => item.type === "agentMessage" && item.text)).toBe(true);
      } finally {
        controlRpc.connection.close();
        isolatedRpc.connection.close();
      }
    } finally {
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null) return resolve();
              const timer = setTimeout(() => {
                child.kill("SIGKILL");
                resolve();
              }, 1500).unref();
              child.once("exit", () => {
                clearTimeout(timer);
                resolve();
              });
              child.kill("SIGTERM");
            }),
        ),
      );
      if (isolatedHome) removeIsolatedBrokerHome(isolatedHome);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  120_000,
);
