import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeCommand,
  isCommandNotFoundError,
  quoteArgsForWindows,
  resolveTimeoutMs,
  sanitizeErrorForLLM,
} from "../commandExecutor.js";
import { EXECUTION, LOG_LEVEL_ENV_VAR } from "../constants.js";

describe("quoteArgsForWindows", () => {
  it("leaves simple args unchanged", () => {
    expect(quoteArgsForWindows(["-m", "gemini-3.1-pro-preview", "-p", "hello"])).toEqual([
      "-m",
      "gemini-3.1-pro-preview",
      "-p",
      "hello",
    ]);
  });

  it("quotes args containing spaces", () => {
    expect(quoteArgsForWindows(["-p", "What model are you?"])).toEqual(["-p", '"What model are you?"']);
  });

  it("escapes double quotes inside args", () => {
    expect(quoteArgsForWindows(['say "hello"'])).toEqual(['"say \\"hello\\""']);
  });

  it("quotes args containing shell metacharacters", () => {
    expect(quoteArgsForWindows(["foo & bar"])).toEqual(['"foo & bar"']);
    expect(quoteArgsForWindows(["a | b"])).toEqual(['"a | b"']);
    expect(quoteArgsForWindows(["a^b"])).toEqual(['"a^b"']);
  });

  it("handles empty args array", () => {
    expect(quoteArgsForWindows([])).toEqual([]);
  });

  it("preserves a full gemini CLI arg set with multi-word prompt", () => {
    const args = ["-m", "gemini-3.1-pro-preview", "--output-format", "json", "-p", "Review this code for bugs"];
    const quoted = quoteArgsForWindows(args);
    expect(quoted).toEqual([
      "-m",
      "gemini-3.1-pro-preview",
      "--output-format",
      "json",
      "-p",
      '"Review this code for bugs"',
    ]);
  });
});

describe("sanitizeErrorForLLM", () => {
  it("detects Node.js version mismatch from regex error", () => {
    const stderr = `file:///opt/homebrew/lib/chunk.js:45986
var zeroWidthClusterRegex = /regex/v;
SyntaxError: Invalid regular expression flags
    at ESMLoader.moduleStrategy
Node.js v18.15.0`;
    const result = sanitizeErrorForLLM(stderr, "gemini");
    expect(result).toContain("Node.js v20+");
    expect(result).toContain("v18.15.0");
    expect(result).not.toContain("ESMLoader");
  });

  it("detects command not found", () => {
    const result = sanitizeErrorForLLM("gemini: command not found", "gemini");
    expect(result).toContain("not found on PATH");
  });

  it("detects ENOENT spawn error", () => {
    const result = sanitizeErrorForLLM("spawn gemini ENOENT", "gemini");
    expect(result).toContain("not found on PATH");
  });

  it("detects the Windows command-not-found grammar", () => {
    const stderr = "'gemini' is not recognized as an internal or external command, operable program or batch file.";
    expect(isCommandNotFoundError(stderr, "gemini")).toBe(true);
    expect(sanitizeErrorForLLM(stderr, "gemini", "win32")).toContain('Run "where.exe gemini"');
  });

  it("does not classify an unrelated ENOENT as a missing executable", () => {
    expect(isCommandNotFoundError("ENOENT: no such file or directory, open 'settings.json'", "gemini")).toBe(false);
  });

  it("detects permission denied", () => {
    const result = sanitizeErrorForLLM("EACCES: permission denied", "gemini");
    expect(result).toContain("Permission denied");
  });

  it("truncates long unknown errors", () => {
    const longError = "x".repeat(1000);
    const result = sanitizeErrorForLLM(longError, "gemini");
    expect(result.length).toBeLessThan(600);
    expect(result).toContain("truncated");
  });

  it("returns first 3 lines for short unknown errors", () => {
    const result = sanitizeErrorForLLM("Some error\nCause: something broke\nAt module.ts:42", "gemini");
    expect(result).toContain("Some error");
    expect(result).toContain("Cause: something broke");
    expect(result).toContain("At module.ts:42");
  });

  it("passes through quota errors unmodified for downstream fallback", () => {
    const stderr = "Some prefix output\nRandom line\nRESOURCE_EXHAUSTED: quota exceeded for model";
    const result = sanitizeErrorForLLM(stderr, "gemini");
    expect(result).toContain("RESOURCE_EXHAUSTED");
  });

  it("passes through TerminalQuotaError for downstream fallback", () => {
    const stderr = "Error running model\nTerminalQuotaError: You have exhausted your capacity";
    const result = sanitizeErrorForLLM(stderr, "gemini");
    expect(result).toContain("TerminalQuotaError");
  });

  it("passes through codex 0.137 'usage limit' quota text for downstream fallback (ADR-117)", () => {
    const combined =
      "Reading additional input from stdin...\n" +
      '{"type":"error","message":"You\'ve hit your usage limit. Upgrade to Pro or try again later."}';
    const result = sanitizeErrorForLLM(combined, "codex");
    expect(result).toContain("usage limit");
  });

  it("preserves the quota signal even when a long stderr precedes it (ADR-117 windowing)", () => {
    // A long preceding stderr must not push the stdout-borne signal past the
    // 500-char cap — the passthrough windows around the match, not a blind prefix.
    const combined = `${"noise ".repeat(120)}\nYou've hit your usage limit`;
    expect(combined.length).toBeGreaterThan(500);
    const result = sanitizeErrorForLLM(combined, "codex");
    expect(result).toContain("usage limit");
    expect(result.length).toBeLessThan(600);
  });

  it("does not match ENOENT from CLI file errors", () => {
    const result = sanitizeErrorForLLM(
      "Error: ENOENT: no such file or directory, open '/missing/config.json'",
      "gemini",
    );
    expect(result).not.toContain("not found on PATH");
  });
});

