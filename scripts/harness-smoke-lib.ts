import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import type { CursorProviderName } from "@ask-llm/mcp/cursor";

export const RESULTS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  SKIP_UNAVAILABLE: "SKIP_UNAVAILABLE",
  SKIP_NOT_AUTHORIZED: "SKIP_NOT_AUTHORIZED",
} as const);

type ResultStatus = (typeof RESULTS)[keyof typeof RESULTS];
type Mode = "dry-run" | "live";

export interface Scenario {
  id: string;
  tool: string;
  surface: string;
  host: string;
  hostModelKey?: string;
  modelKey?: string;
  secondaryModelKey?: string;
  provider?: string;
  harness?: string;
  effort?: string;
  liveSupported?: boolean;
  liveUnavailableReason?: string;
  supported?: boolean;
  unavailableReason?: string;
  setupPreview?: boolean;
}

export const SCENARIOS: readonly Scenario[] = Object.freeze([
  {
    id: "claude:/brainstorm",
    tool: "claude",
    surface: "/brainstorm",
    host: "claude",
    hostModelKey: "CLAUDE",
    modelKey: "CURSOR_GROK",
    secondaryModelKey: "CURSOR_CODEX",
    provider: "grok",
    harness: "cursor-agent",
  },
  {
    id: "claude:/codex-pair",
    tool: "claude",
    surface: "/codex-pair",
    host: "claude",
    hostModelKey: "CLAUDE",
    modelKey: "CODEX_PAIR",
    provider: "codex",
    harness: "codex-cli",
    effort: "medium",
  },
  {
    id: "claude:/grok-pair",
    tool: "claude",
    surface: "/grok-pair",
    host: "claude",
    hostModelKey: "CLAUDE",
    modelKey: "GROK",
    provider: "grok",
    harness: "grok-cli",
    effort: "high",
  },
  {
    id: "cursor-agent:/brainstorm-route",
    tool: "agent",
    surface: "/brainstorm participant route",
    host: "cursor-agent",
    hostModelKey: "CURSOR_HOST",
    modelKey: "CURSOR_GROK",
    secondaryModelKey: "CURSOR_CODEX",
    provider: "grok",
    harness: "cursor-agent",
  },
  {
    id: "cursor-agent:/codex-pair",
    tool: "agent",
    surface: "/codex-pair",
    host: "cursor-agent",
    hostModelKey: "CURSOR_HOST",
    modelKey: "CODEX_PAIR",
    provider: "codex",
    harness: "codex-cli",
    effort: "medium",
  },
  {
    id: "cursor-agent:/grok-pair",
    tool: "agent",
    surface: "/grok-pair",
    host: "cursor-agent",
    hostModelKey: "CURSOR_HOST",
    modelKey: "GROK",
    provider: "grok",
    harness: "grok-cli",
    effort: "high",
  },
  {
    id: "pi:/brainstorm",
    tool: "pi",
    surface: "/skill:ask-llm-brainstorm",
    host: "pi",
    hostModelKey: "PI",
    modelKey: "CURSOR_GROK",
    secondaryModelKey: "CURSOR_CODEX",
    provider: "grok",
    harness: "cursor-agent",
  },
  {
    id: "pi:/codex-pair",
    tool: "pi",
    surface: "/skill:ask-llm-codex-pair",
    host: "pi",
    hostModelKey: "PI",
    modelKey: "CODEX_PAIR",
    provider: "codex",
    harness: "codex-cli",
    effort: "medium",
    liveSupported: false,
    liveUnavailableReason: "Pi codex-pair requires TUI/RPC/long-lived JSON plus project trust and a user allowlist",
  },
  {
    id: "pi:native-provider-tools",
    tool: "pi",
    surface: "ask-multi native tool route",
    host: "pi",
    hostModelKey: "PI",
    modelKey: "CODEX",
    provider: "codex",
    harness: "codex-cli",
    effort: "high",
  },
  {
    id: "pi:/grok-pair",
    tool: "pi",
    surface: "/skill:ask-llm-grok-pair",
    host: "pi",
    supported: false,
    unavailableReason: "grok-pair refuses on Pi until a Pi consent and lifecycle adapter exists (ADR-147, ADR-183)",
  },
  {
    id: "codex-cli:/brainstorm-route",
    tool: "codex",
    surface: "/brainstorm direct Codex participant",
    host: "codex-cli",
    modelKey: "CODEX",
    provider: "codex",
    harness: "codex-cli",
    effort: "high",
  },
  {
    id: "codex-cli:/codex-pair",
    tool: "codex",
    surface: "/codex-pair reviewer route",
    host: "codex-cli",
    modelKey: "CODEX_PAIR",
    provider: "codex",
    harness: "codex-cli",
    effort: "medium",
  },
  {
    id: "grok-cli:/brainstorm-route",
    tool: "grok",
    surface: "/brainstorm direct Grok participant",
    host: "grok-cli",
    modelKey: "GROK",
    provider: "grok",
    harness: "grok-cli",
    effort: "high",
  },
  {
    id: "grok-cli:/grok-pair",
    tool: "grok",
    surface: "/grok-pair reviewer route",
    host: "grok-cli",
    modelKey: "GROK",
    provider: "grok",
    harness: "grok-cli",
    effort: "high",
  },
  {
    id: "ask-llm:setup --dry-run",
    tool: "ask-llm",
    surface: "ask-llm setup --dry-run",
    host: "ask-llm",
    setupPreview: true,
  },
]);

