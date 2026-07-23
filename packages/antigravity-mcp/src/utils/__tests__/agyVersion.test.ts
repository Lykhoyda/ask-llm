import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY, CLI } from "../../constants.js";

vi.mock("@ask-llm/shared", () => ({
  executeCommand: vi.fn(),
}));

import { executeCommand } from "@ask-llm/shared";
import { assertSupportedAgyVersion } from "../agyVersion.js";

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
        `Antigravity CLI \\(agy\\) 1\\.1\\.4 is unsupported.*requires agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION}.*Update Antigravity CLI`,
        "s",
      ),
    );
  });

  it("rejects an unparseable version response actionably", async () => {
    mockExec.mockResolvedValue("Antigravity development build");

    await expect(assertSupportedAgyVersion()).rejects.toThrow(
      new RegExp(
        `Unable to determine the Antigravity CLI version.*requires agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION}`,
        "s",
      ),
    );
  });
});
