import { describe, expect, it } from "vitest";
import { FACTORY_DEFAULT_MODEL } from "../constants.js";
import { executeGrokCLI, listGrokCliModels, probeGrokCli } from "../utils/grokCliExecutor.js";
import { executeGrokAPI, listModels } from "../utils/grokExecutor.js";

const LIVE = process.env.GROK_LIVE_TEST === "1" && Boolean(process.env.XAI_API_KEY);
const CLI_LIVE = process.env.GROK_CLI_LIVE_TEST === "1" && Boolean(process.env.GROK_CLI_LIVE_MODEL);
const TIMEOUT = 180_000;

describe.skipIf(!LIVE)("opt-in xAI API integration", () => {
  it(
    "discovers the documented Grok model",
    async () => {
      await expect(listModels()).resolves.toContain(FACTORY_DEFAULT_MODEL);
    },
    TIMEOUT,
  );

  it(
    "returns a small Grok consultation without fallback",
    async () => {
      const result = await executeGrokAPI({
        prompt: "Reply with only the number that equals two plus two.",
        reasoningEffort: "low",
      });
      expect(result.response).toMatch(/4/);
      expect(result.model).toBeTruthy();
      expect(result.usage.fellBack).toBe(false);
    },
    TIMEOUT,
  );
});

describe.skipIf(!CLI_LIVE)("opt-in Grok CLI integration", () => {
  it(
    "discovers and invokes the exact requested CLI model",
    async () => {
      expect(await probeGrokCli()).toBe(true);
      const model = process.env.GROK_CLI_LIVE_MODEL ?? "";
      expect(await listGrokCliModels()).toContain(model);
      const result = await executeGrokCLI({
        prompt: "Reply with only the number that equals two plus two.",
        model,
        reasoningEffort: "low",
      });
      expect(result.response).toMatch(/4/);
      expect(result.model).toBeTruthy();
      expect(result.usage.fellBack).toBe(false);
    },
    TIMEOUT,
  );
});
