import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctorCli } from "../doctorCli.js";

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

vi.mock("../utils/providerSpecs.js", async (original) => {
  const actual = await original<typeof import("../utils/providerSpecs.js")>();
  return {
    buildProviderSpecs: async () => (await actual.buildProviderSpecs()).filter((spec) => spec.key === "antigravity"),
  };
});

describe("doctor Antigravity quota", () => {
  let home: string;
  let output: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "doctor-quota-"));
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  beforeEach(() => {
    rmSync(join(home, "argv"), { force: true });
    rmSync(join(home, "failure"), { force: true });
    rmSync(join(home, "hang"), { force: true });
    const bin = join(home, "bin");
    mkdirSync(bin, { recursive: true });
    for (const key of [
      "HOME",
      "CODEX_HOME",
      "XDG_CONFIG_HOME",
      "XDG_CACHE_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "CLAUDE_CONFIG_DIR",
      "GROK_HOME",
      "PI_CODING_AGENT_DIR",
    ]) {
      vi.stubEnv(key, home);
    }
    vi.stubEnv("ASK_LLM_PATH", `${bin}:/usr/bin:/bin`);
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", undefined);
    writeFileSync(join(home, "version"), "1.2.13");
    // Recorded quota response from fakeAgy.test.ts; sandboxed no-turn proof is in https://github.com/Lykhoyda/ask-llm/pull/366.
    writeFileSync(
      join(home, "quota"),
      JSON.stringify({
        status: "SUCCESS",
        num_turns: 0,
        usage: { input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 },
        response: "Gemini Models\tFive Hour Limit Remaining\t0%\t2026-09-27T20:10:40Z\n",
      }),
    );
    writeFileSync(
      join(bin, "agy"),
      [
        "#!/bin/sh",
        'printf "%s\\n" "$@" >> "$HOME/argv"',
        'if [ "$1" = "--version" ]; then cat "$HOME/version"; exit 0; fi',
        'if [ -f "$HOME/failure" ]; then cat "$HOME/failure" >&2; exit 3; fi',
        'if [ -f "$HOME/hang" ]; then exec sleep 30; fi',
        'cat "$HOME/quota"',
      ].join("\n"),
      { mode: 0o755 },
    );
    output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });
    vi.mocked(spawn).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("lists the verified quota versions in help without starting agy", async () => {
    expect(await runDoctorCli(["--help"], "/nonexistent/ask-llm.js")).toBe(0);
    expect(output).toContain("Also checks sandboxed Antigravity quota; verified only on agy 1.2.13.");
    expect(existsSync(join(home, "argv"))).toBe(false);
  });

  it.each([[], ["--json"], ["--format", "toon"]])(
    "never enters the agy spawn path without --live (%j)",
    async (...args) => {
      await runDoctorCli(args, "/nonexistent/ask-llm.js");
      expect(spawn).not.toHaveBeenCalled();
      expect(existsSync(join(home, "argv"))).toBe(false);
      expect(output).toContain("Antigravity");
    },
  );

  it.each(["1.1.11", "1.2.12", "1.2.13-beta.1", "1.2.14", "2.0.0", "unparseable", ""])(
    "skips quota on %s and states the verified versions",
    async (version) => {
      writeFileSync(join(home, "version"), version);
      await runDoctorCli(["--live"], "/nonexistent/ask-llm.js");
      expect(output).toContain("Quota: Antigravity: quota check skipped; verified only on agy 1.2.13");
      expect(vi.mocked(spawn).mock.calls.every(([, args]) => !args?.includes("/quota"))).toBe(true);
      expect(readFileSync(join(home, "argv"), "utf8")).not.toContain("/quota");
    },
  );

  it.each(["1.2.14", "2.0.0"])("reports newer versions as skipped in JSON (%s)", async (version) => {
    writeFileSync(join(home, "version"), version);
    await runDoctorCli(["--live", "--json"], "/nonexistent/ask-llm.js");
    expect(JSON.parse(output).checks).toContainEqual({
      name: "Quota: Antigravity",
      status: "skip",
      message: "quota check skipped; verified only on agy 1.2.13",
    });
    expect(vi.mocked(spawn).mock.calls.every(([, args]) => !args?.includes("/quota"))).toBe(true);
  });

  it("reports probe failure without failing the rest of doctor", async () => {
    writeFileSync(join(home, "failure"), "sandbox unavailable");
    expect(await runDoctorCli(["--live", "--json"], "/nonexistent/ask-llm.js")).toBe(0);
    const report = JSON.parse(output);
    expect(report.checks).toContainEqual({
      name: "Quota: Antigravity",
      status: "warn",
      message: "quota check failed: sandbox unavailable",
    });
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "Node.js version", status: "pass" }));
  });

  it("reports the five-second timeout without failing doctor", async () => {
    writeFileSync(join(home, "hang"), "");
    expect(await runDoctorCli(["--live"], "/nonexistent/ask-llm.js")).toBe(0);
    expect(output).toContain("Quota: Antigravity: quota check failed: Command timed out after 5s");
    expect(output).toContain("Node.js version:");
  }, 10_000);

  it("reports an exit-zero truncated envelope as a failed quota check", async () => {
    const quota = JSON.parse(readFileSync(join(home, "quota"), "utf8"));
    writeFileSync(join(home, "quota"), JSON.stringify({ ...quota, status: "TIMEOUT" }));
    expect(await runDoctorCli(["--live"], "/nonexistent/ask-llm.js")).toBe(0);
    expect(output).toContain("Quota: Antigravity: quota check failed: agy /quota returned truncated output");
  });

  it.each(["not JSON", '{"response":"not quota rows"}'])("reports malformed probe output (%s)", async (quota) => {
    writeFileSync(join(home, "quota"), quota);
    expect(await runDoctorCli(["--live", "--json"], "/nonexistent/ask-llm.js")).toBe(0);
    expect(JSON.parse(output).checks).toContainEqual(
      expect.objectContaining({ name: "Quota: Antigravity", status: "warn" }),
    );
  });

  it("reports sandboxed quota on agy 1.2.13 without opting into model execution", async () => {
    vi.stubEnv("ASK_ANTIGRAVITY_SANDBOX", "0");
    const code = await runDoctorCli(["--live"], "/nonexistent/ask-llm.js");
    expect(code).toBe(0);
    expect(output).toContain(
      "Quota: Antigravity: Gemini Models Five Hour Limit Remaining: 0% (resets 2026-09-27T20:10:40Z)",
    );
    expect(spawn).toHaveBeenCalledWith(
      "agy",
      ["-p", "/quota", "--output-format", "json", "--sandbox"],
      expect.any(Object),
    );
    expect(readFileSync(join(home, "argv"), "utf8")).not.toContain("Reply with exactly");
  });
});
