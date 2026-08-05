import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeCodexCLI = vi.hoisted(() => vi.fn());
vi.mock("@ask-llm/codex-mcp/executor", () => ({ executeCodexCLI }));

import { __testing, registerCodexPair } from "../../pi/extensions/codex-pair.js";

interface Context {
  cwd: string;
  mode: "tui" | "rpc" | "json" | "print";
  hasUI: boolean;
  isProjectTrusted: () => boolean;
  sessionManager: { getSessionId: () => string };
  ui: {
    notify: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
  };
}

function harness() {
  const handlers = new Map<string, Array<(event: Record<string, unknown>, ctx: Context) => Promise<void>>>();
  const commands = new Map<string, { handler: (args: string, ctx: Context) => Promise<void> }>();
  const messages: Array<{ message: { content: string }; options: Record<string, unknown> }> = [];
  const pi = {
    on(name: string, handler: (event: Record<string, unknown>, ctx: Context) => Promise<void>) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerCommand(name: string, command: { handler: (args: string, ctx: Context) => Promise<void> }) {
      commands.set(name, command);
    },
    sendMessage(message: { content: string }, options: Record<string, unknown>) {
      messages.push({ message, options });
    },
  };
  registerCodexPair(pi as never);
  return {
    handlers,
    commands,
    messages,
    emit: async (name: string, event: Record<string, unknown>, ctx: Context) => {
      for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
    },
  };
}

let root: string;
let priorConfigDir: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ask-llm-pi-pair-"));
  priorConfigDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(root, "pi-agent");
  executeCodexCLI.mockReset();
  executeCodexCLI.mockResolvedValue({
    response: JSON.stringify({
      verdict: "needs-attention",
      findings: [
        {
          severity: "high",
          title: "Fixture issue",
          body: "The changed value violates the fixture invariant.",
          file: "src/value.ts",
          line_start: 1,
          recommendation: "Use the invariant value.",
        },
      ],
    }),
    usage: { fellBack: false },
  });
});

afterEach(async () => {
  if (priorConfigDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = priorConfigDir;
  await rm(root, { recursive: true, force: true });
  vi.useRealTimers();
});

async function project(debounceMs = 5) {
  const repo = join(root, "repo");
  const source = join(repo, "src", "value.ts");
  await mkdir(join(repo, ".codex-pair"), { recursive: true });
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(
    join(repo, ".codex-pair", "context.md"),
    `---\ndebounceMs: ${debounceMs}\ndebounceMaxMs: 20\n---\nFixture invariant: value must remain positive.\n`,
  );
  await writeFile(source, "export const value = -1;\n");
  await __testing.setAllowed(repo, true);
  return { repo, source };
}

function context(cwd: string, trusted = true): Context {
  return {
    cwd,
    mode: "rpc",
    hasUI: true,
    isProjectTrusted: () => trusted,
    sessionManager: { getSessionId: () => "session-fixture" },
    ui: { notify: vi.fn(), confirm: vi.fn().mockResolvedValue(true) },
  };
}

async function eventually(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (true) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - started >= timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

describe("Pi codex-pair lifecycle", () => {
  it("factory registration starts no timer, process, or filesystem work", () => {
    vi.useFakeTimers();
    const instance = harness();
    expect(vi.getTimerCount()).toBe(0);
    expect(instance.handlers.has("tool_result")).toBe(true);
    expect([...instance.commands]).toEqual([
      ["codex-pair", expect.anything()],
      ["codex-pair-pause", expect.anything()],
      ["codex-pair-resume", expect.anything()],
      ["codex-pair-ack", expect.anything()],
    ]);
  });

  it("requires both project trust and the user-owned canonical allowlist", async () => {
    const { repo, source } = await project();
    const instance = harness();
    await __testing.setAllowed(repo, false);
    const ctx = context(repo);
    await instance.emit("tool_result", { toolName: "write", input: { path: source }, isError: false }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(executeCodexCLI).not.toHaveBeenCalled();
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("not in your Pi allowlist"), "warning");

    await __testing.setAllowed(repo, true);
    const untrusted = context(repo, false);
    await instance.emit("tool_result", { toolName: "write", input: { path: source }, isError: false }, untrusted);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(executeCodexCLI).not.toHaveBeenCalled();
    expect(untrusted.ui.notify).toHaveBeenCalledWith(expect.stringContaining("does not trust"), "warning");
  });

  it("reviews one settled final state for a repeated edit burst and delivers a non-triggering steer", async () => {
    const { repo, source } = await project();
    const instance = harness();
    const ctx = context(repo);
    await instance.emit("tool_result", { toolName: "edit", input: { path: source }, isError: false }, ctx);
    await writeFile(source, "export const value = -2;\n");
    await instance.emit("tool_result", { toolName: "edit", input: { path: source }, isError: false }, ctx);

    await eventually(() => expect(instance.messages).toHaveLength(1));
    expect(executeCodexCLI).toHaveBeenCalledTimes(1);
    expect(executeCodexCLI.mock.calls[0][0]).toMatchObject({ sandbox: "read-only", signal: expect.any(AbortSignal) });
    expect(executeCodexCLI.mock.calls[0][0].prompt).toContain("export const value = -2");
    expect(instance.messages[0].options).toEqual({ deliverAs: "steer", triggerTurn: false });
    expect(instance.messages[0].message.content).toContain("advisory and non-blocking");
  });

  it("ignores read-only tools and failed edits", async () => {
    const { repo, source } = await project();
    const instance = harness();
    const ctx = context(repo);
    await instance.emit("tool_result", { toolName: "read", input: { path: source }, isError: false }, ctx);
    await instance.emit("tool_result", { toolName: "edit", input: { path: source }, isError: true }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(executeCodexCLI).not.toHaveBeenCalled();
  });

  it("deduplicates an unchanged settled file across extension restarts", async () => {
    const { repo, source } = await project();
    const first = harness();
    const ctx = context(repo);
    await first.emit("tool_result", { toolName: "write", input: { path: source }, isError: false }, ctx);
    await eventually(() => expect(first.messages).toHaveLength(1));
    await first.emit("session_shutdown", { reason: "reload" }, ctx);

    const second = harness();
    await second.emit("tool_result", { toolName: "write", input: { path: source }, isError: false }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(executeCodexCLI).toHaveBeenCalledTimes(1);
    expect(second.messages).toHaveLength(0);
  });

  it("aborts an active review on shutdown and never delivers from a stale epoch", async () => {
    const { repo, source } = await project(0);
    let observedSignal: AbortSignal | undefined;
    executeCodexCLI.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          observedSignal = signal;
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
    );
    const instance = harness();
    const ctx = context(repo);
    await instance.emit("tool_result", { toolName: "write", input: { path: source }, isError: false }, ctx);
    await eventually(() => expect(observedSignal).toBeDefined());
    await instance.emit("session_shutdown", { reason: "quit" }, ctx);
    expect(observedSignal?.aborted).toBe(true);
    expect(instance.messages).toHaveLength(0);
  });

  it("normalizes leading-at and relative Pi tool paths", () => {
    expect(__testing.normalizeToolPath("@src/a.ts", "/repo")).toBe(join("/repo", "src", "a.ts"));
    expect(__testing.shouldSkip("/repo/node_modules/a.ts")).toBe(true);
    expect(__testing.shouldSkip("/repo/src/a.ts")).toBe(false);
  });
});
