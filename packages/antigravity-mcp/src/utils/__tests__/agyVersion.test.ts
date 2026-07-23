import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY, CLI } from "../../constants.js";

vi.mock("@ask-llm/shared", () => ({
  executeCommand: vi.fn(),
  isCommandNotFoundError: (detail: string) =>
    /enoent|not found on path|command not found|is not recognized as an internal or external command/i.test(detail),
}));

import { executeCommand } from "@ask-llm/shared";
import { assertSupportedAgyVersion, assessAgyVersion, probeAgySupport } from "../agyVersion.js";

const mockExec = vi.mocked(executeCommand);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertSupportedAgyVersion", () => {
  it.each([
    ["1.1.5", "1.1.5"],
    ["agy version 1.2.0", "1.2.0"],
    ["Antigravity CLI v2.0.0-beta.1", "2.0.0-beta.1"],
  ])("accepts supported output %j", async (output, expected) => {
    mockExec.mockResolvedValue(output);

    await expect(assertSupportedAgyVersion()).resolves.toBe(expected);
    expect(mockExec).toHaveBeenCalledWith(
      CLI.COMMANDS.AGY,
      [CLI.FLAGS.VERSION],
      undefined,
      undefined,
      undefined,
      ANTIGRAVITY.VERSION_CHECK_TIMEOUT_MS,
    );
  });

  it("rejects an older CLI before model invocation with an actionable diagnostic", async () => {
    mockExec.mockResolvedValue("1.1.4");

    await expect(assertSupportedAgyVersion()).rejects.toThrow(
      new RegExp(
        `Antigravity CLI \\(agy\\) 1\\.1\\.4 was detected but is unsupported.*agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION} is required.*Update Antigravity CLI`,
        "s",
      ),
    );
  });

  it("rejects an unparseable version response actionably", async () => {
    mockExec.mockResolvedValue("Antigravity development build");

    await expect(assertSupportedAgyVersion()).rejects.toThrow(
      new RegExp(
        `version output "Antigravity development build" is unparseable and unusable.*agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION} is required`,
        "s",
      ),
    );
  });
});

describe("assessAgyVersion", () => {
  it("classifies supported, unsupported, and unparseable versions", () => {
    expect(assessAgyVersion("1.1.5")).toMatchObject({
      status: "supported",
      available: true,
      detected: true,
      version: "1.1.5",
    });
    expect(assessAgyVersion("agy 1.1.4")).toMatchObject({
      status: "unsupported",
      available: false,
      detected: true,
      version: "1.1.4",
      requiredVersion: ANTIGRAVITY.MINIMUM_AGY_VERSION,
    });
    expect(assessAgyVersion("development build")).toMatchObject({
      status: "unusable",
      available: false,
      detected: true,
      requiredVersion: ANTIGRAVITY.MINIMUM_AGY_VERSION,
    });
  });

  it("classifies a version-probe failure as detected but unusable", () => {
    const result = assessAgyVersion(undefined, "version probe timed out");

    expect(result).toMatchObject({
      status: "unusable",
      available: false,
      detected: true,
      requiredVersion: ANTIGRAVITY.MINIMUM_AGY_VERSION,
    });
    expect(result.message).toContain("version is unknown and unusable");
    expect(result.remediation).toContain("Update Antigravity CLI");
  });
});

describe("probeAgySupport", () => {
  it.each([
    "Failed to spawn command: spawn agy ENOENT",
    "'agy' is not recognized as an internal or external command, operable program or batch file.",
  ])("classifies missing executable error %j as missing", async (message) => {
    mockExec.mockRejectedValueOnce(new Error(message));
    await expect(probeAgySupport()).resolves.toMatchObject({
      status: "missing",
      available: false,
      detected: false,
    });
  });

  it("classifies a non-missing version probe failure as unusable", async () => {
    mockExec.mockRejectedValueOnce(new Error("Command timed out after 5s"));
    await expect(probeAgySupport()).resolves.toMatchObject({
      status: "unusable",
      available: false,
      detected: true,
      requiredVersion: ANTIGRAVITY.MINIMUM_AGY_VERSION,
    });
  });
});