const EXACT_DRY_MODELS = Object.freeze({
  CLAUDE: "claude-opus-5-5",
  CURSOR_HOST: "gpt-6-sol-high",
  CURSOR_GROK: "grok-4.7-high",
  CURSOR_CODEX: "gpt-6-sol-high",
  PI: "openai-codex/gpt-6-sol",
  CODEX: "gpt-6-astra",
  CODEX_PAIR: "gpt-6-sol",
  GROK: "grok-4.7",
} as const);

const SENSITIVE_NAME = /(api.?key|token|secret|credential|authorization|session)/i;
const FALLBACK_TEXT =
  /(["']?(?:fellBack|fallback)["']?\s*[=:]\s*true|fallback(?: model| route| harness)?\s*(?:to|used|occurred)|silently (?:fell back|rerouted))/i;
const FORBIDDEN_FLAGS = new Set(["--force", "--yolo", "--trust", "--approve"]);
const MUTATION_TOOL_NAMES = new Set(["edit", "write", "multiedit", "notebookedit"]);

export function redact(value: unknown, env: NodeJS.ProcessEnv = process.env, extraSecrets: string[] = []): string {
  let text = String(value ?? "");
  const secrets = [...extraSecrets];
  for (const [name, secret] of Object.entries(env)) {
    if (SENSITIVE_NAME.test(name) && typeof secret === "string" && secret.length >= 4) secrets.push(secret);
  }
  for (const secret of new Set(secrets.filter(Boolean))) text = text.replaceAll(secret, "[REDACTED]");
  text = text.replace(/(?:sk|xai|key|token)[-_][A-Za-z0-9._-]{8,}/gi, "[REDACTED]");
  return text;
}

interface CodexCatalogEntry {
  slug?: string;
  id?: string;
}

export function parseCatalog(tool: string, output: unknown): string[] {
  const text = String(output ?? "");
  if (tool === "agent") {
    return [
      ...new Set(
        text
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/)[0])
          .filter((id) => id && !/^(available|model)/i.test(id)),
      ),
    ];
  }
  if (tool === "pi") {
    return [
      ...new Set(
        text
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/))
          .filter((parts) => parts.length >= 2 && parts[0].toLowerCase() !== "provider")
          .map((parts) => `${parts[0]}/${parts[1]}`),
      ),
    ];
  }
  if (tool === "grok") {
    return [
      ...new Set(
        text
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/)[0])
          .filter((id) => id && !/^(available|model)/i.test(id)),
      ),
    ];
  }
  if (tool === "codex") {
    try {
      const parsed = JSON.parse(text) as unknown;
      const container = parsed as unknown[] | { models?: unknown[] };
      const models = Array.isArray(container) ? container : container.models;
      return Array.isArray(models)
        ? (models
            .map((entry) =>
              typeof entry === "string"
                ? entry
                : ((entry as CodexCatalogEntry | null)?.slug ?? (entry as CodexCatalogEntry | null)?.id),
            )
            .filter(Boolean) as string[])
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function structuredFallback(value: unknown, seen: Set<unknown> = new Set()): boolean {
  if (typeof value === "string") {
    try {
      return structuredFallback(JSON.parse(value), seen);
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (["fallback", "fellback"].includes(key.toLowerCase()) && nested === true) return true;
    if (structuredFallback(nested, seen)) return true;
  }
  return false;
}

export function hasFallbackDisclosure(output: unknown): boolean {
  const text = String(output ?? "");
  if (FALLBACK_TEXT.test(text)) return true;
  const candidates = [text, ...text.split(/\r?\n/)].map((value) => value.trim()).filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (structuredFallback(JSON.parse(candidate))) return true;
    } catch {
      // Text and JSONL output are both supported; malformed lines fall through.
    }
  }
  return false;
}

export function smokeMarker(scenario: Scenario, requestedModel: string): string {
  const provider = scenario.provider ?? scenario.host;
  return `ASK_LLM_SMOKE_OK host=${scenario.host} provider=${provider} model=${requestedModel} fallback=false`;
}

export interface EvaluateInvocationOptions {
  scenario: Scenario;
  requestedModel: string;
  selectedModel?: string;
  observedModel?: string;
  output: string;
  exitCode: number;
  timedOut: boolean;
  mutated: boolean;
  args?: string[];
}

interface EvaluationResult {
  status: ResultStatus;
  reason: string;
}

export function evaluateInvocation({
  scenario,
  requestedModel,
  selectedModel = requestedModel,
  observedModel,
  output,
  exitCode,
  timedOut,
  mutated,
  args = [],
}: EvaluateInvocationOptions): EvaluationResult {
  if (timedOut) return { status: RESULTS.FAIL, reason: "timed out; the process was terminated" };
  if (exitCode !== 0) return { status: RESULTS.FAIL, reason: `exited nonzero (${exitCode})` };
  if (mutated) return { status: RESULTS.FAIL, reason: "the repository changed during a read-only scenario" };
  const hasForbiddenFlag = args.some((arg) => {
    const normalized = arg.toLowerCase();
    return FORBIDDEN_FLAGS.has(normalized) || normalized === "workspace-write";
  });
  const toolsIndex = args.indexOf("--tools");
  const hasMutationTool =
    toolsIndex >= 0 &&
    (args[toolsIndex + 1] ?? "")
      .split(",")
      .map((tool) => tool.trim().toLowerCase())
      .some((tool) => MUTATION_TOOL_NAMES.has(tool));
  if (hasForbiddenFlag || hasMutationTool)
    return { status: RESULTS.FAIL, reason: "forbidden mutation/trust flag was present" };
  const modelIndex = args.findIndex((arg) => arg === "--model" || arg === "-m");
  if (modelIndex < 0 || args[modelIndex + 1] !== selectedModel)
    return { status: RESULTS.FAIL, reason: "the exact selected host/model option was lost" };
  if (hasFallbackDisclosure(output))
    return { status: RESULTS.FAIL, reason: "the output disclosed a forbidden fallback" };
  if (observedModel && observedModel !== requestedModel) {
    return { status: RESULTS.FAIL, reason: `model mismatch: requested ${requestedModel}, observed ${observedModel}` };
  }
  const marker = smokeMarker(scenario, requestedModel);
  if (!output.includes(marker))
    return { status: RESULTS.FAIL, reason: "the deterministic routing/attribution marker was absent" };
  return {
    status: RESULTS.PASS,
    reason: `${scenario.host} routed ${scenario.surface} to ${scenario.provider ?? scenario.host}/${requestedModel}; attribution=selected-unverified; fallback=false`,
  };
}

function commandExists(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  const path = env.PATH ?? "";
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  return Promise.any(
    path
      .split(delimiter)
      .filter(Boolean)
      .flatMap((directory) =>
        extensions.map((extension) =>
          access(
            join(directory, `${command}${extension}`),
            process.platform === "win32" ? constants.F_OK : constants.X_OK,
          ),
        ),
      ),
  )
    .then(() => true)
    .catch(() => false);
}

interface RunCommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  timeoutMs?: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type CommandRunner = (command: string, args: string[], options?: RunCommandOptions) => Promise<CommandResult>;

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const { cwd, env = process.env, stdin = "", timeoutMs = 30_000 } = options;
  return new Promise<CommandResult>((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ exitCode: -1, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ exitCode: code ?? -1, stdout, stderr, timedOut });
    });
    child.stdin.end(stdin);
  });
}

