import { afterEach, describe, expect, it } from "vitest";
import { ALLOW_NESTED_ENV_VAR, CLAUDE_HOST_ENV_VAR } from "../constants.js";
import { isNestedSessionBlocked } from "../utils/claudeExecutor.js";

// The nested-session guard (ADR-134) must keep blocking real Claude Code
// sessions, but IDE integrated terminals that set CLAUDECODE need an explicit
// escape via ASK_CLAUDE_ALLOW_NESTED so a human can drive Codex/another MCP host.
describe("isNestedSessionBlocked", () => {
  const originalHost = process.env[CLAUDE_HOST_ENV_VAR];
  const originalAllow = process.env[ALLOW_NESTED_ENV_VAR];

  afterEach(() => {
    restore(CLAUDE_HOST_ENV_VAR, originalHost);
    restore(ALLOW_NESTED_ENV_VAR, originalAllow);
  });

  function restore(key: string, value: string | undefined) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it("does not block when CLAUDECODE is unset", () => {
    expect(isNestedSessionBlocked({})).toBe(false);
  });

  it("blocks when CLAUDECODE is set and no override is present", () => {
    expect(isNestedSessionBlocked({ [CLAUDE_HOST_ENV_VAR]: "1" })).toBe(true);
  });

  it("does not block when the override is set to a truthy value", () => {
    expect(isNestedSessionBlocked({ [CLAUDE_HOST_ENV_VAR]: "1", [ALLOW_NESTED_ENV_VAR]: "1" })).toBe(false);
    expect(isNestedSessionBlocked({ [CLAUDE_HOST_ENV_VAR]: "1", [ALLOW_NESTED_ENV_VAR]: "true" })).toBe(false);
  });

  it("still blocks when the override is present but not truthy", () => {
    expect(isNestedSessionBlocked({ [CLAUDE_HOST_ENV_VAR]: "1", [ALLOW_NESTED_ENV_VAR]: "0" })).toBe(true);
    expect(isNestedSessionBlocked({ [CLAUDE_HOST_ENV_VAR]: "1", [ALLOW_NESTED_ENV_VAR]: "" })).toBe(true);
  });

  it("defaults to reading process.env", () => {
    delete process.env[CLAUDE_HOST_ENV_VAR];
    delete process.env[ALLOW_NESTED_ENV_VAR];
    expect(isNestedSessionBlocked()).toBe(false);
    process.env[CLAUDE_HOST_ENV_VAR] = "1";
    expect(isNestedSessionBlocked()).toBe(true);
    process.env[ALLOW_NESTED_ENV_VAR] = "1";
    expect(isNestedSessionBlocked()).toBe(false);
  });
});
