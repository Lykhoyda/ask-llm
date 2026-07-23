import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANTIGRAVITY } from "../../constants.js";

vi.mock("../../utils/agyVersion.js", () => ({
  probeAgySupport: vi.fn(),
}));

import { probeAgySupport } from "../../utils/agyVersion.js";
import { pingTool } from "../simple-tools.js";

const mockProbeAgySupport = vi.mocked(probeAgySupport);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Antigravity ping", () => {
  it("reports a supported detected version", async () => {
    mockProbeAgySupport.mockResolvedValue({
      status: "supported",
      available: true,
      detected: true,
      version: "1.1.5",
      requiredVersion: ANTIGRAVITY.MINIMUM_AGY_VERSION,
      message: "supported",
    });

    await expect(pingTool.execute({})).resolves.toContain("agy detected and supported: 1.1.5");
  });

  it("reports detected-but-unsupported and unusable probes actionably", async () => {
    mockProbeAgySupport.mockResolvedValueOnce({
      status: "unsupported",
      available: false,
      detected: true,
      version: "1.1.4",
      requiredVersion: ANTIGRAVITY.MINIMUM_AGY_VERSION,
      message: `agy 1.1.4 was detected but is unsupported; agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION} is required.`,
      remediation: "Update Antigravity CLI.",
    });
    const unsupported = await pingTool.execute({});
    expect(unsupported).toContain("1.1.4 was detected but is unsupported");
    expect(unsupported).toContain(`agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION} is required`);
    expect(unsupported).toContain("Update Antigravity CLI");

    mockProbeAgySupport.mockResolvedValueOnce({
      status: "unusable",
      available: false,
      detected: true,
      requiredVersion: ANTIGRAVITY.MINIMUM_AGY_VERSION,
      message: `agy version is unknown and unusable; agy >=${ANTIGRAVITY.MINIMUM_AGY_VERSION} is required.`,
      remediation: "Update Antigravity CLI.",
    });
    const unusable = await pingTool.execute({});
    expect(unusable).toContain("version is unknown and unusable");
    expect(unusable).toContain("Update Antigravity CLI");
  });
});
