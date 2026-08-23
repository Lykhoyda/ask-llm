import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export const RESULTS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  SKIP_UNAVAILABLE: "SKIP_UNAVAILABLE",
  SKIP_NOT_AUTHORIZED: "SKIP_NOT_AUTHORIZED",
});

export const SCENARIOS = Object.freeze([
  { id: "claude:/brainstorm", tool: "claude", surface: "/brainstorm", host: "claude", modelKey: "CLAUDE" },
  { id: "claude:/codex-pair", tool: "claude", surface: "/codex-pair", host: "claude", modelKey: "CLAUDE" },
  { id: "claude:/grok-pair", tool: "claude", surface: "/grok-pair", host: "claude", modelKey: "CLAUDE" },
  {
    id: "cursor-agent:/brainstorm-route",
    tool: "agent",
    surface: "/brainstorm participant route",
    host: "cursor-agent",
    modelKey: "CURSOR_GROK",
    provider: "grok",
  },
  {
    id: "cursor-agent:/codex-pair",
    tool: "agent",
    surface: "/codex-pair",
    host: "cursor-agent",
    modelKey: "CURSOR_CODEX",
  },
  {
    id: "cursor-agent:/grok-pair",
    tool: "agent",
    surface: "/grok-pair",
    host: "cursor-agent",
    modelKey: "CURSOR_GROK",
  },
  { id: "pi:/brainstorm", tool: "pi", surface: "/skill:brainstorm", host: "pi", modelKey: "PI" },
  { id: "pi:/codex-pair", tool: "pi", surface: "/skill:codex-pair", host: "pi", modelKey: "PI" },
  { id: "pi:native-provider-tools", tool: "pi", surface: "ask-multi native tool route", host: "pi", modelKey: "PI" },
  {
    id: "pi:/grok-pair",
    tool: "pi",
    surface: "/skill:grok-pair",
    host: "pi",
    supported: false,
    unavailableReason: "the Pi manifest deliberately excludes grok-pair (ADR-147)",
  },
  {
    id: "codex-cli:/brainstorm-route",
    tool: "codex",
    surface: "/brainstorm direct Codex participant",
    host: "codex-cli",
    modelKey: "CODEX",
    provider: "codex",
  },
  {
    id: "codex-cli:/codex-pair",
    tool: "codex",
    surface: "/codex-pair reviewer route",
    host: "codex-cli",
    modelKey: "CODEX",
    provider: "codex",
  },
  {
    id: "grok-cli:/brainstorm-route",
    tool: "grok",
    surface: "/brainstorm direct Grok participant",
    host: "grok-cli",
    modelKey: "GROK",
    provider: "grok",
  },
  {
    id: "grok-cli:/grok-pair",
    tool: "grok",
    surface: "/grok-pair reviewer route",
    host: "grok-cli",
    modelKey: "GROK",
    provider: "grok",
  },
]);

const EXACT_DRY_MODELS = Object.freeze({
  CLAUDE: "claude-opus-4-7",
  CURSOR_GROK: "cursor-grok-4.6-high",
  CURSOR_CODEX: "gpt-5.6-sol-high",
  PI: "openai-codex/gpt-5.6-sol",
  CODEX: "gpt-5.6-sol",
  GROK: "grok-build",
});

const SENSITIVE_NAME = /(api.?key|token|secret|credential|authorization|session)/i;
const FALLBACK_TEXT =
  /(fellBack\s*[=:]\s*true|fallback(?: model| route| harness)?\s*(?:to|used|occurred)|silently (?:fell back|rerouted))/i;
const FORBIDDEN_FLAGS = new Set(["--force", "--yolo", "--trust", "--approve"]);
const MUTATION_TOOL_NAMES = new Set(["edit", "write", "multiedit", "notebookedit"]);

export function redact(value, env = process.env, extraSecrets = []) {
  let text = String(value ?? "");
  const secrets = [...extraSecrets];
  for (const [name, secret] of Object.entries(env)) {
    if (SENSITIVE_NAME.test(name) && typeof secret === "string" && secret.length >= 4) secrets.push(secret);
  }
  for (const secret of new Set(secrets.filter(Boolean))) text = text.replaceAll(secret, "[REDACTED]");
  text = text.replace(/(?:sk|xai|key|token)[-_][A-Za-z0-9._-]{8,}/gi, "[REDACTED]");
  return text;
}

