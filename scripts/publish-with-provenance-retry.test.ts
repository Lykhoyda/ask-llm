import { describe, expect, it, vi } from "vitest";
import { publishWithProvenanceRetry } from "./publish-with-provenance-retry.ts";

const conflict = {
  code: 1,
  stdout:
    "\x1b[31m└ YN0001: error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID 108e9186e8c5677a566ed251c7a722a77c59b1ab5f85d77b4e94831e6d6eb432325a3a36fc9352ca\x1b[0m",
  stderr: "",
};
const success = { code: 0, stdout: "", stderr: "" };

describe("Changesets provenance retry", () => {
  it("restarts the default publish command after a Rekor conflict", async () => {
    const run = vi.fn().mockResolvedValueOnce(conflict).mockResolvedValueOnce(success);
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(publishWithProvenanceRetry([], run, wait)).resolves.toBe(0);
    expect(run.mock.calls).toEqual([[[]], [[]]]);
    expect(wait.mock.calls).toEqual([[2_000]]);
  });

  it("fails after two retries when Rekor keeps returning conflicts", async () => {
    const run = vi.fn().mockResolvedValue({ ...conflict, stdout: "", stderr: conflict.stdout });
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(publishWithProvenanceRetry([], run, wait)).resolves.toBe(1);
    expect(run).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[2_000], [4_000]]);
  });

  it.each([
    ["a successful publish", success, 0],
    ["a registry conflict", { ...conflict, stdout: "npm registry PUT returned 409" }, 1],
    ["a signing error", { ...conflict, stdout: "error creating tlog entry - (503) unavailable" }, 1],
    ["an interrupted publish", { ...conflict, code: null }, 1],
  ])("runs once for %s", async (_name, result, exitCode) => {
    const run = vi.fn().mockResolvedValue(result);
    const wait = vi.fn();

    await expect(publishWithProvenanceRetry([], run, wait)).resolves.toBe(exitCode);
    expect(run).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("passes a saved publish plan through without retrying it", async () => {
    const args = ["--from-pack-dir", "artifacts"];
    const run = vi.fn().mockResolvedValue(conflict);
    const wait = vi.fn();

    await expect(publishWithProvenanceRetry(args, run, wait)).resolves.toBe(1);
    expect(run).toHaveBeenCalledExactlyOnceWith(args);
    expect(wait).not.toHaveBeenCalled();
  });
});
