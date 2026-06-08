import { afterEach, describe, expect, it } from "vitest";
import {
  ERROR_MESSAGES,
  GEMINI_TIER_CUTOFF_DEFAULT,
  OPERATIONAL_PATTERNS,
  TIER_ACCESS_PATTERNS,
  TIER_NOTE_MARKER,
} from "../constants.js";
import { classifyGeminiCliError, formatTierNote, resolveTierCutoff } from "../utils/tierGuidance.js";

const POST = new Date("2027-01-01T00:00:00Z"); // after cutoff
const PRE = new Date("2026-01-01T00:00:00Z"); // before cutoff
const CUTOFF = new Date(GEMINI_TIER_CUTOFF_DEFAULT);

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

  it("the discontinuation message contains the marker, the cutoff date, and the ask-antigravity-mcp migration path", () => {
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toContain(TIER_NOTE_MARKER);
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toContain("2026-06-18");
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toMatch(/ask-antigravity-mcp/);
    expect(ERROR_MESSAGES.TIER_DISCONTINUED).toMatch(/ask-codex|ask-ollama/);
  });
});

describe("classifyGeminiCliError", () => {
  it("classifies workspace-trust", () => {
    expect(classifyGeminiCliError("FatalUntrustedWorkspaceError: nope")).toBe("workspaceTrust");
  });
  it("classifies quota (RESOURCE_EXHAUSTED)", () => {
    expect(classifyGeminiCliError("status RESOURCE_EXHAUSTED")).toBe("quota");
  });
  it("classifies tierAccess for 403 / PERMISSION_DENIED", () => {
    expect(classifyGeminiCliError("code 403 forbidden")).toBe("tierAccess");
    expect(classifyGeminiCliError("PERMISSION_DENIED: not allowed")).toBe("tierAccess");
  });
  it("classifies operational for timeouts/parse", () => {
    expect(classifyGeminiCliError("Command timed out after 800000ms")).toBe("operational");
  });
  it("word boundaries prevent mid-token false matches", () => {
    expect(classifyGeminiCliError("error code 1401")).toBe("unknown"); // not "401"
    expect(classifyGeminiCliError("RESOURCE_EXHAUSTED_LIMIT_EXCEEDED")).toBe("unknown"); // trailing _ blocks quota
    expect(classifyGeminiCliError("HTTP 1403 gateway")).toBe("unknown"); // not "403"
  });
});

describe("resolveTierCutoff", () => {
  const KEY = "ASK_GEMINI_TIER_CUTOFF";
  afterEach(() => {
    delete process.env[KEY];
  });
  it("defaults to the UTC constant", () => {
    expect(resolveTierCutoff().toISOString()).toBe(new Date(GEMINI_TIER_CUTOFF_DEFAULT).toISOString());
  });
  it("honors a valid override", () => {
    process.env[KEY] = "2020-01-01T00:00:00Z";
    expect(resolveTierCutoff().toISOString()).toBe("2020-01-01T00:00:00.000Z");
  });
  it("falls back to default on an invalid override", () => {
    process.env[KEY] = "not-a-date";
    expect(resolveTierCutoff().toISOString()).toBe(new Date(GEMINI_TIER_CUTOFF_DEFAULT).toISOString());
  });
});

describe("formatTierNote", () => {
  it("pre-cutoff: returns the message unchanged even for tierAccess/quota", () => {
    expect(formatTierNote("403 forbidden", "tierAccess", PRE, CUTOFF)).toBe("403 forbidden");
    expect(formatTierNote("RESOURCE_EXHAUSTED", "quota", PRE, CUTOFF)).toBe("RESOURCE_EXHAUSTED");
  });
  it("post-cutoff + tierAccess: PREPENDS the note", () => {
    const out = formatTierNote("403 forbidden", "tierAccess", POST, CUTOFF);
    expect(out.startsWith("⚠️")).toBe(true);
    expect(out).toContain(TIER_NOTE_MARKER);
    expect(out).toContain("403 forbidden");
    expect(out.indexOf(TIER_NOTE_MARKER)).toBeLessThan(out.indexOf("403 forbidden"));
  });
  it("post-cutoff + quota: PREPENDS the note", () => {
    expect(formatTierNote("RESOURCE_EXHAUSTED", "quota", POST, CUTOFF)).toContain(TIER_NOTE_MARKER);
  });
  it("post-cutoff + operational: unchanged (no note)", () => {
    expect(formatTierNote("Command timed out", "operational", POST, CUTOFF)).toBe("Command timed out");
  });
  it("is idempotent (no double prepend)", () => {
    const once = formatTierNote("403", "tierAccess", POST, CUTOFF);
    const twice = formatTierNote(once, "tierAccess", POST, CUTOFF);
    expect(twice).toBe(once);
  });
});
