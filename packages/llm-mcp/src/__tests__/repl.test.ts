import * as readline from "node:readline/promises";
import { PassThrough, Writable } from "node:stream";
import { createSessionUsage, type UsageStats } from "@ask-llm/shared";
import { describe, expect, it, vi } from "vitest";
import { dispatchPrompt, formatBanner, formatHelp, handleSlash, type ReplState, runReplLoop } from "../repl.js";

function makeState(overrides: Partial<ReplState> = {}): ReplState {
  return {
    currentProvider: "gemini",
    sessions: new Map(),
    available: ["gemini", "codex", "ollama"],
    sessionUsage: createSessionUsage(),
    ...overrides,
  };
}

function captureWritable(): { stream: Writable; output: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, output: () => chunks.join("") };
}

describe("formatHelp", () => {
  it("lists every documented slash command", () => {
    const help = formatHelp();
    expect(help).toContain("/help");
    expect(help).toContain("/provider");
    expect(help).toContain("/providers");
    expect(help).toContain("/new");
    expect(help).toContain("/session");
    expect(help).toContain("/sessions");
    expect(help).toContain("/usage");
    expect(help).toContain("/clear");
    expect(help).toContain("/quit");
  });
});

describe("formatBanner", () => {
  it("includes available providers and the active one", () => {
    const banner = formatBanner(makeState());
    expect(banner).toContain("gemini, codex, ollama");
    expect(banner).toContain("active:");
    expect(banner).toContain("gemini");
  });

  it("shows '(no session)' when no session is set", () => {
    expect(formatBanner(makeState())).toContain("(no session)");
  });

  it("shows truncated session id when one exists", () => {
    const state = makeState();
    state.sessions.set("gemini", "abcd1234-ef56-7890-abcd-1234567890ab");
    expect(formatBanner(state)).toContain("session abcd1234");
  });
});

describe("handleSlash — /help", () => {
  it("returns the help message and does not exit", () => {
    const result = handleSlash("/help", makeState());
    expect(result.exit).toBeFalsy();
    expect(result.message).toContain("/provider");
  });
});

describe("handleSlash — /provider", () => {
  it("switches the active provider when valid", () => {
    const state = makeState();
    const result = handleSlash("/provider codex", state);
    expect(state.currentProvider).toBe("codex");
    expect(result.message).toContain("Switched to codex");
  });

  it("rejects an unavailable provider", () => {
    const state = makeState({ available: ["gemini"] });
    const result = handleSlash("/provider codex", state);
    expect(state.currentProvider).toBe("gemini");
    expect(result.message).toContain("not available");
  });

  it("requires an argument", () => {
    const result = handleSlash("/provider", makeState());
    expect(result.message).toContain("Usage:");
  });

  it("includes existing session in the switch message when resuming", () => {
    const state = makeState();
    state.sessions.set("codex", "deadbeef-1111-2222-3333-444455556666");
    const result = handleSlash("/provider codex", state);
    expect(result.message).toContain("resuming session deadbeef");
  });
});

describe("handleSlash — /providers", () => {
  it("marks the active provider with an asterisk", () => {
    const state = makeState({ currentProvider: "codex" });
    const result = handleSlash("/providers", state);
    expect(result.message).toMatch(/\*\s+codex/);
  });
});

describe("handleSlash — /new", () => {
  it("clears the session for the current provider only", () => {
    const state = makeState();
    state.sessions.set("gemini", "g-session");
    state.sessions.set("codex", "c-session");
    handleSlash("/new", state);
    expect(state.sessions.has("gemini")).toBe(false);
    expect(state.sessions.get("codex")).toBe("c-session");
  });

  it("notes when there was nothing to clear", () => {
    const result = handleSlash("/new", makeState());
    expect(result.message).toContain("already had no session");
  });
});

describe("handleSlash — /session", () => {
  it("sets the session for the current provider", () => {
    const state = makeState();
    handleSlash("/session abc12345-aaaa-bbbb-cccc-ddddddddeeee", state);
    expect(state.sessions.get("gemini")).toBe("abc12345-aaaa-bbbb-cccc-ddddddddeeee");
  });

  it("requires an argument", () => {
    const result = handleSlash("/session", makeState());
    expect(result.message).toContain("Usage:");
  });
});

describe("handleSlash — /sessions", () => {
  it("returns 'No active sessions' when empty", () => {
    expect(handleSlash("/sessions", makeState()).message).toBe("No active sessions.");
  });

  it("lists each provider with its session id (or em-dash)", () => {
    const state = makeState();
    state.sessions.set("gemini", "g-id");
    const message = handleSlash("/sessions", state).message ?? "";
    expect(message).toContain("gemini");
    expect(message).toContain("g-id");
    expect(message).toContain("codex");
    expect(message).toMatch(/codex\s+—/);
  });
});

describe("handleSlash — /usage", () => {
  it("returns the session usage formatted output", () => {
    const result = handleSlash("/usage", makeState());
    expect(result.message).toContain("No LLM calls recorded");
  });
});

