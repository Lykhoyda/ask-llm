import { describe, expect, it } from "vitest";
import type { Frontmatter } from "../../scripts/lib/frontmatter.mts";
import { resolveConfig, positiveMs } from "../../scripts/lib/pair-config.mts";
import { DEFAULT_SURFACE_THRESHOLD, VALID_THRESHOLDS } from "../../scripts/lib/parser.mts";
import { DEFAULT_DEBOUNCE_MS, DEFAULT_DEBOUNCE_MAX_MS } from "../../scripts/lib/debounce-state.mts";

// Frozen pre-extraction behavior: preserve even unusual numeric env coercions.
function legacyConfig(
  frontmatter: Frontmatter | null | undefined,
  env: Record<string, string | undefined>,
  defaults: { model: string; fallbackModel: string; reasoningEffort: string },
) {
  const CODEX_PAIR_DEFAULTS = defaults;
  const DEFAULT_MODEL = env.ASK_CODEX_MODEL ?? CODEX_PAIR_DEFAULTS.model;
  const FALLBACK_MODEL = env.ASK_CODEX_FALLBACK_MODEL ?? CODEX_PAIR_DEFAULTS.fallbackModel;
  const CODEX_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "ultra"]);
  const configuredReasoningEffort = env.ASK_CODEX_REASONING_EFFORT;
  const DEFAULT_REASONING_EFFORT =
    configuredReasoningEffort && CODEX_REASONING_EFFORTS.has(configuredReasoningEffort)
      ? configuredReasoningEffort
      : CODEX_REASONING_EFFORTS.has(CODEX_PAIR_DEFAULTS.reasoningEffort)
        ? CODEX_PAIR_DEFAULTS.reasoningEffort
        : "high";
  const DEFAULT_TIMEOUT_MS = positiveMs(env.ASK_CODEX_TIMEOUT_MS) ?? 800_000;
  const MAX_FILE_BYTES = Number(env.CODEX_PAIR_MAX_FILE_BYTES ?? 20_000);
  const DEBOUNCE_MS = Number(env.ASK_CODEX_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS);
  const DEBOUNCE_MAX_MS = Number(env.ASK_CODEX_DEBOUNCE_MAX_MS ?? DEFAULT_DEBOUNCE_MAX_MS);
  // Empty, non-numeric, non-positive, and infinite timeouts would make setTimeout fire at once.

  // Invalid frontmatter values fall through to environment and defaults.
  function resolveLegacyConfig(frontmatter: Frontmatter | null | undefined) {
    const fm = frontmatter ?? {};
    const surfaceCandidate = typeof fm.surfaceThreshold === "string" ? fm.surfaceThreshold : null;
    return {
      model: typeof fm.model === "string" && fm.model.length > 0 ? fm.model : DEFAULT_MODEL,
      fallbackModel:
        typeof fm.fallbackModel === "string" && fm.fallbackModel.length > 0 ? fm.fallbackModel : FALLBACK_MODEL,
      timeoutMs: typeof fm.timeoutMs === "number" && fm.timeoutMs > 0 ? fm.timeoutMs : DEFAULT_TIMEOUT_MS,
      maxFileBytes: typeof fm.maxFileBytes === "number" && fm.maxFileBytes > 0 ? fm.maxFileBytes : MAX_FILE_BYTES,
      surfaceThreshold:
        surfaceCandidate && VALID_THRESHOLDS.has(surfaceCandidate) ? surfaceCandidate : DEFAULT_SURFACE_THRESHOLD,
      debounceMs: typeof fm.debounceMs === "number" && fm.debounceMs >= 0 ? fm.debounceMs : DEBOUNCE_MS,
      debounceMaxMs: typeof fm.debounceMaxMs === "number" && fm.debounceMaxMs > 0 ? fm.debounceMaxMs : DEBOUNCE_MAX_MS,
    };
  }

  return { ...resolveLegacyConfig(frontmatter), reasoningEffort: DEFAULT_REASONING_EFFORT };
}

describe("configuration extraction compatibility", () => {
  it("preserves existing marker/env/default combinations before adding marker effort", () => {
    const markers = [
      undefined,
      null,
      {},
      {
        model: "pinned",
        fallbackModel: "backup",
        timeoutMs: 42,
        maxFileBytes: 99,
        surfaceThreshold: "low",
        debounceMs: 0,
        debounceMaxMs: 10,
      },
      {
        model: "",
        fallbackModel: false,
        timeoutMs: -1,
        maxFileBytes: "100",
        surfaceThreshold: "HIGH",
        debounceMs: -1,
        debounceMaxMs: 0,
      },
    ];
    const envs = [
      {},
      ...["", "0", "-1", "NaN", "Infinity", "42", "medium", "invalid"].map((value) =>
        Object.fromEntries(
          [
            "ASK_CODEX_MODEL",
            "ASK_CODEX_FALLBACK_MODEL",
            "ASK_CODEX_TIMEOUT_MS",
            "CODEX_PAIR_MAX_FILE_BYTES",
            "ASK_CODEX_DEBOUNCE_MS",
            "ASK_CODEX_DEBOUNCE_MAX_MS",
            "ASK_CODEX_REASONING_EFFORT",
          ].map((key) => [key, value]),
        ),
      ),
    ];
    for (const marker of markers)
      for (const env of envs)
        for (const effort of ["high", "ultra", "invalid"]) {
          const defaults = { model: "default", fallbackModel: "fallback", reasoningEffort: effort };
          const { blockOn, ...resolved } = resolveConfig(marker, env, defaults);
          expect(blockOn).toBeNull();
          expect(resolved).toEqual(legacyConfig(marker, env, defaults));
        }
  });
});

it("valid marker effort wins, invalid marker/env effort falls through", () => {
  const defaults = { model: "default", fallbackModel: "fallback", reasoningEffort: "medium" };
  expect(
    resolveConfig({ reasoningEffort: "xhigh" }, { ASK_CODEX_REASONING_EFFORT: "low" }, defaults).reasoningEffort,
  ).toBe("xhigh");
  expect(
    resolveConfig({ reasoningEffort: "invalid" }, { ASK_CODEX_REASONING_EFFORT: "low" }, defaults).reasoningEffort,
  ).toBe("low");
  expect(
    resolveConfig({ reasoningEffort: true }, { ASK_CODEX_REASONING_EFFORT: "invalid" }, defaults).reasoningEffort,
  ).toBe("medium");
});
it("preserves the Stop gate's exact opt-in grammar", () => {
  for (const value of ["HIGH", '"HIGH"', "HIGH # comment", "high", "false", "", "HIGH\nblockOn: false"]) {
    const text = `---\nblockOn: ${value}\n---\nbody`;
    const legacy = text
      .match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
      .match(/^\s*blockOn:\s*(\S+)\s*$/m)?.[1]
      .trim();
    expect(resolveConfig({}, {}, { model: "d", fallbackModel: "f", reasoningEffort: "high" }, text).blockOn).toBe(
      legacy === "HIGH" ? "HIGH" : null,
    );
  }
});
