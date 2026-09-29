import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let resolveShellPath: typeof import("../shellPath.js").resolveShellPath;
let getSpawnEnv: typeof import("../shellPath.js").getSpawnEnv;

describe("shellPath", () => {
  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../shellPath.js");
    resolveShellPath = mod.resolveShellPath;
    getSpawnEnv = mod.getSpawnEnv;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a non-empty PATH string", () => {
    const path = resolveShellPath();
    expect(path).toBeTruthy();
    expect(typeof path).toBe("string");
  });

  it("caches the result on subsequent calls", () => {
    const first = resolveShellPath();
    const second = resolveShellPath();
    expect(first).toBe(second);
  });

  it("respects ASK_LLM_PATH env var override", async () => {
    vi.stubEnv("ASK_LLM_PATH", "/custom/path:/another/path");
    vi.resetModules();
    const mod = await import("../shellPath.js");
    expect(mod.resolveShellPath()).toBe("/custom/path:/another/path");
  });

  async function resolveWithFakeShell(script: string): Promise<string> {
    const dir = mkdtempSync(join(tmpdir(), "shellpath-"));
    try {
      const shell = join(dir, "login-sh");
      writeFileSync(shell, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
      vi.stubEnv("SHELL", shell);
      vi.stubEnv("ASK_LLM_PATH", "");
      vi.resetModules();
      const mod = await import("../shellPath.js");
      return mod.resolveShellPath();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("reads PATH from the login shell", async () => {
    const path = await resolveWithFakeShell('PATH="/login/only:$PATH" exec /bin/sh -c "$2"');
    expect(path.split(delimiter)[0]).toBe("/login/only");
  });

  it("falls back to the heuristic PATH when the login shell prints no marker", async () => {
    const path = await resolveWithFakeShell("exit 0");
    expect(path.split(delimiter)).toEqual(expect.arrayContaining((process.env.PATH ?? "").split(delimiter)));
  });

  it("getSpawnEnv returns env with PATH set", () => {
    const env = getSpawnEnv();
    expect(env.PATH).toBeTruthy();
    expect(env.HOME).toBe(process.env.HOME);
  });
});