async function treeFingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relative = path.slice(root.length + 1);
      hash.update(relative).update("\0");
      if (entry.isDirectory()) await visit(path);
      else {
        const metadata = await stat(path);
        hash
          .update(String(metadata.mode))
          .update("\0")
          .update(await readFile(path));
      }
    }
  }
  await visit(root);
  return hash.digest("hex");
}

// Always deterministic: the built `ask-llm` previews against a fake Claude Code in a private HOME.
async function runSetupPreview(scenario: Scenario, root: string, tempRoot: string): Promise<ScenarioResult> {
  const home = join(tempRoot, "setup-home");
  const bin = join(tempRoot, "setup-bin");
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(
    join(bin, "claude"),
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "2.1.284 (Claude Code)"; exit 0; fi\nexit 9\n',
    { mode: 0o755 },
  );
  const before = await treeFingerprint(home);
  const run = await runCommand(
    process.execPath,
    [join(root, "packages/llm-mcp/dist/ask-llm.js"), "setup", "--dry-run", "--json"],
    { cwd: home, env: { HOME: home, PATH: bin, ASK_LLM_PATH: bin }, timeoutMs: 30_000 },
  );
  const mutated = before !== (await treeFingerprint(home));
  const server = await realpath(join(root, "packages/llm-mcp/dist/cli.js"));
  let claude: { action?: string; registration?: { argv?: unknown } } | undefined;
  try {
    claude = JSON.parse(run.stdout).hosts?.find((host: { id?: string }) => host.id === "claude");
  } catch {}
  const previewed =
    claude?.action === "register" &&
    JSON.stringify(claude.registration?.argv) ===
      JSON.stringify(["claude", "mcp", "add", "--scope", "user", "ask-llm", "--", server]);
  if (run.exitCode === 0 && !mutated && previewed) {
    return {
      id: scenario.id,
      status: RESULTS.PASS,
      reason: "previewed claude mcp add --scope user in an isolated HOME; nothing written",
    };
  }
  return {
    id: scenario.id,
    status: RESULTS.FAIL,
    reason: `exit=${run.exitCode} timedOut=${run.timedOut} homeChanged=${mutated} claudeArgvPreviewed=${previewed}`,
    detail: redact(`${run.stderr}`).slice(0, 500),
  };
}

