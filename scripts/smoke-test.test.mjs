import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { vitestInvocation } from "./run-test-batch.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SMOKE_SCRIPT = join(REPO_ROOT, "scripts/smoke-test.sh");
const PACKAGES = [
  ["Ollama", "packages/ollama-mcp", "@ask-llm/ollama-mcp"],
  ["Antigravity", "packages/antigravity-mcp", "@ask-llm/antigravity-mcp"],
  ["Codex", "packages/codex-mcp", "@ask-llm/codex-mcp"],
  ["Claude", "packages/claude-mcp", "@ask-llm/claude-mcp"],
];
const temporaryDirectories = [];
const isWindows = process.platform === "win32";

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe("canonical smoke runner", () => {
  it.skipIf(isWindows)("invokes every smoke entry from the repository root with its explicit package path", () => {
    const fakeBin = mkdtempSync(join(tmpdir(), "ask-llm-smoke-bin-"));
    temporaryDirectories.push(fakeBin);
    const capturePath = join(fakeBin, "calls.tsv");
    const fakeYarnPath = join(fakeBin, "yarn");
    writeFileSync(
      fakeYarnPath,
      '#!/bin/sh\nprintf "%s\\t%s\\t%s\\n" "$PWD" "$SMOKE_TEST" "$*" >> "$SMOKE_CAPTURE"\necho "executed package tests: $*"\n',
    );
    chmodSync(fakeYarnPath, 0o755);

    const result = spawnSync("bash", [SMOKE_SCRIPT], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
        SMOKE_CAPTURE: capturePath,
      },
      timeout: 10_000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("=== Smoke tests done");
    expect(readFileSync(capturePath, "utf8").trim().split("\n")).toEqual(
      PACKAGES.map(([, packagePath]) => `${REPO_ROOT}\t1\ttest ${packagePath} --reporter=verbose`),
    );
  });

  it("maps every package path to real Vitest package tests instead of the root scripts-only project", () => {
    for (const [, packagePath, projectName] of PACKAGES) {
      const { command, args } = vitestInvocation(["list", packagePath]);
      const { CLAUDECODE: _nestedClaudeHost, ...hostEnv } = process.env;
      const result = spawnSync(command, args, {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...hostEnv, SMOKE_TEST: "1" },
        maxBuffer: 8 * 1024 * 1024,
        timeout: 20_000,
      });

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(`[${projectName}]`);
      expect(result.stdout).toContain("src/__tests__/integration.test.ts");
      expect(result.stdout).not.toContain("[scripts]");
    }
  }, 30_000);
});
