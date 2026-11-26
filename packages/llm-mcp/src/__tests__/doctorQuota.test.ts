import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DiagnosticReport } from "@ask-llm/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctorCli } from "../doctorCli.js";

// Pinned literally: the session-only overlay every agy spawn carries (ADR-194).
const SESSION_SETTINGS_OVERLAY = '{"agentMode":"","permissions":{"deny":["write_file(*)","command(*)"]}}';
const QUOTA_ARGS = ["-p", "/quota", "--output-format", "json", "--sandbox", "--settings", SESSION_SETTINGS_OVERLAY];
const GOOGLE_SIGNALS = [
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AGY_ADC_AUTH",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_PROJECT_ID",
];

vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

vi.mock("../utils/providerSpecs.js", async (original) => {
  const actual = await original<typeof import("../utils/providerSpecs.js")>();
  return {
    buildProviderSpecs: async () =>
      (await actual.buildProviderSpecs()).filter(({ key }) => ["antigravity", "gemini", "codex"].includes(key)),
  };
});

describe("doctor Antigravity quota", () => {
  let home: string;
  let output: string;
  const argv = (tool: string) => {
    const log = join(home, `${tool}.argv`);
    return existsSync(log) ? readFileSync(log, "utf8").trimEnd().split("\n") : [];
  };

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "doctor-quota-"));
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  beforeEach(() => {
    for (const tool of ["agy", "gemini", "codex"]) rmSync(join(home, `${tool}.argv`), { force: true });
    rmSync(join(home, "failure"), { force: true });
    rmSync(join(home, "hang"), { force: true });
    const bin = join(home, "bin");
    mkdirSync(bin, { recursive: true });
    rmSync(join(bin, "codex"), { force: true });
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
    vi.stubEnv("PATH", `${bin}:/usr/bin:/bin`);
    vi.stubEnv("DOCTOR_FIXTURE_HOME", home);
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", undefined);
    for (const name of GOOGLE_SIGNALS) vi.stubEnv(name, undefined);
    writeFileSync(join(home, "version"), "1.5.9");
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
        'printf "%s\\n" "$@" >> "$DOCTOR_FIXTURE_HOME/agy.argv"',
        'if [ "$1" = "--version" ]; then cat "$HOME/version"; exit 0; fi',
        'if [ "$1" != "-p" ] || [ "$2" != "/quota" ]; then exit 97; fi',
        'if [ -f "$HOME/failure" ]; then cat "$HOME/failure" >&2; exit 3; fi',
        'if [ -f "$HOME/hang" ]; then exec sleep 30; fi',
        'cat "$HOME/quota"',
      ].join("\n"),
      { mode: 0o755 },
    );
    writeFileSync(
      join(bin, "gemini"),
      '#!/bin/sh\nprintf "%s\\n" "$@" >> "$DOCTOR_FIXTURE_HOME/gemini.argv"\n[ "$1" = "--version" ] || exit 97\nprintf "0.33.0\\n"\n',
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

  it("states the minimum quota version in help without starting agy", async () => {
    expect(await runDoctorCli(["--help"], "/nonexistent/ask-llm.js")).toBe(0);
    expect(output).toContain("Reports sandboxed Antigravity quota metadata on agy 1.5.9 or newer.");
    expect(argv("agy")).toEqual([]);
  });

  it.each([[], ["--json"], ["--format", "toon"]])(
    "never enters the agy spawn path without --live (%j)",
    async (...args) => {
      vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", "1");
      await runDoctorCli(args, "/nonexistent/ask-llm.js");
      expect(argv("agy")).toEqual([]);
      expect(vi.mocked(spawn).mock.calls.some(([command]) => command.endsWith("agy"))).toBe(false);
      expect(output).toContain("Antigravity");
    },
  );

  it.each(["1.1.11", "1.2.12", "1.2.13", "1.5.8", "1.5.9-beta.1", "unparseable", ""])(
    "skips quota on %s and states the minimum version",
    async (version) => {
      writeFileSync(join(home, "version"), version);
      vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", "1");
      await runDoctorCli(["--live"], "/nonexistent/ask-llm.js");
      expect(output).toContain("Quota: Antigravity: quota check skipped; requires agy 1.5.9 or newer");
      expect(argv("agy")).toEqual(["--version", "--version"]);
    },
  );

  it.each(["1.5.9", "1.6.0", "2.0.0"])(
    "reports sandboxed quota with the detected version in JSON (%s)",
    async (version) => {
      writeFileSync(join(home, "version"), version);
      await runDoctorCli(["--live", "--json"], "/nonexistent/ask-llm.js");
      expect(JSON.parse(output).checks).toContainEqual({
        name: "Quota: Antigravity",
        status: "pass",
        message: `agy ${version} reported metadata: Gemini Models Five Hour Limit Remaining: 0% (resets 2026-09-27T20:10:40Z). Account funding and overage settings are unverified.`,
      });
      expect(spawn).toHaveBeenCalledWith("agy", QUOTA_ARGS, expect.any(Object));
    },
  );

  it("reports probe failure without failing the rest of doctor", async () => {
    writeFileSync(join(home, "failure"), "sandbox unavailable");
    expect(await runDoctorCli(["--live", "--json"], "/nonexistent/ask-llm.js")).toBe(0);
    const report = JSON.parse(output);
    expect(report.checks).toContainEqual({
      name: "Quota: Antigravity",
      status: "warn",
      message: "agy 1.5.9: quota check failed: sandbox unavailable",
    });
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "Node.js version", status: "pass" }));
  });

  it("reports the five-second timeout without failing doctor", async () => {
    writeFileSync(join(home, "hang"), "");
    expect(await runDoctorCli(["--live"], "/nonexistent/ask-llm.js")).toBe(0);
    expect(output).toContain("Quota: Antigravity: agy 1.5.9: quota check failed: Command timed out after 5s");
    expect(output).toContain("Node.js version:");
  }, 10_000);

  it("reports an exit-zero truncated envelope as a failed quota check", async () => {
    const quota = JSON.parse(readFileSync(join(home, "quota"), "utf8"));
    writeFileSync(join(home, "quota"), JSON.stringify({ ...quota, status: "TIMEOUT" }));
    expect(await runDoctorCli(["--live"], "/nonexistent/ask-llm.js")).toBe(0);
    expect(output).toContain("Quota: Antigravity: agy 1.5.9: quota check failed: agy /quota returned truncated output");
  });

  it.each(["not JSON", '{"response":"not quota rows"}'])("reports malformed probe output (%s)", async (quota) => {
    writeFileSync(join(home, "quota"), quota);
    expect(await runDoctorCli(["--live", "--json"], "/nonexistent/ask-llm.js")).toBe(0);
    expect(JSON.parse(output).checks).toContainEqual(
      expect.objectContaining({ name: "Quota: Antigravity", status: "warn" }),
    );
  });

  it.each(["1.5.9", "1.6.0", "2.0.0"])(
    "reports sandboxed quota on agy %s without opting into model execution",
    async (version) => {
      writeFileSync(join(home, "version"), version);
      vi.stubEnv("ASK_ANTIGRAVITY_SANDBOX", "0");
      const code = await runDoctorCli(["--live"], "/nonexistent/ask-llm.js");
      expect(code).toBe(0);
      expect(output).toContain(
        `Quota: Antigravity: agy ${version} reported metadata: Gemini Models Five Hour Limit Remaining: 0% (resets 2026-09-27T20:10:40Z)`,
      );
      expect(spawn).toHaveBeenCalledWith("agy", QUOTA_ARGS, expect.any(Object));
      expect(argv("agy")).toEqual(["--version", "--version", ...QUOTA_ARGS]);
    },
  );

  it.each([undefined, true])(
    "keeps funding and overage unverified with quota remaining and credits=%s",
    async (useAiCredits) => {
      mkdirSync(join(home, ".agy"), { recursive: true });
      writeFileSync(join(home, ".agy", "settings.json"), JSON.stringify({ useAiCredits }));
      const quota = JSON.parse(readFileSync(join(home, "quota"), "utf8"));
      writeFileSync(join(home, "quota"), JSON.stringify({ ...quota, response: quota.response.replace("0%", "80%") }));
      await runDoctorCli(["--live", "--json"], "/nonexistent/ask-llm.js");
      const report = JSON.parse(output) as DiagnosticReport;
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          name: "Quota: Antigravity",
          status: "pass",
          message: expect.stringMatching(/reported metadata: .*80%.*funding and overage settings are unverified/),
        }),
      );
      expect(report.checks).toContainEqual(expect.objectContaining({ name: "Route: Antigravity", status: "skip" }));
      expect(report.providers.find(({ name }) => name === "Antigravity")?.states?.authenticated).toBe("unknown");
      expect(argv("agy")).toEqual(["--version", "--version", ...QUOTA_ARGS]);
    },
  );

  it("ignores persisted key and Cloud settings and leaves Gemini registration unchecked", async () => {
    mkdirSync(join(home, ".gemini"), { recursive: true });
    mkdirSync(join(home, ".config", "gcloud"), { recursive: true });
    writeFileSync(join(home, ".gemini", ".env"), "GEMINI_API_KEY=persisted-test-value\n");
    writeFileSync(
      join(home, ".config", "gcloud", "application_default_credentials.json"),
      '{"type":"authorized_user"}',
    );
    writeFileSync(
      join(home, ".gemini", "settings.json"),
      JSON.stringify({
        security: { auth: { selectedType: "vertex-ai" } },
        mcpServers: { "ask-llm": { command: "fixture-hidden-command" } },
      }),
    );

    await runDoctorCli(["--json"], "/nonexistent/ask-llm.js");
    const report = JSON.parse(output) as DiagnosticReport & { hosts: unknown[] };
    expect(report.hosts).toContainEqual(
      expect.objectContaining({
        id: "gemini",
        installed: true,
        registered: null,
        error: "registration check skipped (mixed settings)",
      }),
    );
    for (const name of ["Gemini", "Antigravity"]) {
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          name: `Route: ${name}`,
          status: "skip",
          message: expect.stringContaining("Seat unproven."),
        }),
      );
      expect(report.providers.find((provider) => provider.name === name)?.states?.authenticated).toBe("unknown");
    }
    expect(output).not.toMatch(/persisted-test-value|fixture-hidden-command/);
    expect(argv("agy")).toEqual([]);
    expect(argv("gemini")).toEqual(["--version", "--version"]);
  });

  it.each(["unresolved", "resolved"])(
    "gives no Gemini registration command when Gemini CLI is absent (%s server path)",
    async (serverPath) => {
      rmSync(join(home, "bin", "gemini"), { force: true });
      mkdirSync(join(home, ".gemini"), { recursive: true });
      writeFileSync(
        join(home, ".gemini", "settings.json"),
        JSON.stringify({ mcpServers: { "ask-llm": { command: "fixture-hidden-command" } } }),
      );
      const ownCli = serverPath === "resolved" ? join(home, "ask-llm.js") : "/nonexistent/ask-llm.js";
      writeFileSync(join(home, "ask-llm.js"), "");

      await runDoctorCli(["--json"], ownCli);
      const gemini = (JSON.parse(output) as { hosts: Record<string, unknown>[] }).hosts.find(
        ({ id }) => id === "gemini",
      );
      expect(gemini).toMatchObject({
        installed: false,
        registered: null,
        error: "registration check skipped (mixed settings)",
      });
      expect(gemini).not.toHaveProperty("manual");

      output = "";
      await runDoctorCli([], ownCli);
      const lines = output.split("\n");
      const at = lines.findIndex((line) => line.includes("Gemini CLI: not installed"));
      expect(at).toBeGreaterThan(-1);
      expect(lines[at + 1] ?? "").not.toContain("exact manual command");
      expect(output).not.toContain("fixture-hidden-command");
      expect(argv("gemini")).toEqual([]);
    },
  );

  it("skips both Google models with opt-in and still exercises a separate fake provider", async () => {
    vi.stubEnv("ASK_ANTIGRAVITY_ALLOW_UNISOLATED", "1");
    vi.stubEnv("GEMINI_API_KEY", "synthetic-key-value");
    writeFileSync(
      join(home, "bin", "codex"),
      [
        "#!/bin/sh",
        'printf "%s\\n" "$@" >> "$DOCTOR_FIXTURE_HOME/codex.argv"',
        'case "$1" in',
        '  --version) printf "codex-cli 0.148.0\\n" ;;',
        "  login) exit 0 ;;",
        '  exec) printf \'%s\\n\' \'{"type":"item.completed","item":{"type":"agent_message","text":"OK"}}\' ;;',
        "  *) exit 1 ;;",
        "esac",
      ].join("\n"),
      { mode: 0o755 },
    );
    expect(await runDoctorCli(["--live", "--json"], "/nonexistent/ask-llm.js")).toBe(0);
    const report = JSON.parse(output) as DiagnosticReport;
    for (const name of ["Gemini", "Antigravity"]) {
      expect(report.checks).toContainEqual({
        name: `Live: ${name}`,
        status: "skip",
        message: "not exercised: Google route and funding unverified.",
      });
      expect(report.checks).toContainEqual(
        expect.objectContaining({
          name: `Route: ${name}`,
          status: "warn",
          message: expect.stringContaining("GEMINI_API_KEY"),
        }),
      );
    }
    expect(output).not.toContain("synthetic-key-value");
    expect(report.checks).toContainEqual(expect.objectContaining({ name: "Live: Codex", status: "pass" }));
    expect(argv("codex").filter((arg) => arg === "exec")).toEqual(["exec"]);
    expect(argv("agy")).toEqual(["--version", "--version", ...QUOTA_ARGS]);
    expect(argv("gemini")).toEqual(["--version", "--version"]);
  });
});