async function gitFingerprint(cwd: string, commandRunner: CommandRunner): Promise<string> {
  const status = await commandRunner("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd,
    timeoutMs: 10_000,
  });
  const diff = await commandRunner("git", ["diff", "--binary", "HEAD", "--"], { cwd, timeoutMs: 10_000 });
  const untracked = await commandRunner("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd,
    timeoutMs: 10_000,
  });
  if (status.exitCode !== 0 || diff.exitCode !== 0 || untracked.exitCode !== 0) {
    throw new Error("git status/diff/untracked scan failed while establishing the mutation guard");
  }
  const hash = createHash("sha256").update(status.stdout).update("\0").update(diff.stdout);
  const paths = untracked.stdout.split("\0").filter(Boolean).sort();
  for (const path of paths)
    hash
      .update("\0")
      .update(path)
      .update("\0")
      .update(await readFile(join(cwd, path)));
  return hash.digest("hex");
}

function authorizationSet(env: NodeJS.ProcessEnv): Set<string> {
  return new Set(
    (env.ASK_LLM_HARNESS_SMOKE_AUTHORIZED ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function selectedModel(modelKey: string | undefined, mode: Mode, env: NodeJS.ProcessEnv): string | undefined {
  return mode === "dry-run"
    ? EXACT_DRY_MODELS[modelKey as keyof typeof EXACT_DRY_MODELS]
    : env[`ASK_LLM_HARNESS_SMOKE_${modelKey}_MODEL`]?.trim();
}

function selectedEffort(scenario: Scenario, mode: Mode, env: NodeJS.ProcessEnv): string | undefined {
  if (!scenario.effort) return undefined;
  if (mode === "dry-run") return scenario.effort;
  return env[`ASK_LLM_HARNESS_SMOKE_${scenario.provider?.toUpperCase()}_EFFORT`]?.trim() || scenario.effort;
}

export interface Selection {
  model: string;
  secondaryModel?: string;
  hostModel?: string;
  effort?: string;
}

export function buildLivePrompt(scenario: Scenario, selection: Selection): string {
  const marker = smokeMarker(scenario, selection.model);
  const task = `task="Return only ${marker}" consent=confirmed`;
  let command: string;
  if (scenario.surface.includes("brainstorm") && selection.secondaryModel) {
    command = `${scenario.host === "pi" ? "/skill:ask-llm-brainstorm" : "/brainstorm"} grok@cursor-agent:${selection.model},codex@cursor-agent:${selection.secondaryModel} ${task}`;
  } else if (scenario.surface.includes("codex-pair")) {
    command = `${scenario.host === "pi" ? "/skill:ask-llm-codex-pair" : "/codex-pair"} model=${selection.model} effort=${selection.effort} ${task}`;
  } else if (scenario.surface.includes("grok-pair")) {
    command = `/grok-pair route=${scenario.harness} model=${selection.model} effort=${selection.effort} ${task}`;
  } else {
    command = `${scenario.surface} provider=${scenario.provider} harness=${scenario.harness} model=${selection.model} effort=${selection.effort ?? "provider-managed"} ${task}`;
  }
  return [
    command,
    "Local pre-PR smoke. Read only. Do not edit/write, change trust/login/config/billing, or select another route/model.",
    `The per-surface live authorization is the explicit consent for this tiny scenario. Provider=${scenario.provider ?? scenario.host}; fallback is forbidden.`,
  ].join("\n");
}

function skillPath(root: string, surface: string): string {
  const name = surface.replace("/skill:", "").replace("/", "");
  return join(root, "packages", "llm-mcp", "skills", name, "SKILL.md");
}

interface Invocation {
  args: string[];
  stdin?: string;
  env?: NodeJS.ProcessEnv;
}

function liveInvocation(
  scenario: Scenario,
  hostModel: string,
  routeModel: string,
  root: string,
  privatePrompt: string,
  effort?: string,
): Invocation {
  const plugin = join(root, "packages", "llm-mcp");
  if (scenario.tool === "claude") {
    return {
      args: [
        "-p",
        "--output-format",
        "json",
        "--plugin-dir",
        plugin,
        "--model",
        hostModel,
        "--permission-mode",
        "dontAsk",
        "--tools",
        "Read,Glob,Grep",
      ],
      stdin: privatePrompt,
    };
  }
  if (scenario.tool === "agent") {
    return {
      args: ["-p", "--output-format", "json", "--plugin-dir", plugin, "--model", hostModel, "--mode", "ask"],
      stdin: privatePrompt,
    };
  }
  if (scenario.tool === "pi") {
    if (!hostModel.includes("/")) throw new Error("Pi host model must be an exact provider/model ID");
    return {
      args: [
        "-p",
        "--mode",
        "json",
        "--no-session",
        "--offline",
        "--no-context-files",
        "--no-prompt-templates",
        "--no-skills",
        ...(scenario.surface.startsWith("/skill:") ? ["--skill", skillPath(root, scenario.surface)] : []),
        "--no-extensions",
        "-e",
        join(plugin, "pi", "extensions", "index.ts"),
        "--model",
        hostModel,
        "--tools",
        "read,grep,find,ls",
      ],
      stdin: privatePrompt,
      env: { PI_OFFLINE: "1", PI_TELEMETRY: "0" },
    };
  }
  if (scenario.tool === "codex") {
    return {
      args: [
        "exec",
        "--json",
        "--sandbox",
        "read-only",
        "--model",
        routeModel,
        "-c",
        `model_reasoning_effort="${effort}"`,
        "-",
      ],
      stdin: `${privatePrompt}\n`,
    };
  }
  return {
    args: [
      "--no-auto-update",
      "-p",
      privatePrompt,
      "--output-format",
      "json",
      "--model",
      routeModel,
      "--effort",
      effort as string,
      "--sandbox",
      "read-only",
      "--max-turns",
      "1",
      "--no-subagents",
      "--no-memory",
      "--disable-web-search",
    ],
  };
}

interface Discovery {
  available: boolean;
  reason?: string;
  catalog: string[];
  catalogAuthorized?: boolean;
}

async function discoverLive(
  tool: string,
  env: NodeJS.ProcessEnv,
  root: string,
  commandRunner: CommandRunner,
  executionCwd: string = root,
): Promise<Discovery> {
  if (!(await commandExists(tool, env)))
    return { available: false, reason: `${tool} is not installed on PATH`, catalog: [] };
  const version = await commandRunner(tool, ["--version"], { cwd: executionCwd, env, timeoutMs: 10_000 });
  if (version.exitCode !== 0) return { available: false, reason: `${tool} --version failed`, catalog: [] };
  if (tool === "agent" || tool === "pi" || tool === "grok") {
    const args = tool === "agent" || tool === "pi" ? ["--list-models"] : ["models"];
    const catalogResult = await commandRunner(tool, args, { cwd: executionCwd, env, timeoutMs: 20_000 });
    const catalog = catalogResult.exitCode === 0 ? parseCatalog(tool, catalogResult.stdout) : [];
    return {
      available: true,
      catalogAuthorized: catalogResult.exitCode === 0 && catalog.length > 0,
      reason:
        catalogResult.exitCode !== 0
          ? "local catalog requires authentication"
          : catalog.length === 0
            ? "local catalog output was empty or unparseable"
            : "local command catalog read",
      catalog,
    };
  }
  if (tool === "claude") {
    const help = await commandRunner(tool, ["--help"], { cwd: executionCwd, env, timeoutMs: 10_000 });
    const supported = help.exitCode === 0 && help.stdout.includes("--plugin-dir") && help.stdout.includes("--model");
    return {
      available: supported,
      catalogAuthorized: true,
      reason: supported
        ? "Claude local --help plugin/model contract"
        : "installed Claude CLI lacks required plugin/model flags",
      catalog: [],
    };
  }
  if (tool === "codex") {
    const cachePath = env.CODEX_HOME
      ? join(env.CODEX_HOME, "models_cache.json")
      : join(env.HOME ?? "", ".codex", "models_cache.json");
    let catalog: string[] = [];
    try {
      catalog = parseCatalog("codex", await readFile(cachePath, "utf8"));
    } catch {
      // Older Codex versions do not expose a models command; an absent local cache is an authorization skip.
    }
    return { available: true, catalogAuthorized: catalog.length > 0, reason: "Codex local models cache", catalog };
  }
  return { available: true, catalogAuthorized: true, reason: "Claude --help model contract", catalog: [] };
}

export async function validateCursorProviderFamily(
  provider: string,
  model: string,
): Promise<CursorProviderName | null> {
  const { cursorModelFamily } = await import("@ask-llm/mcp/cursor");
  const family = cursorModelFamily(model);
  if (family !== provider) {
    throw new Error(
      family
        ? `Cursor model ${model} belongs to provider ${family}, not ${provider}`
        : `Cursor model ${model} has no canonical provider family`,
    );
  }
  return family;
}

function extractObservedModel(output: unknown, scenario: Scenario): string | undefined {
  const text = String(output);
  const explicit = [...text.matchAll(/"observedModel"\s*:\s*"([^"]+)"/g)].at(-1)?.[1];
  if (explicit) return explicit;
  // Grok Build's JSON envelope reports its served model. Other harnesses echo a
  // selection or display label, which is selected-only evidence, not observed.
  if (scenario.tool === "grok") return [...text.matchAll(/"model"\s*:\s*"([^"]+)"/g)].at(-1)?.[1];
  return undefined;
}

interface AdapterContext {
  root: string;
  workspace: string;
  artifacts: string;
  scenario: Scenario;
  selection: Selection;
  prompt: string;
  commandRunner: CommandRunner;
  env: NodeJS.ProcessEnv;
}

async function runRealAdapterProbe({
  root,
  workspace,
  artifacts,
  scenario,
  selection,
  prompt,
  commandRunner,
  env,
}: AdapterContext): Promise<CommandResult> {
  const configPath = join(artifacts, `${scenario.id.replaceAll(/[^a-z0-9]+/gi, "-")}.adapter.json`);
  await writeFile(
    configPath,
    JSON.stringify({
      root,
      scenario,
      model: selection.model,
      secondaryModel: selection.secondaryModel,
      effort: selection.effort,
      livePrompt: prompt,
      marker: smokeMarker(scenario, selection.model),
    }),
    { mode: 0o600 },
  );
  const tsxCli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  return commandRunner(process.execPath, [tsxCli, join(root, "scripts", "harness-smoke-adapter.ts"), configPath], {
    cwd: workspace,
    env,
    timeoutMs: 30_000,
  });
}

function routeTool(scenario: Scenario): string {
  if (scenario.harness === "cursor-agent") return "agent";
  if (scenario.provider === "codex") return "codex";
  if (scenario.provider === "grok") return "grok";
  return scenario.tool;
}

interface ScenarioResult {
  id: string;
  status: ResultStatus;
  reason: string;
  detail?: string;
}

interface SuiteReport {
  mode: Mode;
  tempRoot: string;
  results: ScenarioResult[];
}

export interface RunHarnessSuiteOptions {
  mode?: Mode;
  env?: NodeJS.ProcessEnv;
  root?: string;
  commandRunner?: CommandRunner;
  fingerprint?: () => Promise<string>;
  scenarios?: readonly Scenario[];
  discovery?: Record<string, Discovery>;
  deterministicAdapter?: (context: AdapterContext) => Promise<CommandResult>;
}

export async function runHarnessSuite(options: RunHarnessSuiteOptions = {}): Promise<SuiteReport> {
  const mode = options.mode ?? "dry-run";
  const env = options.env ?? process.env;
  const root = resolve(options.root ?? process.cwd());
  const commandRunner = options.commandRunner ?? runCommand;
  const fingerprint = options.fingerprint ?? (() => gitFingerprint(root, commandRunner));
  const scenarios = options.scenarios ?? SCENARIOS;
  const results: ScenarioResult[] = [];
  const tempRoot = await mkdtemp(join(tmpdir(), "ask-llm-harness-smoke-"));
  const workspace = join(tempRoot, "workspace");
  const artifacts = join(tempRoot, "private-artifacts");
  await mkdir(workspace, { recursive: true });
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  await writeFile(join(workspace, "README.md"), "Read-only harness smoke fixture.\n", { mode: 0o600 });
  try {
    const before = await fingerprint();
    const authorized = authorizationSet(env);
    const discovery = new Map<string, Discovery>();
    if (mode === "live") {
      const tools = new Set(
        scenarios
          .filter(
            (scenario) => scenario.supported !== false && scenario.liveSupported !== false && !scenario.setupPreview,
          )
          .flatMap((scenario) => [scenario.tool, routeTool(scenario)]),
      );
      for (const tool of tools) {
        discovery.set(
          tool,
          options.discovery?.[tool] ?? (await discoverLive(tool, env, root, commandRunner, artifacts)),
        );
      }
    }

    for (const scenario of scenarios) {
      if (scenario.setupPreview) {
        results.push(await runSetupPreview(scenario, root, tempRoot));
        continue;
      }
      if (scenario.supported === false) {
        results.push({
          id: scenario.id,
          status: RESULTS.SKIP_UNAVAILABLE,
          reason: scenario.unavailableReason as string,
        });
        continue;
      }
      if (mode === "live" && scenario.liveSupported === false) {
        results.push({
          id: scenario.id,
          status: RESULTS.SKIP_UNAVAILABLE,
          reason: scenario.liveUnavailableReason as string,
        });
        continue;
      }

      const selection: Selection = {
        model: selectedModel(scenario.modelKey, mode, env) as string,
        secondaryModel: scenario.secondaryModelKey ? selectedModel(scenario.secondaryModelKey, mode, env) : undefined,
        hostModel: scenario.hostModelKey ? selectedModel(scenario.hostModelKey, mode, env) : undefined,
        effort: selectedEffort(scenario, mode, env),
      };

      if (mode === "live") {
        const host = discovery.get(scenario.tool);
        if (!host?.available) {
          results.push({
            id: scenario.id,
            status: RESULTS.SKIP_UNAVAILABLE,
            reason: host?.reason ?? "tool unavailable",
          });
          continue;
        }
        if (!(authorized.has("all") || authorized.has(scenario.id))) {
          results.push({
            id: scenario.id,
            status: RESULTS.SKIP_NOT_AUTHORIZED,
            reason: "surface not listed in ASK_LLM_HARNESS_SMOKE_AUTHORIZED",
          });
          continue;
        }
        const missing = [
          [scenario.modelKey, selection.model],
          [scenario.secondaryModelKey, selection.secondaryModel],
          [scenario.hostModelKey, selection.hostModel],
        ].find(([key, value]) => key && !value);
        if (missing) {
          results.push({
            id: scenario.id,
            status: RESULTS.SKIP_NOT_AUTHORIZED,
            reason: `exact ${missing[0]} model was not explicitly authorized`,
          });
          continue;
        }

        const hostCatalogModel = selection.hostModel ?? selection.model;
        if (host.catalogAuthorized === false && scenario.tool !== "claude") {
          results.push({ id: scenario.id, status: RESULTS.SKIP_NOT_AUTHORIZED, reason: host.reason as string });
          continue;
        }
        if ((host.catalog?.length ?? 0) > 0 && !host.catalog.includes(hostCatalogModel)) {
          results.push({
            id: scenario.id,
            status: RESULTS.FAIL,
            reason: `exact host model ${hostCatalogModel} is absent from the authoritative ${scenario.tool} catalog`,
          });
          continue;
        }

        const route = discovery.get(routeTool(scenario));
        if (route?.catalogAuthorized === false) {
          results.push({ id: scenario.id, status: RESULTS.SKIP_NOT_AUTHORIZED, reason: route.reason as string });
          continue;
        }
        const missingRouteModel = [selection.model, selection.secondaryModel]
          .filter((value): value is string => Boolean(value))
          .find((routeModel) => (route?.catalog?.length ?? 0) > 0 && !route?.catalog.includes(routeModel));
        if (missingRouteModel) {
          results.push({
            id: scenario.id,
            status: RESULTS.FAIL,
            reason: `exact route model ${missingRouteModel} is absent from the authoritative ${routeTool(scenario)} catalog`,
          });
          continue;
        }
      }

      try {
        if (scenario.harness === "cursor-agent") {
          await validateCursorProviderFamily(scenario.provider as string, selection.model);
          if (selection.secondaryModel) await validateCursorProviderFamily("codex", selection.secondaryModel);
        }
      } catch (error) {
        results.push({
          id: scenario.id,
          status: RESULTS.FAIL,
          reason: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const privatePrompt = buildLivePrompt(scenario, selection);
      const promptPath = join(artifacts, `${scenario.id.replaceAll(/[^a-z0-9]+/gi, "-")}.prompt`);
      await writeFile(promptPath, privatePrompt, { mode: 0o600 });
      const scenarioRepoBefore = await fingerprint();
      const workspaceBefore = await treeFingerprint(workspace);
      const invocation: Invocation =
        mode === "dry-run"
          ? { args: ["--model", selection.model], stdin: undefined }
          : liveInvocation(
              scenario,
              selection.hostModel as string,
              selection.model,
              root,
              privatePrompt,
              selection.effort,
            );
      const run =
        mode === "dry-run"
          ? await (options.deterministicAdapter ?? runRealAdapterProbe)({
              root,
              workspace,
              artifacts,
              scenario,
              selection,
              prompt: privatePrompt,
              commandRunner,
              env,
            })
          : await commandRunner(scenario.tool, invocation.args, {
              cwd: workspace,
              env: { ...env, ...invocation.env },
              stdin: invocation.stdin,
              timeoutMs: Number(env.ASK_LLM_HARNESS_SMOKE_TIMEOUT_MS ?? 120_000),
            });
      const after = await fingerprint();
      const workspaceAfter = await treeFingerprint(workspace);
      const output = `${run.stdout}\n${run.stderr}`;
      const selectedHostModel = selection.hostModel ?? selection.model;
      const evaluated = evaluateInvocation({
        scenario,
        requestedModel: selection.model,
        selectedModel: selectedHostModel,
        observedModel: extractObservedModel(output, scenario),
        output,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        mutated: scenarioRepoBefore !== after || workspaceBefore !== workspaceAfter,
        args: mode === "dry-run" ? ["--model", selectedHostModel] : invocation.args,
      });
      results.push({
        id: scenario.id,
        ...evaluated,
        detail: redact(output, env, [privatePrompt, promptPath]).slice(0, 500),
      });
    }
    const finalFingerprint = await fingerprint();
    if (finalFingerprint !== before && !results.some(({ reason }) => reason.includes("repository changed"))) {
      results.push({
        id: "suite:mutation-guard",
        status: RESULTS.FAIL,
        reason: "the repository changed during discovery or a skipped scenario",
      });
    }
    return { mode, tempRoot, results };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
