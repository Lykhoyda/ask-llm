import { describe, expect, it } from "vitest";
import {
  ERROR_MESSAGES,
  GEMINI_TIER_CUTOFF_DEFAULT,
  OPERATIONAL_PATTERNS,
  TIER_ACCESS_PATTERNS,
  TIER_NOTE_MARKER,
} from "../constants.js";

describe("tier-discontinuation constants", () => {
  it("cutoff default is an explicit UTC instant", () => {
    expect(GEMINI_TIER_CUTOFF_DEFAULT).toBe("2026-06-18T00:00:00Z");
    expect(Number.isNaN(new Date(GEMINI_TIER_CUTOFF_DEFAULT).getTime())).toBe(false);
  });

  it("tier-access patterns prioritize 403 / PERMISSION_DENIED", () => {
    expect(TIER_ACCESS_PATTERNS).toContain("403");
    expect(TIER_ACCESS_PATTERNS).toContain("PERMISSION_DENIED");
  });

  it("operational patterns include timeout signals", () => {
    expect(OPERATIONAL_PATTERNS).toContain("timed out");
  });

  it("the discontinuation message contains the marker, the cutoff date, and the agy caveat", () => {
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toContain(TIER_NOTE_MARKER);
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toContain("2026-06-18");
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toMatch(/does NOT yet support|not yet support/i);
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toMatch(/ask-codex|ask-ollama/);
  });
});
