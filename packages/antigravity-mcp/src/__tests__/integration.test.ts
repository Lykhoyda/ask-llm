import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANTIGRAVITY, MODELS, SESSION_SETTINGS_OVERLAY } from "../constants.js";
import { assertSupportedAgyVersion, isVersionAtLeast } from "../utils/agyVersion.js";
import { buildArgs, executeAntigravityCLI } from "../utils/antigravityExecutor.js";

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
  const environmentKeys = [
    "ASK_ANTIGRAVITY_TIMEOUT_MS",
    "AGY_ARGV_CAPTURE",
    "AGY_REAL_BIN",
    "AGY_FIXTURE_DIR",
    "ASK_LLM_PATH",
    "PATH",
  ] as const;
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
    writeFileSync(
      shimPath,
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$AGY_ARGV_CAPTURE"\ncd "$AGY_FIXTURE_DIR" || exit 1\nexec "$AGY_REAL_BIN" "$@"\n',
    );
    chmodSync(shimPath, 0o755);

    process.env.ASK_ANTIGRAVITY_TIMEOUT_MS = String(EXECUTOR_TIMEOUT_MS);
    process.env.AGY_ARGV_CAPTURE = argvCapturePath;
    process.env.AGY_REAL_BIN = realAgy;
    process.env.AGY_FIXTURE_DIR = fixtureDir;
    process.env.ASK_LLM_PATH = `${shimDir}:${previousEnvironment.PATH ?? ""}`;
  });

  afterEach(() => {
    for (const key of environmentKeys) {
      const value = previousEnvironment[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(smokeDir, { recursive: true, force: true });
  });

  it.skipIf(process.env.ASK_ANTIGRAVITY_ALLOW_UNISOLATED === "1")(
    "refuses without explicit unisolated opt-in before any agy spawn",
    async () => {
      await expect(executeAntigravityCLI({ prompt: "Review fixture", readOnly: true })).rejects.toThrow(
        "ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1",
      );
      expect(existsSync(argvCapturePath)).toBe(false);
    },
  );

  it.skipIf(process.env.ASK_ANTIGRAVITY_ALLOW_UNISOLATED !== "1")(
    "reviews a disposable fixture under explicit unisolated opt-in with best-effort flags",
    async () => {
      const beforeHash = hashTree(fixtureDir);
      let result: Awaited<ReturnType<typeof executeAntigravityCLI>>;
      try {
        result = await executeAntigravityCLI({
          prompt:
            'Read review.json in the current directory and review it. Return only JSON matching {"summary": string, "issues": string[]}.',
          includeDirs: [fixtureDir],
          model: MODELS.FALLBACK,
          readOnly: true,
        });
      } finally {
        expect(hashTree(fixtureDir)).toBe(beforeHash);
      }

      expect(result.response.length).toBeGreaterThan(0);
      const capturedArgv = readFileSync(argvCapturePath, "utf8");
      expect(capturedArgv).not.toContain("--mode\n");
      expect(capturedArgv).toContain("--sandbox\n");
      expect(capturedArgv).toContain(`--settings\n${SESSION_SETTINGS_OVERLAY}\n`);
      expect(capturedArgv).not.toContain("--dangerously-skip-permissions");
    },
    TIMEOUT,
  );
});

// agy's user settings file; read only to prove the session-only overlay never persists.
const AGY_USER_SETTINGS = join(homedir(), ".gemini", "antigravity-cli", "settings.json");
const fileHash = (path: string) =>
  existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : "absent";

// Live proof for ADR-193 on a real, logged-in agy >=1.5.9. The task deliberately omits the
// read-only preamble so the model attempts the actions and agy's deny rules, not the model, refuse them.
describe.skipIf(!SMOKE || process.env.ASK_ANTIGRAVITY_ALLOW_UNISOLATED !== "1")(
  "Antigravity (agy) live settings overlay",
  () => {
    let root: string;
    let workspace: string;
    let added: string;
    let outside: string;

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "agy-overlay-live-"));
      workspace = join(root, "ws");
      added = join(root, "added");
      outside = join(root, "outside");
      for (const dir of [workspace, added, outside]) mkdirSync(dir);
      writeFileSync(join(workspace, "README.md"), "Overlay fixture: the answer is 42.\n");
      writeFileSync(join(added, "lib.txt"), "export const value = 42;\n");
      writeFileSync(join(outside, "keep.txt"), "untouched\n");
    });

    afterEach(() => rmSync(root, { recursive: true, force: true }));

    const runAgy = async (prompt: string) => {
      const version = await assertSupportedAgyVersion();
      const args = [
        ...buildArgs(
          prompt,
          [added],
          200,
          true,
          undefined,
          false,
          undefined,
          isVersionAtLeast(version, ANTIGRAVITY.SLASH_COMMANDS_FLAG_MIN_VERSION),
        ),
        "--log-file",
        join(root, "agy.log"),
      ];
      const { stdout } = await promisify(execFile)("agy", args, {
        cwd: workspace,
        timeout: 230_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return { stdout, log: readFileSync(join(root, "agy.log"), "utf8") };
    };

    it(
      "blocks a file write, a touch, and a network command while agy still answers",
      async () => {
        const trees = [workspace, added, outside].map(hashTree);
        const settingsBefore = fileHash(AGY_USER_SETTINGS);
        const { stdout, log } = await runAgy(
          [
            "Do each step in order and report the outcome of every step:",
            "1. Use your file-writing tool to create overlay-write.txt containing the word written.",
            `2. Use your file-writing tool to create ${join(added, "overlay-added.txt")} containing the word written.`,
            "3. Run the shell command: touch overlay-touch.txt",
            `4. Run the shell command: touch ${join(outside, "overlay-outside.txt")}`,
            "5. Run the shell command: curl -sS -o overlay-net.html https://example.com",
          ].join("\n"),
        );

        expect([workspace, added, outside].map(hashTree)).toEqual(trees);
        expect(fileHash(AGY_USER_SETTINGS)).toBe(settingsBefore);
        expect(log).toContain("Deny:[write_file(*) command(*)]");
        expect(log).not.toMatch(/SetCycleMode called: auto/);
        expect(`${stdout}\n${log}`).toContain("Matches user-configured deny rule");
        expect(JSON.parse(stdout).response.trim().length).toBeGreaterThan(0);
      },
      TIMEOUT,
    );

    it(
      "still reads files and answers a review",
      async () => {
        const settingsBefore = fileHash(AGY_USER_SETTINGS);
        const { stdout } = await runAgy(
          `Read README.md and ${join(added, "lib.txt")}. Reply with the number both files mention, and nothing else.`,
        );
        expect(fileHash(AGY_USER_SETTINGS)).toBe(settingsBefore);
        expect(JSON.parse(stdout).response).toContain("42");
      },
      TIMEOUT,
    );
  },
);
