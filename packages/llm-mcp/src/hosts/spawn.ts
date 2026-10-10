import { spawn } from "node:child_process";

export interface HostRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

// Process groups of the hosts still running.
const running = new Set<number>();
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group has already exited.
  }
}

function killRunning(): void {
  for (const pid of running) killGroup(pid);
}

// A host in its own group no longer gets the terminal's Ctrl-C, so stop it before this process ends.
function onSignal(signal: NodeJS.Signals): void {
  killRunning();
  unwatch();
  process.kill(process.pid, signal);
}

function watch(): void {
  for (const signal of SIGNALS) process.on(signal, onSignal);
  process.on("exit", killRunning);
}

function unwatch(): void {
  for (const signal of SIGNALS) process.off(signal, onSignal);
  process.off("exit", killRunning);
}

// The host runs in its own process group, and the whole group is killed when the run ends: hosts such as
// Gemini CLI relaunch themselves in a child process, which would outlive a kill of the direct child.
export function runHost(binary: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<HostRun> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(binary, args, { env, detached: true });
    const { pid } = child;
    if (pid) {
      if (running.size === 0) watch();
      running.add(pid);
    }
    const timer = setTimeout(() => {
      timedOut = true;
      if (pid) killGroup(pid);
    }, timeout);
    const settle = (code: number | null, error: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pid) {
        killGroup(pid);
        running.delete(pid);
        if (running.size === 0) unwatch();
      }
      resolve({ code, stdout, stderr: stderr || (code === null ? error : "") });
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => settle(null, error.message));
    child.on("close", (code, signal) =>
      settle(
        timedOut ? null : code,
        timedOut ? `timed out after ${timeout} ms` : `terminated by ${signal ?? "an unknown signal"}`,
      ),
    );
    child.stdin.end();
  });
}