describe("handleSlash — /clear, /quit, unknown", () => {
  it("/clear sets cleared=true with no message", () => {
    const result = handleSlash("/clear", makeState());
    expect(result.cleared).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it("/quit sets exit=true", () => {
    expect(handleSlash("/quit", makeState()).exit).toBe(true);
  });

  it("/exit also sets exit=true", () => {
    expect(handleSlash("/exit", makeState()).exit).toBe(true);
  });

  it("unknown command produces a hint to /help", () => {
    const result = handleSlash("/wat", makeState());
    expect(result.message).toContain("Unknown command");
    expect(result.message).toContain("/help");
  });
});

describe("dispatchPrompt", () => {
  function makeUsage(overrides: Partial<UsageStats> = {}): UsageStats {
    return {
      provider: "gemini",
      model: "gemini-3.1-pro-preview",
      inputTokens: 100,
      outputTokens: 200,
      cachedTokens: 0,
      thinkingTokens: 0,
      durationMs: 1500,
      fellBack: false,
      ...overrides,
    };
  }

  it("calls the executor with the current session id", async () => {
    const state = makeState();
    state.sessions.set("gemini", "existing-session");
    const executor = vi.fn().mockResolvedValue({ response: "hi", sessionId: "existing-session" });
    const { stream, output } = captureWritable();

    const result = await dispatchPrompt("hello", state, stream, executor);
    expect(result.ok).toBe(true);
    expect(executor).toHaveBeenCalledOnce();
    expect(executor.mock.calls[0][0]).toMatchObject({ prompt: "hello", sessionId: "existing-session" });
    expect(output()).toContain("[gemini]");
    expect(output()).toContain("hi");
  });

  it("captures sessionId from response and updates state", async () => {
    const state = makeState();
    const executor = vi.fn().mockResolvedValue({ response: "ok", sessionId: "new-session-id" });
    const { stream } = captureWritable();
    await dispatchPrompt("hello", state, stream, executor);
    expect(state.sessions.get("gemini")).toBe("new-session-id");
  });

  it("uses threadId when sessionId is absent (Codex pattern)", async () => {
    const state = makeState({ currentProvider: "codex" });
    const executor = vi.fn().mockResolvedValue({ response: "ok", threadId: "thread-id-codex" });
    const { stream } = captureWritable();
    await dispatchPrompt("hello", state, stream, executor);
    expect(state.sessions.get("codex")).toBe("thread-id-codex");
  });

  it("records usage stats when the executor returns them", async () => {
    const state = makeState();
    const usage = makeUsage({ inputTokens: 250, outputTokens: 75 });
    const executor = vi.fn().mockResolvedValue({ response: "ok", usage });
    const { stream } = captureWritable();
    await dispatchPrompt("hello", state, stream, executor);
    const snap = state.sessionUsage.snapshot();
    expect(snap.totalCalls).toBe(1);
    expect(snap.totalInputTokens).toBe(250);
  });

  it("forwards onProgress chunks to the output stream", async () => {
    const state = makeState();
    const executor = vi.fn().mockImplementation(async (opts) => {
      opts.onProgress?.("first ");
      opts.onProgress?.("second");
      return { response: "first second" };
    });
    const { stream, output } = captureWritable();
    await dispatchPrompt("hello", state, stream, executor);
    const text = output();
    expect(text).toContain("first ");
    expect(text).toContain("second");
    expect(text).not.toMatch(/first secondfirst second/);
  });

  it("falls back to printing the full response when no chunks were streamed", async () => {
    const state = makeState();
    const executor = vi.fn().mockResolvedValue({ response: "no streaming here" });
    const { stream, output } = captureWritable();
    await dispatchPrompt("hello", state, stream, executor);
    expect(output()).toContain("no streaming here");
  });

  it("returns ok=false and writes [error] when the executor throws", async () => {
    const state = makeState();
    const executor = vi.fn().mockRejectedValue(new Error("provider exploded"));
    const { stream, output } = captureWritable();
    const result = await dispatchPrompt("hello", state, stream, executor);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("provider exploded");
    expect(output()).toContain("[error]");
  });

  it("returns ok=false when no executor is loaded for the provider", async () => {
    const state = makeState({ available: ["gemini"], currentProvider: "phantom" });
    const { stream } = captureWritable();
    const result = await dispatchPrompt("hello", state, stream);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not loaded");
  });
});

describe("runReplLoop EOF handling", () => {
  function makeRl(input: PassThrough, out: Writable): readline.Interface {
    return readline.createInterface({ input, output: out, terminal: false });
  }

  it("resolves (does not hang) when stdin reaches EOF", async () => {
    const input = new PassThrough();
    const { stream: out } = captureWritable();
    const rl = makeRl(input, out);
    const state = makeState();

    const loop = runReplLoop(rl, state, out);
    input.end(); // EOF — the universal Ctrl-D / piped-input terminator

    await expect(loop).resolves.toBeUndefined();
    rl.close();
  }, 3000);

  it("processes a slash command and then exits on EOF (piped input)", async () => {
    const input = new PassThrough();
    const { stream: out, output } = captureWritable();
    const rl = makeRl(input, out);
    const state = makeState();

    const loop = runReplLoop(rl, state, out);
    input.write("/help\n");
    await new Promise((r) => setImmediate(r));
    input.end();

    await expect(loop).resolves.toBeUndefined();
    expect(output()).toContain("/provider");
    rl.close();
  }, 3000);

  it("exits on /quit without needing EOF", async () => {
    const input = new PassThrough();
    const { stream: out } = captureWritable();
    const rl = makeRl(input, out);
    const state = makeState();

    const loop = runReplLoop(rl, state, out);
    input.write("/quit\n");

    await expect(loop).resolves.toBeUndefined();
    rl.close();
  }, 3000);
});
