import { spawn } from "node:child_process";
import { EXECUTION } from "./constants.js";
import { Logger } from "./logger.js";
import { getSpawnEnv } from "./shellPath.js";

const IS_WINDOWS = process.platform === "win32";
const REDACTED_COMMAND_ARGUMENT = "<redacted>";

export interface CommandLoggingOptions {
  sensitiveValues: readonly string[];
}

export function isCommandNotFoundError(stderr: string, command: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("command not found") ||
    lower.includes("not found on path") ||
    lower.includes("is not recognized as an internal or external command") ||
    lower.includes(`spawn ${command.toLowerCase()} enoent`)
  );
}

const QUOTA_PASSTHROUGH_PATTERNS = [
  "RESOURCE_EXHAUSTED",
  "TerminalQuotaError",
  "exhausted your capacity",
  "rate_limit_exceeded",
  "quota_exceeded",
  "insufficient_quota",
  // Codex 0.137+ reports quota exhaustion as "You've hit your usage limit"
  // (on stdout JSONL). Passing it through untruncated keeps the signal
  // visible to each provider's isQuotaError() fallback check.
  "usage limit",
];

export function sanitizeErrorForLLM(
  stderr: string,
  command: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (stderr.includes("Invalid regular expression flags") && stderr.includes("Node.js v")) {
    const nodeVersion = stderr.match(/Node\.js (v[\d.]+)/)?.[1] ?? "unknown";
    return `${command} CLI requires Node.js v20+ but is running on ${nodeVersion}. The user should update their Node version or set ASK_LLM_PATH in their MCP config to point to a Node v20+ installation.`;
  }

  if (isCommandNotFoundError(stderr, command)) {
    const lookupCommand = platform === "win32" ? `where.exe ${command}` : `which ${command}`;
    return `${command} CLI not found on PATH. Ensure it is installed and accessible. Run "${lookupCommand}" in a terminal to verify.`;
  }

  if (stderr.includes("EACCES") || stderr.includes("Permission denied")) {
    return `Permission denied when running ${command} CLI. Check file permissions and try running with appropriate access.`;
  }

  const lower = stderr.toLowerCase();
  const matchedQuotaPattern = QUOTA_PASSTHROUGH_PATTERNS.find((p) => lower.includes(p.toLowerCase()));
  if (matchedQuotaPattern) {
    if (stderr.length <= 500) return stderr;
    // Window the output AROUND the matched signal rather than taking a blind
    // 500-char prefix. With the stderr+stdout union (ADR-117), a long stderr
    // could otherwise push a stdout-borne quota signal past the prefix and
    // hide it from isQuotaError(). Anchoring on the match guarantees it lands.
    const idx = lower.indexOf(matchedQuotaPattern.toLowerCase());
    const start = Math.max(0, idx - 100);
    const end = Math.min(start + 500, stderr.length);
    const head = start > 0 ? "... (truncated) " : "";
    const tail = end < stderr.length ? "... (truncated)" : "";
    return `${head}${stderr.slice(start, end)}${tail}`;
  }

  const lines = stderr.split("\n").filter((l) => l.trim().length > 0);
  const preview = lines.slice(0, 3).join("\n");
  if (preview.length > 0 && preview.length < 500) {
    return preview;
  }

  return stderr.length > 500 ? `${stderr.slice(0, 500)}... (truncated)` : stderr;
}