describe("resolveTimeoutMs — per-provider precedence ladder (issue #45)", () => {
  let originalCodex: string | undefined;
  let originalGemini: string | undefined;
  let originalGlobal: string | undefined;

  beforeEach(() => {
    originalCodex = process.env.ASK_CODEX_TIMEOUT_MS;
    originalGemini = process.env.ASK_GEMINI_TIMEOUT_MS;
    originalGlobal = process.env.GMCPT_TIMEOUT_MS;
    delete process.env.ASK_CODEX_TIMEOUT_MS;
    delete process.env.ASK_GEMINI_TIMEOUT_MS;
    delete process.env.GMCPT_TIMEOUT_MS;
  });

  afterEach(() => {
    if (originalCodex === undefined) delete process.env.ASK_CODEX_TIMEOUT_MS;
    else process.env.ASK_CODEX_TIMEOUT_MS = originalCodex;
    if (originalGemini === undefined) delete process.env.ASK_GEMINI_TIMEOUT_MS;
    else process.env.ASK_GEMINI_TIMEOUT_MS = originalGemini;
    if (originalGlobal === undefined) delete process.env.GMCPT_TIMEOUT_MS;
    else process.env.GMCPT_TIMEOUT_MS = originalGlobal;
  });

  it("falls back to the provider default when no env vars are set", () => {
    expect(resolveTimeoutMs(EXECUTION.CODEX_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CODEX_TIMEOUT_MS)).toBe(800_000);
    expect(resolveTimeoutMs(EXECUTION.GEMINI_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_TIMEOUT_MS)).toBe(210_000);
  });

  it("uses GMCPT_TIMEOUT_MS when set and provider env var is unset", () => {
    process.env.GMCPT_TIMEOUT_MS = "300000";
    expect(resolveTimeoutMs(EXECUTION.CODEX_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CODEX_TIMEOUT_MS)).toBe(300_000);
    expect(resolveTimeoutMs(EXECUTION.GEMINI_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_TIMEOUT_MS)).toBe(300_000);
  });

  it("provider env var takes precedence over GMCPT_TIMEOUT_MS", () => {
    process.env.GMCPT_TIMEOUT_MS = "300000";
    process.env.ASK_CODEX_TIMEOUT_MS = "900000";
    expect(resolveTimeoutMs(EXECUTION.CODEX_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CODEX_TIMEOUT_MS)).toBe(900_000);
    expect(resolveTimeoutMs(EXECUTION.GEMINI_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_TIMEOUT_MS)).toBe(300_000);
  });

  it("ignores invalid (non-numeric / non-positive) env values and falls through", () => {
    process.env.ASK_CODEX_TIMEOUT_MS = "not-a-number";
    process.env.GMCPT_TIMEOUT_MS = "0";
    expect(resolveTimeoutMs(EXECUTION.CODEX_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CODEX_TIMEOUT_MS)).toBe(800_000);
  });

  it("ignores negative env values", () => {
    process.env.ASK_CODEX_TIMEOUT_MS = "-1000";
    expect(resolveTimeoutMs(EXECUTION.CODEX_TIMEOUT_ENV_VAR, EXECUTION.DEFAULT_CODEX_TIMEOUT_MS)).toBe(800_000);
  });
});

