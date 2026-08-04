import { describe, expect, it } from "vitest";
import { CLI, OUTPUT_FORMATS } from "../constants.js";
import { buildArgs } from "../utils/antigravityExecutor.js";

describe("Antigravity machine options", () => {
  it("uses plan+sandbox without dangerous permission bypass for machine review", () => {
    const args = buildArgs("review", [], 295, true, "Gemini 3.1 Pro (High)", true);

    expect(args).toContain("--mode");
    expect(args).toContain("plan");
    expect(args).toContain("--sandbox");
    expect(args).not.toContain("--dangerously-skip-permissions");
    // legacy display strings carry their own effort tier — pairing --effort would be rejected by agy
    expect(args).not.toContain(CLI.FLAGS.EFFORT);
  });

  it("keeps legacy human argv when read-only mode is disabled", () => {
    const args = buildArgs("review", [], 295, true, "Gemini 3.1 Pro (High)", false);

    expect(args).toEqual([
      CLI.FLAGS.PRINT,
      "review",
      CLI.FLAGS.MODEL,
      "Gemini 3.1 Pro (High)",
      CLI.FLAGS.PRINT_TIMEOUT,
      "295s",
      CLI.FLAGS.OUTPUT_FORMAT,
      OUTPUT_FORMATS.JSON,
      CLI.FLAGS.SKIP_PERMISSIONS,
      CLI.FLAGS.SANDBOX,
    ]);
  });
});
