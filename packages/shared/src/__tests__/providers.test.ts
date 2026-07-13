import { describe, expect, it } from "vitest";
import { askResponseSchema } from "../askResponse.js";
import { PROVIDERS } from "../providers.js";

describe("PROVIDERS single source of truth", () => {
  it("lists all five providers", () => {
    expect(PROVIDERS).toEqual(["gemini", "codex", "claude", "ollama", "antigravity"]);
  });

  it("askResponseSchema accepts every provider in PROVIDERS", () => {
    for (const provider of PROVIDERS) {
      const parsed = askResponseSchema.parse({ provider, response: "ok", model: "m" });
      expect(parsed.provider).toBe(provider);
    }
  });

  it("askResponseSchema accepts usage stats for every provider in PROVIDERS", () => {
    for (const provider of PROVIDERS) {
      const parsed = askResponseSchema.parse({
        provider,
        response: "ok",
        model: "m",
        usage: { provider, model: "m", durationMs: 10, fellBack: false },
      });
      expect(parsed.usage?.provider).toBe(provider);
    }
  });
});
