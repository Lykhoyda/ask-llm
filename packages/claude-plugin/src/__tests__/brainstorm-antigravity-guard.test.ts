import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PLUGIN_ROOT, readFile } from "./_helpers.js";

const SKIP_FLAG = "--dangerously-skip-permissions";

const SCAN_EXCLUDED = new Set(["node_modules", "dist", "__tests__"]);

const pluginTextFiles = fs
  .readdirSync(PLUGIN_ROOT, { recursive: true, encoding: "utf-8" })
  .filter((rel) => !rel.split(path.sep).some((part) => SCAN_EXCLUDED.has(part)))
  .filter((rel) => fs.statSync(path.join(PLUGIN_ROOT, rel)).isFile() && !readFile(rel).includes("\0"));

function antigravitySnippet(): string {
  const coordinator = readFile("agents/brainstorm-coordinator.md");
  const start = coordinator.indexOf("# Antigravity is an agentic CLI");
  const endMarker = "pid_antigravity=$!";
  const end = coordinator.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return coordinator.slice(start, end + endMarker.length);
}

describe("plugin files never grant agy unattended permissions", () => {
  it.each(pluginTextFiles)("%s has no raw agy invocation with the skip-permissions flag", (rel) => {
    const lines = readFile(rel).replace(/\\\n/g, " ").split("\n");
    const invocations = lines.filter((line) => /(^|[\s;&|(`$"'/])agy\s+-/.test(line));
    for (const line of invocations) expect(line).not.toContain(SKIP_FLAG);
  });
});

const shells = ["bash", "zsh"].filter((shell) => spawnSync(shell, ["-c", "true"]).status === 0);

it("runs every shell leg in CI instead of filtering a missing shell out", () => {
  if (process.env.CI) expect(shells).toEqual(["bash", "zsh"]);
});

describe.each(shells)("brainstorm antigravity participant under %s", (shell) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "brainstorm-agy-guard-"));
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, "agy"),
    '#!/bin/sh\nprintf "%s\\0" "$@" > "$AGY_ARGV_FILE"\necho "fake agy answer"\necho "fake agy stderr" >&2\n',
    { mode: 0o755 },
  );
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function run(optIn: string | undefined) {
    const workdir = fs.mkdtempSync(path.join(tmp, "work-"));
    const argvFile = path.join(workdir, "agy-argv");
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, AGY_ARGV_FILE: argvFile };
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

  it("runs agy without the skip-permissions flag and warns under ASK_ANTIGRAVITY_ALLOW_UNISOLATED=1", () => {
    const result = run("1");
    expect(result.argv).not.toBeNull();
    expect(result.argv).not.toContain(SKIP_FLAG);
    expect(result.argv).toContain("--sandbox");
    const prompt = result.argv?.[result.argv.indexOf("-p") + 1];
    expect(prompt).toContain("Read and reason only");
    expect(prompt).toContain("review this");
    expect(result.rc).toBe(0);
    expect(result.out).toContain("fake agy answer");
    expect(result.err).toMatch(/^antigravity warning: .*read-only isolation is not guaranteed/);
    expect(result.err).toContain("modify files, run shell commands, and access the network");
    expect(result.err).toContain("fake agy stderr");
  });
});

describe("brainstorm synthesis discloses the antigravity guard", () => {
  const coordinator = readFile("agents/brainstorm-coordinator.md");

  it("reports a skipped participant as skipped, not failed", () => {
    expect(coordinator).toMatch(/`antigravity skipped:`[^\n]*⏭️ Antigravity: skipped/);
  });

  it("carries the opt-in isolation warning into a successful participant line", () => {
    expect(coordinator).toMatch(/`antigravity warning:`[^\n]*⚠️/);
  });
});
