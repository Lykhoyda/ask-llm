// Cross-platform process-tree termination (extracted from codex-pair-watch.mjs
// per ADR-088, originally introduced by ADR-084).
//
// POSIX: spawn with `detached: true` so the child becomes a process-group
// leader; signal `-pid` to deliver to every member. Windows: `taskkill /F /T`
// terminates the entire tree (Windows has no POSIX process groups).
//
// `detached: true` does NOT detach the child's lifecycle — that requires
// child.unref(). We deliberately skip unref() so the parent waits for the
// child as normal.

import { spawn } from "node:child_process";
import { platform } from "node:process";

export const IS_WINDOWS = platform === "win32";

export function quoteArgsForWindows(args) {
  return args.map((arg) => {
    if (arg.includes(" ") || arg.includes('"') || arg.includes("&") || arg.includes("|") || arg.includes("^")) {
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });
}

export function prepareCommandInvocation(args, options, runtimePlatform = platform) {
  const isWindows = runtimePlatform === "win32";
  return {
    args: isWindows ? quoteArgsForWindows(args) : args,
    options: { ...options, shell: isWindows },
  };
}

export function terminateProcessTree(child, signal) {
  if (!child || typeof child.pid !== "number" || child.killed || child.exitCode !== null) {
    return;
  }
  if (IS_WINDOWS) {
    try {
      // /F = force, /T = tree (kills child + descendants)
      spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" });
    } catch {}
    return;
  }
  // POSIX: negative PID = process group. Requires `detached: true` at spawn
  // time, which is enforced at the call sites that need tree-kill.
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Group may already be gone (race with normal exit). Fall back to
    // direct PID kill so we at least drop the leader if it's still alive.
    try {
      child.kill(signal);
    } catch {}
  }
}