export function parseCatalog(tool, output) {
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
      const parsed = JSON.parse(text);
      const models = Array.isArray(parsed) ? parsed : parsed.models;
      return Array.isArray(models)
        ? models.map((entry) => (typeof entry === "string" ? entry : (entry?.slug ?? entry?.id))).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function evaluateInvocation({
  scenario,
  requestedModel,
  observedModel,
  output,
  exitCode,
  timedOut,
  mutated,
  args = [],
}) {
  if (timedOut) return { status: RESULTS.FAIL, reason: "timed out; the process was terminated" };
  if (exitCode !== 0) return { status: RESULTS.FAIL, reason: `exited nonzero (${exitCode})` };
  if (mutated) return { status: RESULTS.FAIL, reason: "the repository changed during a read-only scenario" };
  const hasForbiddenFlag = args.some((arg) => FORBIDDEN_FLAGS.has(arg.toLowerCase()) || arg === "workspace-write");
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
  if (modelIndex < 0 || args[modelIndex + 1] !== requestedModel)
    return { status: RESULTS.FAIL, reason: "the exact selected model option was lost" };
  if (FALLBACK_TEXT.test(output)) return { status: RESULTS.FAIL, reason: "the output disclosed a forbidden fallback" };
  if (observedModel && observedModel !== requestedModel) {
    return { status: RESULTS.FAIL, reason: `model mismatch: requested ${requestedModel}, observed ${observedModel}` };
  }
  const marker = `ASK_LLM_SMOKE_OK host=${scenario.host} model=${requestedModel} fallback=false`;
  if (!output.includes(marker))
    return { status: RESULTS.FAIL, reason: "the deterministic routing/attribution marker was absent" };
  return {
    status: RESULTS.PASS,
    reason: `${scenario.host} routed ${scenario.surface} with ${requestedModel}; attribution=selected-unverified; fallback=false`,
  };
}

function commandExists(command, env) {
  const path = env.PATH ?? "";
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  return Promise.any(
    path
      .split(delimiter)
      .filter(Boolean)
      .flatMap((directory) => extensions.map((extension) => access(join(directory, `${command}${extension}`)))),
  )
    .then(() => true)
    .catch(() => false);
}

export async function runCommand(command, args, options = {}) {
  const { cwd, env = process.env, stdin = "", timeoutMs = 30_000 } = options;
  return new Promise((resolveResult) => {
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
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
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

async function gitFingerprint(cwd, commandRunner) {
  const status = await commandRunner("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd,
    timeoutMs: 10_000,
  });
  const diff = await commandRunner("git", ["diff", "--binary", "HEAD", "--"], { cwd, timeoutMs: 10_000 });
  if (status.exitCode !== 0 || diff.exitCode !== 0) {
    throw new Error("git status/diff failed while establishing the mutation guard");
  }
  return createHash("sha256").update(status.stdout).update("\0").update(diff.stdout).digest("hex");
}

function authorizationSet(env) {
  return new Set(
    (env.ASK_LLM_HARNESS_SMOKE_AUTHORIZED ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function liveModel(modelKey, env) {
  return env[`ASK_LLM_HARNESS_SMOKE_${modelKey}_MODEL`]?.trim();
}

function ephemeralPrompt(scenario, model) {
  return [
    scenario.surface,
    "Local pre-PR smoke. Read only. Do not edit/write, change trust/login/config/billing, or select another route/model.",
    `Return only: ASK_LLM_SMOKE_OK host=${scenario.host} model=${model} fallback=false`,
  ].join("\n");
}

function skillPath(root, surface) {
  const name = surface.replace("/skill:", "").replace("/", "");
  return join(root, "packages", "claude-plugin", "skills", name, "SKILL.md");
}

function liveInvocation(scenario, model, root, privatePrompt) {
  const plugin = join(root, "packages", "claude-plugin");
  if (scenario.tool === "claude") {
    return {
      args: [
        "-p",
        "--output-format",
        "json",
        "--plugin-dir",
        plugin,
        "--model",
        model,
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
      args: ["-p", "--output-format", "json", "--plugin-dir", plugin, "--model", model, "--mode", "ask"],
      stdin: privatePrompt,
    };
  }
  if (scenario.tool === "pi") {
    if (!model.includes("/")) throw new Error("Pi model must be an exact provider/model ID");
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
        model,
        "--tools",
        "read,grep,find,ls",
      ],
      stdin: privatePrompt,
      env: { PI_OFFLINE: "1", PI_TELEMETRY: "0" },
    };
  }
  if (scenario.tool === "codex") {
    return {
      args: ["exec", "--json", "--sandbox", "read-only", "--model", model, "-"],
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
      model,
      "--effort",
      "low",
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

async function discoverLive(tool, env, root, commandRunner, executionCwd = root) {
  if (!(await commandExists(tool, env)))
    return { available: false, reason: `${tool} is not installed on PATH`, catalog: [] };
  const version = await commandRunner(tool, ["--version"], { cwd: executionCwd, env, timeoutMs: 10_000 });
  if (version.exitCode !== 0) return { available: false, reason: `${tool} --version failed`, catalog: [] };
  if (tool === "agent" || tool === "pi" || tool === "grok") {
    const args = tool === "agent" || tool === "pi" ? ["--list-models"] : ["models"];
    const catalogResult = await commandRunner(tool, args, { cwd: executionCwd, env, timeoutMs: 20_000 });
    return {
      available: true,
      catalogAuthorized: catalogResult.exitCode === 0,
      reason: catalogResult.exitCode === 0 ? "local command catalog read" : "local catalog requires authentication",
      catalog: catalogResult.exitCode === 0 ? parseCatalog(tool, catalogResult.stdout) : [],
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
    let catalog = [];
    try {
      catalog = parseCatalog("codex", await readFile(cachePath, "utf8"));
    } catch {
      // Older Codex versions do not expose a models command; an absent local cache is an authorization skip.
    }
    return { available: true, catalogAuthorized: catalog.length > 0, reason: "Codex local models cache", catalog };
  }
  return { available: true, catalogAuthorized: true, reason: "Claude --help model contract", catalog: [] };
}

function extractObservedModel(output, scenario) {
  const text = String(output);
  const explicit = [...text.matchAll(/"observedModel"\s*:\s*"([^"]+)"/g)].at(-1)?.[1];
  if (explicit) return explicit;
  // Grok Build's JSON envelope reports its served model. Other harnesses echo a
  // selection or display label, which is selected-only evidence, not observed.
  if (scenario.tool === "grok") return [...text.matchAll(/"model"\s*:\s*"([^"]+)"/g)].at(-1)?.[1];
  return undefined;
}

export async function runHarnessSuite(options = {}) {
  const mode = options.mode ?? "dry-run";
  const env = options.env ?? process.env;
  const root = resolve(options.root ?? process.cwd());
  const commandRunner = options.commandRunner ?? runCommand;
  const fingerprint = options.fingerprint ?? (() => gitFingerprint(root, commandRunner));
  const scenarios = options.scenarios ?? SCENARIOS;
  const results = [];
  const tempRoot = await mkdtemp(join(tmpdir(), "ask-llm-harness-smoke-"));
  await writeFile(join(tempRoot, "README"), "Ephemeral harness smoke data. Safe to remove.\n", { mode: 0o600 });
  try {
    const before = await fingerprint();
    const authorized = authorizationSet(env);
    const discovery = new Map();
    if (mode === "live") {
      for (const tool of new Set(scenarios.map(({ tool }) => tool))) {
        discovery.set(
          tool,
          options.discovery?.[tool] ?? (await discoverLive(tool, env, root, commandRunner, tempRoot)),
        );
      }
    }

    for (const scenario of scenarios) {
      if (scenario.supported === false) {
        results.push({ id: scenario.id, status: RESULTS.SKIP_UNAVAILABLE, reason: scenario.unavailableReason });
        continue;
      }
      const model = mode === "dry-run" ? EXACT_DRY_MODELS[scenario.modelKey] : liveModel(scenario.modelKey, env);
      if (mode === "live") {
        const found = discovery.get(scenario.tool);
        if (!found?.available) {
          results.push({
            id: scenario.id,
            status: RESULTS.SKIP_UNAVAILABLE,
            reason: found?.reason ?? "tool unavailable",
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
        if (!model) {
          results.push({
            id: scenario.id,
            status: RESULTS.SKIP_NOT_AUTHORIZED,
            reason: `exact ${scenario.modelKey} model was not explicitly authorized`,
          });
          continue;
        }
        if (found.catalog?.length > 0 && !found.catalog.includes(model)) {
          results.push({
            id: scenario.id,
            status: RESULTS.FAIL,
            reason: `exact model ${model} is absent from the authoritative local catalog`,
          });
          continue;
        }
        if (found.catalogAuthorized === false && scenario.tool !== "claude") {
          results.push({ id: scenario.id, status: RESULTS.SKIP_NOT_AUTHORIZED, reason: found.reason });
          continue;
        }
      }

      const promptPath = join(tempRoot, `${scenario.id.replaceAll(/[^a-z0-9]+/gi, "-")}.prompt`);
      const privatePrompt = ephemeralPrompt(scenario, model);
      await writeFile(promptPath, privatePrompt, { mode: 0o600 });
      const invocation =
        mode === "dry-run"
          ? {
              args: ["--fake", "--host", scenario.host, "--surface", scenario.surface, "--model", model, "--read-only"],
              fakeOutput: `ASK_LLM_SMOKE_OK host=${scenario.host} model=${model} fallback=false`,
            }
          : liveInvocation(scenario, model, root, privatePrompt);
      const run =
        mode === "dry-run"
          ? { exitCode: 0, stdout: invocation.fakeOutput, stderr: "", timedOut: false }
          : await commandRunner(scenario.tool, invocation.args, {
              cwd: tempRoot,
              env: { ...env, ...invocation.env },
              stdin: invocation.stdin,
              timeoutMs: Number(env.ASK_LLM_HARNESS_SMOKE_TIMEOUT_MS ?? 120_000),
            });
      const after = await fingerprint();
      const output = `${run.stdout}\n${run.stderr}`;
      const evaluated = evaluateInvocation({
        scenario,
        requestedModel: model,
        observedModel: extractObservedModel(output, scenario),
        output,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        mutated: before !== after,
        args: invocation.args,
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
