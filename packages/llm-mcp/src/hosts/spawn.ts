import { execFile } from "node:child_process";

export interface HostRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export function runHost(binary: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<HostRun> {
  return new Promise((resolve) => {
    const child = execFile(binary, args, { env, timeout, killSignal: "SIGKILL" }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      resolve({ code, stdout, stderr: stderr || (code === null && error ? error.message : "") });
    });
    child.stdin?.end();
  });
}
