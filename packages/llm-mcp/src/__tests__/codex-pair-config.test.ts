import { describe, expect, it } from "vitest";
import type { Frontmatter } from "../../scripts/lib/frontmatter.mts";
import { parseFrontmatter } from "../../scripts/lib/frontmatter.mts";
import { loadPairDefaults } from "../../scripts/lib/pair-config-io.mts";
import { resolveConfig } from "../../scripts/lib/pair-config.mts";

const defaults = { model: "default", fallbackModel: "fallback", reasoningEffort: "medium" };
const env = {
  ASK_CODEX_MODEL: "env-model",
  ASK_CODEX_FALLBACK_MODEL: "env-fallback",
  ASK_CODEX_REASONING_EFFORT: "low",
  ASK_CODEX_TIMEOUT_MS: "1234",
  CODEX_PAIR_MAX_FILE_BYTES: "5678",
  ASK_CODEX_DEBOUNCE_MS: "90",
  ASK_CODEX_DEBOUNCE_MAX_MS: "100",
};

describe("pair configuration contract (ADR-079/187/192)", () => {
  it.each([undefined, null, {}])("uses defaults for an absent or empty marker: %s", (marker) => {
    expect(resolveConfig(marker, {}, defaults)).toEqual({
      reviewer: "codex",
      model: "default",
      fallbackModel: "fallback",
      reasoningEffort: "medium",
      timeoutMs: 800000,
      maxFileBytes: 20000,
      surfaceThreshold: "med",
      debounceMs: 15000,
      debounceMaxMs: 60000,
      blockOn: null,
    });
  });

  it("uses environment values above defaults", () => {
    expect(resolveConfig({}, env, defaults)).toEqual({
      reviewer: "codex",
      model: "env-model",
      fallbackModel: "env-fallback",
      reasoningEffort: "low",
      timeoutMs: 1234,
      maxFileBytes: 5678,
      surfaceThreshold: "med",
      debounceMs: 90,
      debounceMaxMs: 100,
      blockOn: null,
    });
  });

  it("uses marker values above environment, including zero debounce", () => {
    const marker = {
      model: "pinned",
      fallbackModel: "backup",
      reasoningEffort: "xhigh",
      timeoutMs: 42,
      maxFileBytes: 99,
      surfaceThreshold: "low",
      debounceMs: 0,
      debounceMaxMs: 10,
    };
    expect(resolveConfig(marker, env, defaults)).toEqual({ ...marker, reviewer: "codex", blockOn: null });
  });

  it("invalid marker values fall through to environment", () => {
    expect(
      resolveConfig(
        {
          model: "",
          fallbackModel: false,
          reasoningEffort: "invalid",
          timeoutMs: 0,
          maxFileBytes: "100",
          surfaceThreshold: "HIGH",
          debounceMs: -1,
          debounceMaxMs: 0,
        },
        env,
        defaults,
      ),
    ).toEqual({
      reviewer: "codex",
      model: "env-model",
      fallbackModel: "env-fallback",
      reasoningEffort: "low",
      timeoutMs: 1234,
      maxFileBytes: 5678,
      surfaceThreshold: "med",
      debounceMs: 90,
      debounceMaxMs: 100,
      blockOn: null,
    });
  });

  it.each(["", "0", "-1", "NaN", "Infinity", "invalid"])("rejects non-positive/non-finite env timeout %j", (value) => {
    expect(resolveConfig({}, { ASK_CODEX_TIMEOUT_MS: value }, defaults).timeoutMs).toBe(800000);
    expect(
      resolveConfig(
        { reviewer: "claude" },
        { CODEX_PAIR_HOST: "grok", ASK_CLAUDE_TIMEOUT_MS: value, ASK_CODEX_TIMEOUT_MS: "1234" },
        defaults,
      ).timeoutMs,
    ).toBe(600000);
  });

  it.each<Frontmatter>([{ timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: "42" }, { timeoutMs: false }])(
    "invalid marker timeout falls through for either reviewer: %j",
    (marker) => {
      expect(resolveConfig(marker, env, defaults).timeoutMs).toBe(1234);
      expect(
        resolveConfig(
          { ...marker, reviewer: "claude" },
          { ...env, CODEX_PAIR_HOST: "grok", ASK_CLAUDE_TIMEOUT_MS: "5678" },
          defaults,
        ).timeoutMs,
      ).toBe(5678);
    },
  );

  it.each(["low", "medium", "high", "xhigh", "max", "ultra"])("accepts supported marker effort %s", (effort) => {
    expect(resolveConfig({ reasoningEffort: effort }, env, defaults).reasoningEffort).toBe(effort);
  });

  it("invalid marker/env effort falls through to defaults, then high", () => {
    expect(
      resolveConfig({ reasoningEffort: true }, { ASK_CODEX_REASONING_EFFORT: "invalid" }, defaults).reasoningEffort,
    ).toBe("medium");
    expect(
      resolveConfig({}, { ASK_CODEX_REASONING_EFFORT: "" }, { ...defaults, reasoningEffort: "invalid" })
        .reasoningEffort,
    ).toBe("high");
  });

  it("preserves the existing numeric environment coercion for size and debounce", () => {
    expect(
      resolveConfig(
        {},
        { CODEX_PAIR_MAX_FILE_BYTES: "", ASK_CODEX_DEBOUNCE_MS: "-1", ASK_CODEX_DEBOUNCE_MAX_MS: "Infinity" },
        defaults,
      ),
    ).toMatchObject({ maxFileBytes: 0, debounceMs: -1, debounceMaxMs: Infinity });
    expect(resolveConfig({}, { CODEX_PAIR_MAX_FILE_BYTES: "invalid" }, defaults).maxFileBytes).toBeNaN();
  });

  it("loads shipped defaults through the package-relative public loader", () => {
    expect(loadPairDefaults()).toEqual({
      model: "gpt-6.1-sol",
      fallbackModel: "gpt-6.1-terra",
      reasoningEffort: "high",
    });
  });

  it("resolves Claude's fixed model and provider-specific timeout", () => {
    expect(
      resolveConfig({ reviewer: "claude", model: "ignored" }, { ...env, CODEX_PAIR_HOST: "grok" }, defaults),
    ).toMatchObject({ reviewer: "claude", model: "claude-opus-5-5", timeoutMs: 600000 });
    expect(
      resolveConfig(
        { reviewer: "claude" },
        { ...env, CODEX_PAIR_HOST: "grok", ASK_CLAUDE_TIMEOUT_MS: "5678" },
        defaults,
      ).timeoutMs,
    ).toBe(5678);
    expect(
      resolveConfig(
        { reviewer: "claude", timeoutMs: 42 },
        { CODEX_PAIR_HOST: "grok", ASK_CLAUDE_TIMEOUT_MS: "5678" },
        defaults,
      ).timeoutMs,
    ).toBe(42);
  });

  it.each([{}, { CODEX_PAIR_HOST: "grok" }])("rejects unsupported reviewers for either host: %j", (host) => {
    expect(() => resolveConfig({ reviewer: "invalid" }, host, defaults)).toThrow("reviewer must be codex or claude");
  });

  it("refuses Claude reviewing Claude edits", () => {
    expect(() => resolveConfig({ reviewer: "claude" }, {}, defaults)).toThrow(
      "claude cannot review its own model family's edits (claude writer)",
    );
  });

  it.each([
    ["HIGH", "HIGH"],
    ['"HIGH"', null],
    ["'HIGH'", null],
    ["HIGH # comment", null],
    ["high", null],
    ["false", null],
    ["", null],
    ["HIGH\nblockOn: false", "HIGH"],
  ])("Stop gate enables blocking only for the exact scalar %j", (value, expected) => {
    const text = `---\nblockOn: ${value}\n---\nbody`;
    expect(resolveConfig(parseFrontmatter(text).frontmatter, {}, defaults, text).blockOn).toBe(expected);
  });

  it("blockOn in the body or malformed frontmatter remains advisory", () => {
    expect(resolveConfig({}, {}, defaults, "blockOn: HIGH").blockOn).toBeNull();
    expect(resolveConfig({}, {}, defaults, "---\nblockOn: HIGH").blockOn).toBeNull();
  });
});
