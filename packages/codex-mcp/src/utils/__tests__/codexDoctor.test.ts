import { describe, expect, it } from "vitest";
import { enrichCodexDoctor, parseCodexDoctorJson } from "../codexDoctor.js";

// Trimmed real-shape `codex doctor --json` output (codex 0.139): an overall
// warning, one ok check, one warning check (null remediation), one error check
// (string remediation) — exercises the full status + remediation mapping.
const DOCTOR_JSON = JSON.stringify({
  schemaVersion: 1,
  generatedAt: "1781441605s since unix epoch",
  overallStatus: "warning",
  codexVersion: "0.139.0",
  checks: {
    "auth.credentials": {
      id: "auth.credentials",
      category: "auth",
      status: "ok",
      summary: "auth is configured",
      remediation: null,
    },
    "state.rollout_db_parity": {
      id: "state.rollout_db_parity",
      category: "state",
      status: "warning",
      summary: "rollout files and state DB thread inventory differ",
      remediation: null,
    },
    "mcp.servers": {
      id: "mcp.servers",
      category: "mcp",
      status: "error",
      summary: "1 server failed to start",
      remediation: "run `codex mcp list`",
    },
  },
});

describe("parseCodexDoctorJson", () => {
  it("maps a codex doctor report into a provider enrichment", () => {
    const enrichment = parseCodexDoctorJson(DOCTOR_JSON);
    expect(enrichment).toBeDefined();
    expect(enrichment?.heading).toBe("codex doctor");
    expect(enrichment?.overall).toBe("warning");
    expect(enrichment?.checks).toHaveLength(3);
  });

  it("maps codex check statuses onto ask-llm CheckStatus", () => {
    const byName = Object.fromEntries((parseCodexDoctorJson(DOCTOR_JSON)?.checks ?? []).map((c) => [c.name, c]));
    expect(byName["auth.credentials"]?.status).toBe("pass");
    expect(byName["state.rollout_db_parity"]?.status).toBe("warn");
    expect(byName["mcp.servers"]?.status).toBe("fail");
    // drive "skip" through the real parser (the render test bypasses it with a pre-typed check)
    const withSkip = parseCodexDoctorJson(
      JSON.stringify({
        overallStatus: "ok",
        checks: {
          "git.optional": { id: "git.optional", status: "skip", summary: "not in a git repo", remediation: null },
        },
      }),
    );
    expect(withSkip?.checks[0]?.status).toBe("skip");
  });

  it("normalizes null remediation to undefined and preserves real remediation", () => {
    const byName = Object.fromEntries((parseCodexDoctorJson(DOCTOR_JSON)?.checks ?? []).map((c) => [c.name, c]));
    expect(byName["auth.credentials"]?.remediation).toBeUndefined();
    expect(byName["mcp.servers"]?.remediation).toBe("run `codex mcp list`");
  });

  it("returns undefined for non-JSON output", () => {
    expect(parseCodexDoctorJson("not json at all")).toBeUndefined();
    expect(parseCodexDoctorJson("")).toBeUndefined();
  });

  it("returns undefined when the JSON is not a doctor report", () => {
    expect(parseCodexDoctorJson(JSON.stringify({ hello: "world" }))).toBeUndefined();
    expect(parseCodexDoctorJson(JSON.stringify({ overallStatus: "ok" }))).toBeUndefined();
  });
});

describe("enrichCodexDoctor", () => {
  const ctx = { command: "codex", pathEnv: "/usr/bin" };

  it("returns the parsed enrichment when the runner yields a doctor report", async () => {
    const enrichment = await enrichCodexDoctor(ctx, async () => DOCTOR_JSON);
    expect(enrichment?.heading).toBe("codex doctor");
    expect(enrichment?.overall).toBe("warning");
    expect(enrichment?.checks).toHaveLength(3);
  });

  it("degrades to undefined when the runner throws (old codex / no --json / timeout)", async () => {
    const enrichment = await enrichCodexDoctor(ctx, async () => {
      throw new Error("error: unexpected argument '--json'");
    });
    expect(enrichment).toBeUndefined();
  });

  it("degrades to undefined when the runner returns non-report output", async () => {
    expect(await enrichCodexDoctor(ctx, async () => "garbage output")).toBeUndefined();
  });

  it("salvages a doctor report from a non-zero exit (codex emits JSON on stdout while exiting 1)", async () => {
    // codex 0.139 prints the full --json report on stdout even when overall
    // health is error and the process exits non-zero (cf. ADR-117).
    const enrichment = await enrichCodexDoctor(ctx, async () => {
      throw Object.assign(new Error("Command failed: codex doctor --json"), { stdout: DOCTOR_JSON, code: 1 });
    });
    expect(enrichment?.overall).toBe("warning");
    expect(enrichment?.checks).toHaveLength(3);
  });

  it("returns undefined when a thrown error carries no usable stdout", async () => {
    const enrichment = await enrichCodexDoctor(ctx, async () => {
      throw Object.assign(new Error("spawn codex ENOENT"), { stdout: "" });
    });
    expect(enrichment).toBeUndefined();
  });
});
