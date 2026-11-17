import { EXECUTION } from "@ask-llm/shared";
import { describe, expect, it } from "vitest";
import { CODEX_TOOL_TIMEOUT_MARGIN_SEC, CODEX_TOOL_TIMEOUT_SEC } from "../hosts/registrars/codex.js";

describe("Codex host timeout", () => {
  it("covers every default per-attempt limit for the full provider ladder, plus overhead", () => {
    const limits = Object.entries(EXECUTION)
      .filter(([key]) => key.startsWith("DEFAULT_") && key.endsWith("TIMEOUT_MS"))
      .map(([, value]) => Number(value));
    expect(CODEX_TOOL_TIMEOUT_SEC).toBe(
      Math.ceil((Math.max(...limits) * EXECUTION.MAX_PROVIDER_ATTEMPTS) / 1000) + CODEX_TOOL_TIMEOUT_MARGIN_SEC,
    );
    expect(EXECUTION.MAX_PROVIDER_ATTEMPTS).toBe(3);
    expect(CODEX_TOOL_TIMEOUT_SEC).toBe(2460);
    expect(CODEX_TOOL_TIMEOUT_MARGIN_SEC).toBeGreaterThan(0);
  });
});
