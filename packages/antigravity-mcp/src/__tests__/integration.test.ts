import { describe, expect, it } from "vitest";
import { executeAntigravityCLI } from "../utils/antigravityExecutor.js";

const SMOKE = !!process.env.SMOKE_TEST;
// agy spawns a full agent (transcript-scraped response), so it's the slowest
// provider — give it a generous ceiling under the executor's 300s default.
const TIMEOUT = 240_000;

describe.skipIf(!SMOKE)("Antigravity (agy) CLI integration", () => {
  it(
    "returns a non-empty response for a simple prompt",
    async () => {
      const result = await executeAntigravityCLI({
        prompt: "What is 2+2? Reply with just the number.",
      });

      expect(result.response).toBeTruthy();
      expect(result.response.length).toBeGreaterThan(0);
      expect(result.response).toMatch(/4/);
    },
    TIMEOUT,
  );
});
