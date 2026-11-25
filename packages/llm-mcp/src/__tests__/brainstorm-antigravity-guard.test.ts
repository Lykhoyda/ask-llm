import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PROVIDERS } from "../constants.js";
import { readFile } from "./_helpers.js";

const SKIP_FLAG = "--dangerously-skip-permissions";

function antigravitySnippet(): string {
  const coordinator = readFile("agents/brainstorm-coordinator.md");
  const start = coordinator.indexOf("# Antigravity is an agentic CLI");
  const endMarker = "pid_antigravity=$!";
  const end = coordinator.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return coordinator.slice(start, end + endMarker.length);
}

const shells = ["bash", "zsh"].filter((shell) => spawnSync(shell, ["-c", "true"]).status === 0);

it("runs every shell leg when required instead of filtering a missing shell out", () => {
  if (process.env.ASK_LLM_REQUIRE_ALL_SHELLS === "1") expect(shells).toEqual(["bash", "zsh"]);
});

describe.each(shells)("brainstorm antigravity participant under %s", (shell) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brainstorm-agy-guard-"));
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "agy"),
    '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "$AGY_TEST_VERSION"\n  exit "$AGY_TEST_VERSION_EXIT"\nfi\nprintf "%s\\0" "$@" > "$AGY_ARGV_FILE"\necho "fake agy answer"\necho "fake agy stderr" >&2\n',
    { mode: 0o755 },
  );
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function run(optIn: string | undefined, version = "agy version 1.5.9", versionExit = "0") {
    const workdir = fs.mkdtempSync(path.join(tmp, "work-"));
    const argvFile = path.join(workdir, "agy-argv");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      AGY_ARGV_FILE: argvFile,
      AGY_TEST_VERSION: version,
      AGY_TEST_VERSION_EXIT: versionExit,
    };
    delete env.ASK_ANTIGRAVITY_ALLOW_UNISOLATED;
    if (optIn !== undefined) env.ASK_ANTIGRAVITY_ALLOW_UNISOLATED = optIn;
    const script = [
      "set +e",
      `workdir='${workdir}'`,
      `printf 'review this\\n' > "$workdir/prompt.md"`,
      antigravitySnippet(),
      'wait "$pid_antigravity" 2>/dev/null; echo "rc=$?"',
    ].join("\n");
    const stdout = execFileSync(shell, ["-c", script], { env, encoding: "utf-8", timeout: 20_000 });
    const read = (name: string) =>
      fs.existsSync(path.join(workdir, name)) ? fs.readFileSync(path.join(workdir, name), "utf-8") : "";
    return {
      rc: Number(/rc=(\d+)/.exec(stdout)?.[1]),
      argv: fs.existsSync(argvFile) ? fs.readFileSync(argvFile, "utf-8").split("\0") : null,
      out: read("antigravity.out"),
      err: read("antigravity.err"),
    };
  }

  it.each([undefined, "", "0", "true", "01", " 1", "1 "])(
    "skips agy with a disclosed reason when the opt-in is %j",
    (optIn) => {
      const result = run(optIn);
      expect(result.argv).toBeNull();
      expect(result.rc).not.toBe(0);
      expect(result.err).toMatch(/^antigravity skipped: /);
      expect(result.err).toContain("ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1");
    },
  );

  it.each(["1.5.9", "1.5.10", "1.6.0", "2.0.0"])("runs supported agy %s with the overlay and warning", (version) => {
    const result = run("1", `agy version ${version}`);
    expect(result.argv).not.toBeNull();
    expect(result.argv).not.toContain(SKIP_FLAG);
    expect(result.argv).toContain("--sandbox");
    const settings = result.argv?.[result.argv.indexOf("--settings") + 1];
    expect(JSON.parse(settings ?? "null")).toEqual({
      agentMode: "",
      permissions: { deny: ["write_file(*)", "command(*)"] },
    });
    expect(result.argv).not.toContain("--mode");
    // The raw call bypasses the executor, so it must restate the shipped default slug and effort (ADR-203).
    expect(PROVIDERS.antigravity.defaultModel).toBe("gemini-4-neon");
    expect(result.argv?.[result.argv.indexOf("--model") + 1]).toBe(PROVIDERS.antigravity.defaultModel);
    expect(result.argv?.[result.argv.indexOf("--effort") + 1]).toBe("high");
    const prompt = result.argv?.[result.argv.indexOf("-p") + 1];
    expect(prompt).toContain("Read and reason only");
    expect(prompt).toContain("review this");
    expect(result.rc).toBe(0);
    expect(result.out).toContain("fake agy answer");
    expect(result.err).toMatch(/^antigravity warning: .*read-only isolation is not guaranteed/);
    expect(result.err).toContain("modify files, run shell commands, and access the network");
    expect(result.err).toContain("fake agy stderr");
  });

  it.each([
    ["agy version 1.5.8", "0"],
    ["agy version 1.4.99", "0"],
    ["agy version 0.99.99", "0"],
    ["agy version 1.5.9-rc.1", "0"],
    ["unparseable", "0"],
    ["", "0"],
    ["agy version 1.5.9", "1"],
  ])("skips unsupported or unverifiable agy %j (exit %s)", (version, versionExit) => {
    const result = run("1", version, versionExit);
    expect(result.argv).toBeNull();
    expect(result.rc).not.toBe(0);
    expect(result.err).toMatch(/^antigravity skipped: /);
    expect(result.err).toContain("agy >=1.5.9 is required");
    expect(result.err).toContain("unsupported or unverifiable");
    expect(result.out).toBe("");
  });
});