function parseTimeoutEnv(envVal: string | undefined): number | undefined {
  if (!envVal) return undefined;
  const parsed = Number(envVal);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function getTimeoutMs(): number {
  return parseTimeoutEnv(process.env[EXECUTION.TIMEOUT_ENV_VAR]) ?? EXECUTION.DEFAULT_TIMEOUT_MS;
}

// Resolves the effective timeout for a provider following the precedence:
//   1. provider env var (e.g. ASK_CODEX_TIMEOUT_MS) — finest knob
//   2. global env var GMCPT_TIMEOUT_MS — kept for backward compatibility
//   3. provider's own default (codex: 800s; gemini/ollama: 210s)
// The function is exported so each provider's executor owns its policy
// without putting provider-specific knowledge in this shared module.
export function resolveTimeoutMs(providerEnvVar: string, fallbackDefault: number): number {
  const providerVal = parseTimeoutEnv(process.env[providerEnvVar]);
  if (providerVal !== undefined) return providerVal;
  const globalVal = parseTimeoutEnv(process.env[EXECUTION.TIMEOUT_ENV_VAR]);
  if (globalVal !== undefined) return globalVal;
  return fallbackDefault;
}

export function quoteArgsForWindows(args: string[]): string[] {
  return args.map((a) => {
    if (a.includes(" ") || a.includes('"') || a.includes("&") || a.includes("|") || a.includes("^")) {
      return `"${a.replace(/"/g, '\\"')}"`;
    }
    return a;
  });
}

function argsForLogging(args: string[], options: CommandLoggingOptions | undefined): string[] {
  if (!options) return args;
  const sensitiveValues = new Set(options.sensitiveValues);
  return args.map((arg) => (sensitiveValues.has(arg) ? REDACTED_COMMAND_ARGUMENT : arg));
}

export async function executeCommand(
  command: string,
  args: string[],
  onProgress?: (newOutput: string) => void,
  onStderr?: (stderr: string) => void,
  stdinPayload?: string,
  timeoutMs?: number,
  commandLogging?: CommandLoggingOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const commandId = Logger.commandExecution(command, argsForLogging(args, commandLogging));

    const safeArgs = IS_WINDOWS ? quoteArgsForWindows(args) : args;

    const childProcess = spawn(command, safeArgs, {
      env: getSpawnEnv(),
      shell: IS_WINDOWS,
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Using "pipe" + end() instead of "ignore" (/dev/null) prevents stdin
    // pipe errors in CLIs that probe stdin (e.g., Codex CLI when spawned
    // from agent sub-processes). See issue #19. When a stdin payload is
    // supplied (issue #30), we write it before closing — this lets large
    // prompts bypass the ARG_MAX argv ceiling.
    childProcess.stdin.on("error", () => {});
    if (stdinPayload !== undefined && stdinPayload.length > 0) {
      childProcess.stdin.write(stdinPayload);
    }
    childProcess.stdin.end();

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let isResolved = false;
    // SIGKILL escalation timer scheduled after a timeout SIGTERM. Tracked so a
    // clean child exit can cancel it — otherwise it lingers ~5s, holding the
    // event loop open and pinning the (already dead) child object until GC.
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const effectiveTimeoutMs = timeoutMs ?? getTimeoutMs();
    const timer = setTimeout(() => {
      if (isResolved) return;
      isResolved = true;
      Logger.warn(`[cmd:${commandId}] Timeout after ${effectiveTimeoutMs}ms, sending SIGTERM`);
      childProcess.kill("SIGTERM");
      killTimer = setTimeout(() => {
        try {
          childProcess.kill("SIGKILL");
        } catch {}
      }, 5000);
      killTimer.unref?.();
      const timeoutSec = Math.round(effectiveTimeoutMs / 1000);
      reject(
        new Error(
          `Command timed out after ${timeoutSec}s. The LLM provider took too long to respond. ` +
            `Try a shorter prompt or increase the timeout via the provider env var ` +
            `(ASK_CODEX_TIMEOUT_MS / ASK_CLAUDE_TIMEOUT_MS / ASK_GEMINI_TIMEOUT_MS) or the global ` +
            `${EXECUTION.TIMEOUT_ENV_VAR} (current: ${effectiveTimeoutMs}ms).`,
        ),
      );
    }, effectiveTimeoutMs);

    childProcess.stdout.on("data", (data: Buffer) => {
      stdoutChunks.push(data);
      if (onProgress) {
        onProgress(data.toString());
      }
    });

    childProcess.stderr.on("data", (data: Buffer) => {
      stderrChunks.push(data);
      if (onStderr) {
        onStderr(data.toString());
      }
    });

    childProcess.on("error", (error) => {
      if (killTimer) clearTimeout(killTimer);
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        Logger.error(`Process error:`, error);
        reject(new Error(`Failed to spawn command: ${error.message}`));
      }
    });

    childProcess.on("close", (code) => {
      if (killTimer) clearTimeout(killTimer);
      if (!isResolved) {
        isResolved = true;
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks).toString();
        if (code === 0) {
          Logger.commandComplete(commandId, code, stdout.length);
          resolve(stdout.trim());
        } else {
          Logger.commandComplete(commandId, code);
          Logger.error(`Failed with exit code ${code}`);
          // Some CLIs (e.g. Codex 0.137+) report the fatal error as JSON on
          // stdout while emitting only a benign notice on stderr ("Reading
          // additional input from stdin...") and still exit non-zero. Union
          // both streams (not stderr-or-stdout) so stdout-borne errors stay
          // visible to downstream quota/fallback detection. See ADR-117.
          const stderrText = Buffer.concat(stderrChunks).toString();
          const rawError = [stderrText.trim(), stdout.trim()].filter(Boolean).join("\n") || "Unknown error";
          const userMessage = sanitizeErrorForLLM(rawError, command);
          reject(new Error(userMessage));
        }
      }
    });
  });
}
