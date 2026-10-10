import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runHost } from "../hosts/spawn.js";

const root = mkdtempSync(join(tmpdir(), "ask-llm-spawn-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// Like Gemini CLI, the fake relaunches itself in a child process and waits for it. The relaunched child
// records its pid and starts a stray process of its own that holds no output pipe.
function relaunchingHost(name: string, child: string): string {
  const path = join(root, name);
  writeFileSync(
    path,
    `#!${process.execPath}
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
if (!process.env.RELAUNCHED) {
  const relaunched = spawn(process.execPath, [__filename, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, RELAUNCHED: "1" },
  });
  relaunched.on("exit", (code) => process.exit(code ?? 1));
} else {
  const stray = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  writeFileSync(${JSON.stringify(join(root, `${name}.pids`))}, process.pid + " " + stray.pid);
  ${child}
}
`,
  );
  chmodSync(path, 0o755);
  return path;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pids: number[]): Promise<boolean> {
  // A killed process can stay a zombie until it is reaped.
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!pids.some(alive)) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
}

function pids(name: string): number[] {
  return readFileSync(join(root, `${name}.pids`), "utf8")
    .split(" ")
    .map(Number);
}

describe("runHost", () => {
  it("kills a relaunched host process on timeout", async () => {
    const binary = relaunchingHost("blocked", "setInterval(() => {}, 1000);");
    const run = await runHost(binary, ["--version"], process.env, 500);
    expect(run.code).toBeNull();
    const left = pids("blocked");
    expect(left).toHaveLength(2);
    expect(await gone(left)).toBe(true);
  });

  it.each([
    ["succeeds", 'console.log("1.2.3"); process.exit(0);', 0],
    ["fails", 'console.error("bad flag"); process.exit(3);', 3],
  ])("returns the result when the relaunched host %s", async (name, child, code) => {
    const binary = relaunchingHost(name, child);
    const run = await runHost(binary, ["--version"], process.env, 10_000);
    const [relaunched, stray] = pids(name);
    try {
      expect(run.code).toBe(code);
      expect(code === 0 ? run.stdout : run.stderr).toMatch(code === 0 ? /^1\.2\.3/ : /bad flag/);
      expect(await gone([relaunched])).toBe(true);
      expect(alive(stray)).toBe(true);
    } finally {
      if (alive(stray)) process.kill(stray, "SIGKILL");
      expect(await gone([stray])).toBe(true);
    }
  });

  it("stops a running host when the caller is interrupted", async () => {
    const binary = relaunchingHost("interrupted", "setInterval(() => {}, 1000);");
    const caller = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const { runHost } = await import(${JSON.stringify(new URL("../hosts/spawn.ts", import.meta.url).href)});
await runHost(${JSON.stringify(binary)}, [], process.env, 60000);`,
      ],
      { stdio: "ignore" },
    );
    for (let attempt = 0; attempt < 250 && !existsSync(join(root, "interrupted.pids")); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    const exited = once(caller, "exit");
    caller.kill("SIGINT");
    expect(await exited).toEqual([null, "SIGINT"]);
    expect(await gone(pids("interrupted"))).toBe(true);
  });

  it("reports a host that cannot start", async () => {
    const missing = join(root, "missing");
    const run = await runHost(missing, ["--version"], process.env, 1000);
    expect(run).toMatchObject({ code: null, stdout: "" });
    expect(run.stderr).toContain("ENOENT");
    expect(existsSync(missing)).toBe(false);
  });
});
