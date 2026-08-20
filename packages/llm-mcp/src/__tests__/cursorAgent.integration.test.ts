import { describe, expect, it } from "vitest";
import { executeCursorAgent, listCursorModels, probeCursorAgent } from "../cursorAgent.js";

const LIVE = process.env.CURSOR_LIVE_TEST === "1" && Boolean(process.env.CURSOR_LIVE_MODEL);
const TIMEOUT = 180_000;

describe.skipIf(!LIVE)("opt-in Cursor Agent integration", () => {
  it(
    "discovers and invokes one exact model in read-only ask mode",
    async () => {
      expect(await probeCursorAgent()).toBe(true);
      const model = process.env.CURSOR_LIVE_MODEL ?? "";
      expect(await listCursorModels()).toContain(model);
      const result = await executeCursorAgent({
        provider: "grok",
        model,
        prompt: "Reply with only the number that equals two plus two.",
      });
      expect(result.response).toMatch(/4/);
      expect(result.model).toBeTruthy();
      expect(result.harness).toBe("cursor-agent");
      expect(result.usage.fellBack).toBe(false);
    },
    TIMEOUT,
  );
});
