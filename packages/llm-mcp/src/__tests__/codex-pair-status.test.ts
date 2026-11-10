import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { PLUGIN_ROOT } from "./_helpers.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(marker = "# ctx") {
  const dir = mkdtempSync(join(tmpdir(), "pair-status-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".codex-pair", "state"), { recursive: true });
  writeFileSync(join(dir, ".codex-pair", "context.md"), marker);
  mkdirSync(join(dir, "nested"));
  return dir;
}
function status(dir: string, extra: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "codex-pair-log.mjs"), "--status"], {
    cwd: join(dir, "nested"),
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_PAIR_DISABLED: undefined,
      ASK_CODEX_MODEL: undefined,
      ASK_CODEX_FALLBACK_MODEL: undefined,
      ASK_CODEX_REASONING_EFFORT: undefined,
      ...extra,
    },
    timeout: 5000,
  });
}
it("reports the hook defaults, environment overrides and marker overrides, without needing a log", () => {
  const dir = fixture();
  expect(status(dir).stdout).toContain("Reasoning effort: high");
  expect(status(dir).stdout).toContain("Model: gpt-6.1-sol");
  expect(status(dir).stdout).toContain("Fallback model: gpt-6.1-terra");
  expect(status(dir).stdout).toContain("Guards turn end on: nothing");
  const env = {
    ASK_CODEX_MODEL: "env-model",
    ASK_CODEX_FALLBACK_MODEL: "env-fallback",
    ASK_CODEX_REASONING_EFFORT: "medium",
  };
  const output = status(dir, env);
  expect(output.status).toBe(0);
  expect(output.stdout).toContain("Model: env-model");
  expect(output.stdout).toContain("Fallback model: env-fallback");
  expect(output.stdout).toContain("Reasoning effort: medium");
  expect(output.stdout).toContain("No reviews recorded.");
  writeFileSync(
    join(dir, ".codex-pair", "context.md"),
    "---\nmodel: marker-model\nfallbackModel: marker-fallback\nreasoningEffort: xhigh\nsurfaceThreshold: low\nblockOn: HIGH\n---\n# ctx",
  );
  const pinned = status(dir, env).stdout;
  for (const value of [
    "Model: marker-model",
    "Fallback model: marker-fallback",
    "Reasoning effort: xhigh",
    "Guards turn end on: HIGH",
    "Surface threshold: low",
  ])
    expect(pinned).toContain(value);
});
it("a marker respects disable and every pause kind; status does not mutate state", () => {
  const dir = fixture();
  expect(status(dir).stdout).toContain("State: active");
  const sentinel = join(dir, ".codex-pair", "state", "paused");
  for (const value of [
    "",
    "invalid",
    JSON.stringify({ kind: "quota", reason: "quota exhausted", at: "2020-01-01", resetHint: "2h" }),
    JSON.stringify({ kind: "failures", reason: "three failures", at: "2020-01-01" }),
  ]) {
    writeFileSync(sentinel, value);
    const output = status(dir).stdout;
    const kind = value.startsWith("{") ? JSON.parse(value).kind : "manual";
    expect(output).toContain(`State: paused (${kind})`);
    expect(status(dir, { CODEX_PAIR_DISABLED: "1" }).stdout).toContain("State: disabled (CODEX_PAIR_DISABLED=1)");
    expect(readFileSync(sentinel, "utf8")).toBe(value);
  }
  expect(readdirSync(join(dir, ".codex-pair")).sort()).toEqual(["context.md", "state"]);
  expect(readdirSync(join(dir, ".codex-pair", "state"))).toEqual(["paused"]);
});
it("shows last five entries, skips malformed lines and retains failure reasons", () => {
  const dir = fixture();
  const entries = Array.from({ length: 7 }, (_, i) =>
    JSON.stringify({ verdict: "none", file: `file-${i}`, timestamp: "2026-11-10" }),
  );
  entries.push("malformed", JSON.stringify({ verdict: "unparsed", file: "broken", reason: "unreadable verdict" }));
  writeFileSync(join(dir, ".codex-pair", "log.jsonl"), entries.join("\n"));
  const output = status(dir).stdout;
  expect(output).not.toContain("file-2");
  expect(output).toContain("file-3");
  expect(output).toContain("broken");
  expect(output).toContain("Recent failure: unreadable verdict");
});
