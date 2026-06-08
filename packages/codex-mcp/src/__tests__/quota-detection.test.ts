import { describe, expect, it } from "vitest";
import { isQuotaError } from "../utils/codexExecutor.js";

// ADR-117: codex 0.137 reports plan exhaustion as "You've hit your usage limit"
// (on stdout JSONL), a format none of the pre-0.137 signals matched — so the
// gpt-5.5 -> gpt-5.5-mini fallback silently never fired. isQuotaError() must
// classify it as quota.
describe("isQuotaError — codex quota signal detection", () => {
  it("detects codex 0.137 'You've hit your usage limit' (ADR-117 regression)", () => {
    expect(isQuotaError(new Error("You've hit your usage limit. Upgrade to Pro or try again at Jun 11th."))).toBe(true);
  });

  it("detects the message inside a combined stderr+stdout error blob", () => {
    const combined =
      'Reading additional input from stdin...\n{"type":"error","message":"You\'ve hit your usage limit."}';
    expect(isQuotaError(new Error(combined))).toBe(true);
  });

  it.each([
    "rate_limit_exceeded",
    "quota_exceeded",
    "Error 429: too many requests",
    "insufficient_quota",
    "You are out of credits",
    "workspace spend cap reached",
  ])("still detects pre-existing quota signal: %s", (msg) => {
    expect(isQuotaError(new Error(msg))).toBe(true);
  });

  it("does not classify unrelated errors as quota", () => {
    expect(isQuotaError(new Error("Reading additional input from stdin..."))).toBe(false);
    expect(isQuotaError(new Error("spawn codex ENOENT"))).toBe(false);
    expect(isQuotaError("session is archived")).toBe(false);
  });

  it("handles non-Error inputs by stringifying", () => {
    expect(isQuotaError("hit your usage limit")).toBe(true);
    expect(isQuotaError(undefined)).toBe(false);
  });
});
