import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const command = fileURLToPath(new URL("../../dist/ask-llm.js", import.meta.url));
const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version;

it("prints the canonical package version without starting a server", () => {
  const result = spawnSync(process.execPath, [command, "--version"], { encoding: "utf8", timeout: 10_000 });
  expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
    status: 0,
    stdout: `${version}\n`,
    stderr: "",
  });
});

it.each([[], ["--help"], ["-h"]].map((args) => ({ args })))(
  "prints command help for %j without starting a server",
  ({ args }) => {
    const result = spawnSync(process.execPath, [command, ...args], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("ask-llm doctor");
    expect(result.stdout).not.toContain("setup");
    expect(result.stderr).toBe("");
  },
);

it.each([["setup"], ["remove"], ["--version", "extra"], ["unknown"]].map((args) => ({ args })))(
  "rejects unsupported argv %j",
  ({ args }) => {
    const result = spawnSync(process.execPath, [command, ...args], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Usage: ask-llm");
  },
);

it("delegates doctor argument errors to the existing diagnostics dispatcher", () => {
  const result = spawnSync(process.execPath, [command, "doctor", "--unknown"], { encoding: "utf8", timeout: 10_000 });
  expect(result.status).toBe(2);
  expect(JSON.parse(result.stderr).error.code).toBe("unknown_argument");
  expect(result.stdout).toBe("");
});
