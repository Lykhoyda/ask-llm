import { describe, expect, it } from "vitest";
import { askResponseSchema } from "../askResponse.js";

describe("askResponseSchema antigravity provider", () => {
  it("accepts provider 'antigravity'", () => {
    const parsed = askResponseSchema.safeParse({
      provider: "antigravity",
      response: "ok",
      model: "antigravity",
    });
    expect(parsed.success).toBe(true);
  });
});
