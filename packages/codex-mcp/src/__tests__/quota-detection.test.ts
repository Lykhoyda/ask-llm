import { classifyProviderFailure } from "@ask-llm/shared";
import { describe, expect, it } from "vitest";
import { isModelUnavailableError, isQuotaError, parseCodexJsonlOutput } from "../utils/codexExecutor.js";

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

// #196 / ADR-126 follow-up: a pinned ASK_CODEX_FALLBACK_MODEL can be structurally
// unavailable on some account types — e.g. gpt-5.5-mini returns a 400 ("not
// supported when using Codex with a ChatGPT account") on ChatGPT-plan accounts.
// This is a 400, NOT a quota signal, so isQuotaError must NOT match it; a
// dedicated predicate classifies it so the fallback leg can surface an actionable
// message. Ports MODEL_UNAVAILABLE_SIGNALS from codex-pair-watch.mjs (ADR-123).
describe("isModelUnavailableError — structural account-incompatibility detection", () => {
  it("detects the ChatGPT-account 400 (case-insensitive)", () => {
    expect(
      isModelUnavailableError(
        new Error("400 The model gpt-5.5-mini is not supported when using Codex with a ChatGPT account."),
      ),
    ).toBe(true);
  });

  it("does NOT classify a structural-unavailability 400 as a quota error", () => {
    const err = new Error("gpt-5.5-mini is not supported when using Codex with a ChatGPT account");
    expect(isQuotaError(err)).toBe(false);
  });

  it("does not match unrelated errors or plain quota signals", () => {
    expect(isModelUnavailableError(new Error("rate_limit_exceeded"))).toBe(false);
    expect(isModelUnavailableError(new Error("spawn codex ENOENT"))).toBe(false);
    expect(isModelUnavailableError("session is archived")).toBe(false);
  });

  it("handles non-Error inputs by stringifying", () => {
    expect(isModelUnavailableError("is not supported when using Codex with a ChatGPT account")).toBe(true);
    expect(isModelUnavailableError(undefined)).toBe(false);
  });
});

// Pins the exit-0 path the reviewer flagged: codex can exit 0 yet emit
// {"type":"error","message":"You've hit your usage limit"} as a JSONL event
// with no agent_message. parseCodexJsonlOutput throws "Codex error event: ..."
// and isQuotaError must classify that thrown message as quota (ADR-117).
describe("parseCodexJsonlOutput — exit-0 error-event quota path", () => {
  const errorEventJsonl =
    '{"type":"thread.started","thread_id":"t1"}\n' +
    '{"type":"turn.started"}\n' +
    '{"type":"error","message":"You\'ve hit your usage limit. Upgrade to Pro."}\n' +
    '{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit. Upgrade to Pro."}}';

  it("throws 'Codex error event: <message>' when no agent_message is present", () => {
    expect(() => parseCodexJsonlOutput(errorEventJsonl, "gpt-5.5", 100, false)).toThrow(/Codex error event:/);
    expect(() => parseCodexJsonlOutput(errorEventJsonl, "gpt-5.5", 100, false)).toThrow(/usage limit/);
  });

  it("the thrown message is classified as quota by isQuotaError", () => {
    let thrown: unknown;
    try {
      parseCodexJsonlOutput(errorEventJsonl, "gpt-5.5", 100, false);
    } catch (e) {
      thrown = e;
    }
    expect(isQuotaError(thrown)).toBe(true);
  });

  it.each([
    "You've hit your usage limit. Upgrade to Pro.",
    "Error 429: too many requests",
    "Workspace spend cap reached",
  ])("normalizes an exit-zero error event as rate_limited: %s", (message) => {
    let thrown: unknown;
    try {
      parseCodexJsonlOutput(JSON.stringify({ type: "error", message }), "gpt-5.6-sol", 100, false);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(classifyProviderFailure(thrown)).toBe("rate_limited");
  });
});
