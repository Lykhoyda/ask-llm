import * as readline from "node:readline/promises";
import { createSessionUsage, formatSessionUsage, Logger, type SessionUsage, type UsageStats } from "@ask-llm/shared";
import { PROVIDERS } from "./constants.js";
import { detectProviders, type ExecutorFn, getLoadedExecutor } from "./index.js";

export interface ReplState {
  currentProvider: string;
  sessions: Map<string, string>;
  available: string[];
  sessionUsage: SessionUsage;
}

export interface SlashResult {
  exit?: boolean;
  message?: string;
  cleared?: boolean;
}

const SLASH_COMMANDS: Array<[string, string]> = [
  ["/help", "Show this help"],
  ["/provider <name>", "Switch active provider (e.g. gemini, codex, ollama)"],
  ["/providers", "List available providers and which one is active"],
  ["/new", "Drop the current provider's session — start fresh"],
  ["/session <id>", "Resume a specific session id for the current provider"],
  ["/sessions", "Show the session id currently held for each provider"],
  ["/usage", "Show in-memory session usage stats (tokens, calls, fallbacks)"],
  ["/clear", "Clear the screen"],
  ["/quit", "Exit (also: /exit)"],
];

export function formatHelp(): string {
  const lines = ["Slash commands:"];
  for (const [cmd, desc] of SLASH_COMMANDS) {
    lines.push(`  ${cmd.padEnd(22)} ${desc}`);
  }
  return lines.join("\n");
}

export function formatBanner(state: ReplState): string {
  const sid = state.sessions.get(state.currentProvider);
  const sessionTag = sid ? ` (session ${sid.slice(0, 8)}…)` : " (no session)";
  return [
    "ask-llm REPL",
    `  available: ${state.available.join(", ")}`,
    `  active:    ${state.currentProvider}${sessionTag}`,
    "  type /help for commands, /quit to exit",
    "",
  ].join("\n");
}

function describeSessions(state: ReplState): string {
  if (state.sessions.size === 0) return "No active sessions.";
  const lines = ["Active sessions:"];
  for (const provider of state.available) {
    const sid = state.sessions.get(provider);
    lines.push(`  ${provider.padEnd(8)} ${sid ?? "—"}`);
  }
  return lines.join("\n");
}

export function handleSlash(line: string, state: ReplState): SlashResult {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];
  const arg = parts.slice(1).join(" ").trim();

  switch (cmd) {
    case "/help":
      return { message: formatHelp() };
    case "/provider": {
      if (!arg) return { message: `Usage: /provider <name>. Available: ${state.available.join(", ")}` };
      if (!state.available.includes(arg)) {
        return { message: `Provider "${arg}" not available. Available: ${state.available.join(", ")}` };
      }
      state.currentProvider = arg;
      const sid = state.sessions.get(arg);
      return { message: `Switched to ${arg}${sid ? ` (resuming session ${sid.slice(0, 8)}…)` : " (no session)"}` };
    }
    case "/providers":
      return {
        message: state.available
          .map(
            (p) =>
              `  ${p === state.currentProvider ? "*" : " "} ${p} ${PROVIDERS[p]?.name ? `(${PROVIDERS[p]?.name})` : ""}`,
          )
          .join("\n"),
      };
    case "/new": {
      const had = state.sessions.delete(state.currentProvider);
      return {
        message: had
          ? `Cleared session for ${state.currentProvider}`
          : `${state.currentProvider} already had no session`,
      };
    }
    case "/session": {
      if (!arg) return { message: "Usage: /session <id>" };
      state.sessions.set(state.currentProvider, arg);
      return { message: `Resuming session ${arg.slice(0, 8)}… for ${state.currentProvider}` };
    }
    case "/sessions":
      return { message: describeSessions(state) };
    case "/usage":
      return { message: formatSessionUsage(state.sessionUsage.snapshot()) };
    case "/clear":
      return { cleared: true };
    case "/quit":
    case "/exit":
      return { exit: true };
    default:
      return { message: `Unknown command: ${cmd}. Type /help.` };
  }
}

export async function dispatchPrompt(
  prompt: string,
  state: ReplState,
  out: NodeJS.WritableStream,
  executorOverride?: ExecutorFn,
): Promise<{ ok: boolean; error?: string; usage?: UsageStats }> {
  const executor = executorOverride ?? getLoadedExecutor(state.currentProvider);
  if (!executor) {
    return { ok: false, error: `Provider ${state.currentProvider} is not loaded` };
  }

  const sessionId = state.sessions.get(state.currentProvider);
  out.write(`\n[${state.currentProvider}]\n`);

  let sawAnyChunk = false;
  try {
    const result = await executor({
      prompt,
      sessionId,
      onProgress: (chunk) => {
        sawAnyChunk = true;
        out.write(chunk);
      },
    });

    if (!sawAnyChunk) {
      out.write(result.response);
    }
    out.write("\n");

    const newSession = result.sessionId ?? result.threadId;
    if (newSession) state.sessions.set(state.currentProvider, newSession);

    if (result.usage) state.sessionUsage.record(result.usage);

    return { ok: true, usage: result.usage };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    out.write(`\n[error] ${msg}\n`);
    return { ok: false, error: msg };
  }
}

// Resolves to the user's line, or null on EOF / stream close. node:readline's
// promises API leaves question() pending forever when stdin closes (Ctrl-D or a
// piped EOF), so we race it against the interface's "close" event — otherwise
// the REPL hangs instead of exiting. The "close" listener is removed when the
// question resolves normally, so repeated prompts don't leak listeners.
function questionOrEof(rl: readline.Interface, prompt: string): Promise<string | null> {
  return new Promise((resolve) => {
    const onClose = () => resolve(null);
    rl.once("close", onClose);
    rl.question(prompt).then(
      (answer) => {
        rl.off("close", onClose);
        resolve(answer);
      },
      () => {
        rl.off("close", onClose);
        resolve(null);
      },
    );
  });
}

export async function runReplLoop(rl: readline.Interface, state: ReplState, out: NodeJS.WritableStream): Promise<void> {
  let closed = false;
  rl.once("close", () => {
    closed = true;
  });

  while (!closed) {
    const line = await questionOrEof(rl, `${state.currentProvider}> `);
    if (line === null) break;

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("/")) {
      const res = handleSlash(trimmed, state);
      if (res.cleared) out.write("\x1b[2J\x1b[H");
      if (res.message) out.write(`${res.message}\n`);
      if (res.exit) break;
      continue;
    }

    await dispatchPrompt(trimmed, state, out);
  }
}

export async function startRepl(): Promise<number> {
  Logger.checkNodeVersion();
  process.stdout.write("Detecting providers...\n");
  const { available } = await detectProviders();

  if (available.length === 0) {
    process.stdout.write("\nNo providers available. Run `npx ask-llm-mcp doctor` for diagnostics.\n");
    return 1;
  }

  const state: ReplState = {
    currentProvider: available[0],
    sessions: new Map(),
    available,
    sessionUsage: createSessionUsage(),
  };

  process.stdout.write(`\n${formatBanner(state)}`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  try {
    await runReplLoop(rl, state, process.stdout);
  } finally {
    rl.close();
  }
  process.stdout.write("\nbye.\n");
  return 0;
}
