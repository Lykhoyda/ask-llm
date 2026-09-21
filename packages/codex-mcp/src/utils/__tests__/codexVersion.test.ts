import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASTRA_MIN_CODEX_VERSION, CLI, CODEX_VERSION_CHECK_TIMEOUT_MS } from "../../constants.js";

vi.mock("@ask-llm/shared", () => ({
  executeCommand: vi.fn(),
  isCommandNotFoundError: (detail: string) =>
    /enoent|not found on path|command not found|is not recognized as an internal or external command/i.test(detail),
}));

import { executeCommand } from "@ask-llm/shared";
import { assertCodexSupportsModel, assessCodexVersion, isAstraModel, isVersionAtLeast } from "../codexVersion.js";

const mockExec = vi.mocked(executeCommand);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isAstraModel", () => {
  it("matches only the selectable gpt-6-astra slug", () => {
    expect(isAstraModel("gpt-6-astra")).toBe(true);
    expect(isAstraModel("gpt-5.6-sol")).toBe(false);
    expect(isAstraModel("gpt-5.6-terra")).toBe(false);
    expect(isAstraModel("gpt-6-astra-wm")).toBe(false);
    expect(isAstraModel("gpt-6-astra-aeon")).toBe(false);
  });
});

describe("isVersionAtLeast", () => {
  it("accepts the Astra floor and newer Codex builds", () => {
    expect(isVersionAtLeast("0.153.0", ASTRA_MIN_CODEX_VERSION)).toBe(true);
    expect(isVersionAtLeast("codex-cli 0.154.0", ASTRA_MIN_CODEX_VERSION)).toBe(true);
    expect(isVersionAtLeast("0.155.1", ASTRA_MIN_CODEX_VERSION)).toBe(true);
    expect(isVersionAtLeast("0.156.0-alpha.7", ASTRA_MIN_CODEX_VERSION)).toBe(true);
  });

  it("rejects older and unparseable versions", () => {
    expect(isVersionAtLeast("0.152.9", ASTRA_MIN_CODEX_VERSION)).toBe(false);
    expect(isVersionAtLeast("0.153.0-alpha.5", ASTRA_MIN_CODEX_VERSION)).toBe(false);
    expect(isVersionAtLeast("development build", ASTRA_MIN_CODEX_VERSION)).toBe(false);
  });
});

describe("assessCodexVersion", () => {
  it("classifies supported, unsupported, and unparseable versions", () => {
    expect(assessCodexVersion("codex-cli 0.154.0")).toMatchObject({
      status: "supported",
      available: true,
      version: "0.154.0",
      requiredVersion: ASTRA_MIN_CODEX_VERSION,
    });
    expect(assessCodexVersion("0.152.1")).toMatchObject({
      status: "unsupported",
      available: false,
      version: "0.152.1",
      requiredVersion: ASTRA_MIN_CODEX_VERSION,
    });
    expect(assessCodexVersion("development build")).toMatchObject({
      status: "unusable",
      available: false,
      requiredVersion: ASTRA_MIN_CODEX_VERSION,
    });
  });
});

describe("assertCodexSupportsModel", () => {
  it("does not probe Codex version for non-Astra models", async () => {
    await expect(assertCodexSupportsModel("gpt-5.6-sol")).resolves.toBeUndefined();
    await expect(assertCodexSupportsModel("gpt-5.6-terra")).resolves.toBeUndefined();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("accepts Astra on a supported Codex CLI", async () => {
    mockExec.mockResolvedValue("codex-cli 0.154.0");

    await expect(assertCodexSupportsModel("gpt-6-astra")).resolves.toBe("0.154.0");
    expect(mockExec).toHaveBeenCalledWith(
      CLI.COMMANDS.CODEX,
      [CLI.FLAGS.VERSION],
      undefined,
      undefined,
      undefined,
      CODEX_VERSION_CHECK_TIMEOUT_MS,
      undefined,
      undefined,
    );
  });

  it("rejects Astra on an older Codex CLI with an actionable diagnostic", async () => {
    mockExec.mockResolvedValue("codex-cli 0.152.1");

    await expect(assertCodexSupportsModel("gpt-6-astra")).rejects.toThrow(
      new RegExp(
        `Codex CLI 0\\.152\\.1 was detected but is too old for gpt-6-astra.*codex >=${ASTRA_MIN_CODEX_VERSION} is required.*ASK_CODEX_MODEL=gpt-5\\.6-sol`,
        "s",
      ),
    );
  });
});