describe("executeCommand timeoutMs parameter overrides env (issue #45)", () => {
  // Real-spawn test: pass a tiny timeoutMs and ensure the param wins over env.
  // The 50ms value guarantees the timer fires before the spawned `node -e` can
  // emit any output, regardless of what the env says.
  const SPAWN_TIMEOUT_MS = 30_000;

  let originalGlobal: string | undefined;

  beforeEach(() => {
    originalGlobal = process.env.GMCPT_TIMEOUT_MS;
    process.env.GMCPT_TIMEOUT_MS = "60000";
  });

  afterEach(() => {
    if (originalGlobal === undefined) delete process.env.GMCPT_TIMEOUT_MS;
    else process.env.GMCPT_TIMEOUT_MS = originalGlobal;
  });

  it(
    "param-passed timeoutMs wins over GMCPT_TIMEOUT_MS",
    async () => {
      // setTimeout with 5s should never fire because the param 50ms timer wins
      const args = ["-e", "setTimeout(() => console.log('late'), 5000)"];
      await expect(executeCommand("node", args, undefined, undefined, undefined, 50)).rejects.toThrow(
        /Command timed out/,
      );
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "timeout error message references both provider and global env vars",
    async () => {
      const args = ["-e", "setTimeout(() => 0, 5000)"];
      await expect(executeCommand("node", args, undefined, undefined, undefined, 50)).rejects.toThrow(
        /ASK_CODEX_TIMEOUT_MS \/ ASK_GEMINI_TIMEOUT_MS|GMCPT_TIMEOUT_MS/,
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("executeCommand stdin payload (issue #30)", () => {
  const ECHO_STDIN = ["-e", "process.stdin.pipe(process.stdout)"];
  // Real-spawn tests need a generous timeout: Node 22 startup + stdin pipe
  // setup on Ubuntu CI runners under load has been observed at 8-13s
  // (vitest default 5s causes false-positive timeouts). Locally these all
  // run in <100ms; the bump is purely defensive against runner contention.
  const SPAWN_TIMEOUT_MS = 30_000;

  it(
    "writes stdin payload to child before EOF",
    async () => {
      const result = await executeCommand("node", ECHO_STDIN, undefined, undefined, "hello from stdin");
      expect(result).toBe("hello from stdin");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "supports payloads above the 16 KiB ARG_MAX threshold",
    async () => {
      const payload = `${"x".repeat(20_000)}END`;
      const result = await executeCommand("node", ECHO_STDIN, undefined, undefined, payload);
      expect(result).toBe(payload);
      expect(result.length).toBe(20_003);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "preserves existing zero-stdin behavior when payload is undefined",
    async () => {
      const result = await executeCommand("node", ["-e", "console.log('hi')"]);
      expect(result).toBe("hi");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "treats empty-string stdin as no-op (still EOFs cleanly)",
    async () => {
      const result = await executeCommand("node", ["-e", "console.log('hi')"], undefined, undefined, "");
      expect(result).toBe("hi");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "redacts sensitive command-log values without changing child argv",
    async () => {
      const sensitive = "sensitive-machine-prompt-7d3e";
      const originalLogLevel = process.env[LOG_LEVEL_ENV_VAR];
      process.env[LOG_LEVEL_ENV_VAR] = "warn";
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      try {
        const result = await executeCommand(
          "node",
          ["-e", "process.stdout.write(process.argv[1])", sensitive],
          undefined,
          undefined,
          undefined,
          SPAWN_TIMEOUT_MS,
          { sensitiveValues: [sensitive] },
        );
        const logs = warn.mock.calls.flat().map(String).join(" ");

        expect(result).toBe(sensitive);
        expect(logs).toContain("<redacted>");
        expect(logs).not.toContain(sensitive);
      } finally {
        warn.mockRestore();
        if (originalLogLevel === undefined) delete process.env[LOG_LEVEL_ENV_VAR];
        else process.env[LOG_LEVEL_ENV_VAR] = originalLogLevel;
      }
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("executeCommand surfaces stdout-borne errors on non-zero exit (ADR-117)", () => {
  // Codex 0.137+ prints the fatal error as JSON on stdout while exiting
  // non-zero and emitting only a benign notice on stderr. The non-zero-exit
  // branch must UNION stderr+stdout so that stdout-borne quota text survives
  // into the rejected Error — otherwise the quota fallback can never fire.
  const SPAWN_TIMEOUT_MS = 30_000;

  it(
    "includes stdout in the rejected error when stderr lacks the real cause",
    async () => {
      const args = [
        "-e",
        "process.stderr.write('Reading additional input from stdin...'); process.stdout.write(\"You've hit your usage limit\"); process.exit(1)",
      ];
      await expect(executeCommand("node", args)).rejects.toThrow(/usage limit/);
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "still surfaces stderr-only errors when stdout is empty",
    async () => {
      const args = ["-e", "process.stderr.write('boom on stderr'); process.exit(1)"];
      await expect(executeCommand("node", args)).rejects.toThrow(/boom on stderr/);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("executeCommand env propagation to spawned children (issue #32)", () => {
  // Verifies the spawn-side end of the chain that ensureWorkspaceTrustEnv
  // (in geminiExecutor) relies on. Without this test, a future contributor
  // could refactor getSpawnEnv() in shellPath.ts and silently break
  // workspace-trust propagation — every existing trust-handling test mocks
  // executeCommand directly and never exercises the real spawn env merge.
  const PRINT_ENV = (varName: string) => ["-e", `console.log(process.env.${varName} || 'unset')`];
  // Real-spawn tests need a generous timeout: Node 22 startup on Ubuntu CI
  // runners has been observed at 8-13s under runner contention (vitest's
  // default 5s causes false-positive timeouts). See PR #34 for the same
  // pattern applied to the stdin-payload tests.
  const SPAWN_TIMEOUT_MS = 30_000;

  let originalTrust: string | undefined;
  let originalCustom: string | undefined;

  beforeEach(() => {
    originalTrust = process.env.GEMINI_TRUST_WORKSPACE;
    originalCustom = process.env.ASK_LLM_TEST_CUSTOM;
    delete process.env.GEMINI_TRUST_WORKSPACE;
    delete process.env.ASK_LLM_TEST_CUSTOM;
  });

  afterEach(() => {
    if (originalTrust === undefined) delete process.env.GEMINI_TRUST_WORKSPACE;
    else process.env.GEMINI_TRUST_WORKSPACE = originalTrust;
    if (originalCustom === undefined) delete process.env.ASK_LLM_TEST_CUSTOM;
    else process.env.ASK_LLM_TEST_CUSTOM = originalCustom;
  });

  it(
    "propagates GEMINI_TRUST_WORKSPACE=true from parent process.env to spawned child",
    async () => {
      process.env.GEMINI_TRUST_WORKSPACE = "true";

      const result = await executeCommand("node", PRINT_ENV("GEMINI_TRUST_WORKSPACE"));

      expect(result).toBe("true");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "child sees 'unset' when parent env var is not set (verifies test isolation)",
    async () => {
      const result = await executeCommand("node", PRINT_ENV("GEMINI_TRUST_WORKSPACE"));

      expect(result).toBe("unset");
    },
    SPAWN_TIMEOUT_MS,
  );

  it(
    "propagates arbitrary env vars set on parent process.env at spawn time",
    async () => {
      process.env.ASK_LLM_TEST_CUSTOM = "value-set-by-test";

      const result = await executeCommand("node", PRINT_ENV("ASK_LLM_TEST_CUSTOM"));

      expect(result).toBe("value-set-by-test");
    },
    SPAWN_TIMEOUT_MS,
  );
});
