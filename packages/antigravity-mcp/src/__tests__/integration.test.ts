import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODELS } from "../constants.js";
import { executeAntigravityCLI } from "../utils/antigravityExecutor.js";

const SMOKE = !!process.env.SMOKE_TEST;
const EXECUTOR_TIMEOUT_MS = 180_000;
const TIMEOUT = EXECUTOR_TIMEOUT_MS + 20_000;

function hashTree(root: string): string {
  const hash = createHash("sha256");
  const visit = (dir: string, relativeDir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relativePath = join(relativeDir, entry.name);
      hash.update(relativePath);
      if (entry.isDirectory()) {
        hash.update("directory");
        visit(join(dir, entry.name), relativePath);
      } else {
        hash.update("file");
        hash.update(readFileSync(join(dir, entry.name)));
      }
    }
  };
  visit(root, "");
  return hash.digest("hex");
}

describe.skipIf(!SMOKE)("Antigravity (agy) CLI integration", () => {
  const environmentKeys = ["ASK_ANTIGRAVITY_TIMEOUT_MS", "AGY_ARGV_CAPTURE", "AGY_REAL_BIN", "PATH"] as const;
  let previousEnvironment: Record<(typeof environmentKeys)[number], string | undefined>;
  let smokeDir: string;
  let fixtureDir: string;
  let argvCapturePath: string;

  beforeEach(() => {
    previousEnvironment = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    ) as typeof previousEnvironment;
    const realAgy = execFileSync("which", ["agy"], { encoding: "utf8" }).trim();
    smokeDir = mkdtempSync(join(tmpdir(), "agy-read-only-smoke-"));
    fixtureDir = join(smokeDir, "fixture");
    const shimDir = join(smokeDir, "bin");
    argvCapturePath = join(smokeDir, "argv.txt");
    mkdirSync(fixtureDir);
    mkdirSync(shimDir);
    writeFileSync(join(fixtureDir, "review.json"), '{"status":"safe","value":42}\n');

    const shimPath = join(shimDir, "agy");
    writeFileSync(shimPath, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$AGY_ARGV_CAPTURE"\nexec "$AGY_REAL_BIN" "$@"\n');
    chmodSync(shimPath, 0o755);

    process.env.ASK_ANTIGRAVITY_TIMEOUT_MS = String(EXECUTOR_TIMEOUT_MS);
    process.env.AGY_ARGV_CAPTURE = argvCapturePath;
    process.env.AGY_REAL_BIN = realAgy;
    process.env.PATH = `${shimDir}:${previousEnvironment.PATH ?? ""}`;
  });

  afterEach(() => {
    for (const key of environmentKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(smokeDir, { recursive: true, force: true });
  });

  it(
    "reviews a fixture in read-only plan+sandbox mode without changing it",
    async () => {
      const beforeHash = hashTree(fixtureDir);
      let result: Awaited<ReturnType<typeof executeAntigravityCLI>>;
      try {
        result = await executeAntigravityCLI({
          prompt:
            'Review the provided fixture directory. Return only JSON matching {"summary": string, "issues": string[]}.',
          includeDirs: [fixtureDir],
          model: MODELS.FALLBACK,
          readOnly: true,
        });
      } finally {
        expect(hashTree(fixtureDir)).toBe(beforeHash);
      }

      expect(result.response.length).toBeGreaterThan(0);
      const capturedArgv = readFileSync(argvCapturePath, "utf8");
      expect(capturedArgv).toContain("--mode\nplan\n");
      expect(capturedArgv).toContain("--sandbox\n");
      expect(capturedArgv).not.toContain("--dangerously-skip-permissions");
    },
    TIMEOUT,
  );
});
