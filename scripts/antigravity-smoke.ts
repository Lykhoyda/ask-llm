import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  assessAgyVersion,
  executeAntigravityCLI,
  isAntigravityReasoningEffort,
  isAntigravityTieredModel,
  isPrintTimeoutTruncation,
} from "../packages/llm-mcp/dist/antigravity-executor.js";
import { createScopedAskLlmServer } from "../packages/llm-mcp/dist/index.js";
import { askResponseSchema, executeCommand, resolveSpawnCommand } from "../packages/shared/dist/index.js";
import { hasFallbackDisclosure, runCommand } from "./harness-smoke-lib.ts";

const AUTHORIZATION = "mcp:antigravity-included";
const PROMPT = "Reply with exactly OK. Do not use tools.";
const MODEL_TIMEOUT_MS = 300_000;
const CONFLICTING_ROUTE =
  /\b(?:api[ _-]key|adc|vertex|cloud[ _-]project|pay[ _-]as[ _-]you[ _-]go|metered|overages?|ai[ _-]credits?)\b/i;
const ROUTE_OVERRIDE_NAMES = new Set([
  "AGY_ADC_AUTH",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_QUOTA_PROJECT",
  "GOOGLE_GEMINI_BASE_URL",
  "GOOGLE_GENAI_USE_VERTEXAI",
  "GCLOUD_PROJECT",
]);

type Effort = NonNullable<Parameters<typeof executeAntigravityCLI>[0]["reasoningEffort"]>;
interface Selection {
  model: string;
  effort: Effort;
}

const EXIT_CODES = { PASS: 0, FAIL: 1, SKIP_NOT_AUTHORIZED: 2, SKIP_UNAVAILABLE: 2 } as const;
type Status = keyof typeof EXIT_CODES;
interface Result {
  status: Status;
  reason: string;
  model?: string;
  effort?: Effort;
  agyVersion?: string;
}

function parseSelection(args: string[]): Selection | undefined {
  try {
    const { values, tokens } = parseArgs({
      args,
      tokens: true,
      options: {
        model: { type: "string" },
        effort: { type: "string" },
        "confirm-included-only": { type: "boolean" },
      },
    });
    const { model, effort } = values;
    if (
      tokens.length === 3 &&
      values["confirm-included-only"] &&
      model &&
      model.length <= 80 &&
      /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(model) &&
      !isAntigravityTieredModel(model) &&
      !/-(?:low|medium|high|xhigh|max|auto|default|latest)$/.test(model) &&
      effort &&
      isAntigravityReasoningEffort(effort)
    ) {
      return { model, effort };
    }
  } catch {
    // Invalid arguments can contain arbitrary text. Keep them out of the result.
  }
}

// lstat is enough to detect added, removed, replaced or written paths (including
// writes that restore mtime). Never open worktree files or follow symlinks.
async function treeFingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(path: string): Promise<void> {
    const info = await lstat(path, { bigint: true });
    const fields = [info.dev, info.ino, info.mode, info.size, info.mtimeNs, info.ctimeNs];
    hash.update(JSON.stringify([relative(root, path), ...fields.map(String)])).update("\n");
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name));
    }
  }
  await visit(root);
  return hash.digest("hex");
}

async function repoFingerprint(root: string): Promise<string> {
  // A linked worktree's index and HEAD can be outside its directory.
  const head = await runCommand("git", ["rev-parse", "--show-toplevel", "HEAD"], { cwd: root, timeoutMs: 10_000 });
  if (head.exitCode !== 0 || !head.stdout.startsWith(`${root}\n`)) {
    throw new Error("Run from the repository root after building.");
  }
  const [index, tree] = await Promise.all([
    runCommand("git", ["ls-files", "--stage", "-z"], { cwd: root, timeoutMs: 10_000 }),
    treeFingerprint(root),
  ]);
  if (index.exitCode !== 0) throw new Error("Could not snapshot the repository index");
  return createHash("sha256")
    .update(head.stdout)
    .update("\0")
    .update(index.stdout)
    .update("\0")
    .update(tree)
    .digest("hex");
}

interface ModelObservation {
  argv: string[];
  stderr: string;
  stdout?: string;
}

function hasExactArgv(argv: string[], { model, effort }: Selection): boolean {
  const prompt = argv[1];
  const timeout = argv[7];
  if (!prompt?.endsWith(`\n\n${PROMPT}`) || !/^\d+s$/.test(timeout)) return false;
  const denyOverlay = JSON.stringify({ agentMode: "", permissions: { deny: ["write_file(*)", "command(*)"] } });
  return isDeepStrictEqual(argv, [
    "-p",
    prompt,
    "--model",
    model,
    "--effort",
    effort,
    "--print-timeout",
    timeout,
    "--output-format",
    "json",
    "--disable-slash-commands",
    "--sandbox",
    "--settings",
    denyOverlay,
  ]);
}

function nonemptyReport(value: unknown): boolean {
  return value != null && value !== "" && value !== false && (!Array.isArray(value) || value.length !== 0);
}

function isCompleteAnswer({ stdout, stderr }: ModelObservation): boolean {
  if (!stdout || isPrintTimeoutTruncation(stderr) || /\b(?:denied|denial|refused|quota|AGY_ERROR)\b/i.test(stderr)) {
    return false;
  }
  if (CONFLICTING_ROUTE.test(stderr) || CONFLICTING_ROUTE.test(stdout)) return false;
  if (hasFallbackDisclosure(stderr) || hasFallbackDisclosure(stdout)) return false;
  try {
    const envelope: Record<string, unknown> = JSON.parse(stdout);
    return (
      envelope.status === "SUCCESS" &&
      (envelope.response === "OK" || envelope.response === "OK\n") &&
      typeof envelope.num_turns === "number" &&
      Number.isSafeInteger(envelope.num_turns) &&
      envelope.num_turns > 0 &&
      envelope.finished_reason === undefined &&
      (envelope.truncated === undefined || envelope.truncated === false) &&
      !nonemptyReport(envelope.error) &&
      !nonemptyReport(envelope.denied_actions) &&
      !["fallback", "fellBack", "fell_back", "fallback_model"].some((key) => nonemptyReport(envelope[key]))
    );
  } catch {
    return false;
  }
}

async function callAntigravity(
  agy: string,
  scratch: string,
  selection: Selection,
  cancellation?: AbortSignal,
): Promise<Result> {
  let probed = false;
  let supported = false;
  let conflictingRoute = false;
  let version: string | undefined;
  let observation: ModelObservation | undefined;
  let unexpectedInvocation = false;

  // The executor owns the version gate and model argv. This guard observes the
  // actual subprocess boundary and refuses any extra command before it can run.
  const runAgy: typeof executeCommand = async (command, argv, _progress, onStderr, input, timeout, logging, signal) => {
    const capture: ModelObservation = { argv: [...argv], stderr: "" };
    const versionProbe = isDeepStrictEqual(capture.argv, ["--version"]);
    if (
      command !== "agy" ||
      input !== undefined ||
      (versionProbe ? probed : !supported || observation !== undefined || !hasExactArgv(capture.argv, selection))
    ) {
      unexpectedInvocation = true;
      throw new Error("Unexpected Antigravity invocation");
    }
    probed = true;
    if (!versionProbe) observation = capture;
    const signals = [signal, cancellation].filter((value) => value !== undefined);
    const stdout = await executeCommand(
      agy,
      argv,
      undefined,
      (chunk) => {
        capture.stderr += chunk;
        onStderr?.(chunk);
      },
      undefined,
      Math.min(timeout ?? MODEL_TIMEOUT_MS, MODEL_TIMEOUT_MS),
      logging,
      AbortSignal.any(signals),
      { cwd: scratch, env: process.env, killProcessGroup: true },
    ).finally(() => {
      if (versionProbe && CONFLICTING_ROUTE.test(capture.stderr)) conflictingRoute = true;
    });
    capture.stdout = stdout;
    if (versionProbe) {
      if (conflictingRoute || CONFLICTING_ROUTE.test(stdout)) {
        conflictingRoute = true;
        throw new Error("Conflicting Antigravity route or overage signal");
      }
      // Only a standalone version is sufficient evidence. Emit only its numeric core.
      const match = /^(?:agy(?: version)?\s+)?v?(\d{1,6}\.\d{1,6}\.\d{1,6})(?:-[a-zA-Z0-9.-]+)?$/.exec(stdout);
      if (!match) throw new Error("Unparseable Antigravity version");
      const support = assessAgyVersion(stdout);
      supported = support.available;
      version = match[1];
    }
    return stdout;
  };

  const server = createScopedAskLlmServer("antigravity", async (options) => {
    if (
      options.model !== selection.model ||
      options.reasoningEffort !== selection.effort ||
      options.singleAttempt !== true ||
      options.modelFromCall !== true ||
      options.includeDirs !== undefined ||
      options.sessionId !== undefined
    ) {
      throw new Error("Unexpected Antigravity request options");
    }
    return executeAntigravityCLI({ ...options, reasoningEffort: options.reasoningEffort, readOnly: true }, runAgy);
  });
  const client = new Client({ name: "antigravity-included-smoke", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const result = (status: Status, reason: string): Result => ({ status, reason, ...selection, agyVersion: version });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const reply = await client.callTool(
      {
        name: "ask-llm",
        arguments: {
          provider: "antigravity",
          prompt: PROMPT,
          model: selection.model,
          reasoningEffort: selection.effort,
          noFallback: true,
        },
      },
      { timeout: MODEL_TIMEOUT_MS + 15_000 },
    );
    if (cancellation?.aborted) return result("FAIL", "Smoke interrupted");
    if (unexpectedInvocation) return result("FAIL", "Unexpected agy command or arguments");
    if (conflictingRoute) return result("SKIP_NOT_AUTHORIZED", "Conflicting route or overage signal");
    if (probed && !supported) return result("SKIP_UNAVAILABLE", "agy version unavailable or unsupported");
    if (!observation?.stdout) return result("FAIL", "agy model attempt failed or produced no output");
    if (!isCompleteAnswer(observation)) return result("FAIL", "agy did not report a complete, clean OK response");
    const response = askResponseSchema.safeParse(reply.structuredContent);
    if (reply.isError || !response.success) return result("FAIL", "Unified MCP result failed");
    if (
      response.data.response !== "OK" ||
      response.data.provider !== "antigravity" ||
      response.data.model !== selection.model
    ) {
      return result("FAIL", "Unified MCP result did not match the selected call");
    }
    return result("PASS", "Wrapper and agy outcome verified. Funding user-attested. Served model identity unverified.");
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

async function runAntigravitySmoke(args: string[], cancellation?: AbortSignal): Promise<Result> {
  const selection = parseSelection(args);
  if (
    !selection ||
    process.env.ASK_LLM_HARNESS_SMOKE_LIVE !== "1" ||
    process.env.ASK_LLM_HARNESS_SMOKE_AUTHORIZED !== AUTHORIZATION ||
    process.env.ASK_ANTIGRAVITY_ALLOW_UNISOLATED !== "1"
  ) {
    return {
      status: "SKIP_NOT_AUTHORIZED",
      reason: "Exact authorization, model, effort and one-run attestation required",
      ...selection,
    };
  }
  // Check environment names only. Effective CLI/profile settings are attested by the operator.
  if (Object.keys(process.env).some((name) => ROUTE_OVERRIDE_NAMES.has(name))) {
    return { status: "SKIP_NOT_AUTHORIZED", reason: "Conflicting authentication or billing environment", ...selection };
  }

  const originalLogLevel = process.env.GMCPT_LOG_LEVEL;
  process.env.GMCPT_LOG_LEVEL = "silent";
  let scratch: string | undefined;
  let result: Result = { status: "FAIL", reason: "Smoke could not complete", ...selection };
  try {
    const agy = resolveSpawnCommand("agy", process.env);
    if (!agy) return { status: "SKIP_UNAVAILABLE", reason: "agy not found on PATH", ...selection };
    const root = await realpath(process.cwd());
    const temp = await realpath(tmpdir());
    const tempFromRoot = relative(root, temp);
    if (!(tempFromRoot === ".." || tempFromRoot.startsWith(`..${sep}`) || isAbsolute(tempFromRoot))) {
      throw new Error("The temporary directory must be outside the repository");
    }
    const repoBefore = await repoFingerprint(root);
    scratch = await mkdtemp(join(temp, "ask-llm-agy-smoke-"));
    const scratchBefore = await treeFingerprint(scratch);
    result = await callAntigravity(agy, scratch, selection, cancellation);
    const [repoAfter, scratchAfter] = await Promise.all([repoFingerprint(root), treeFingerprint(scratch)]);
    if (repoBefore !== repoAfter || scratchBefore !== scratchAfter) {
      result = { ...result, status: "FAIL", reason: "Scratch workspace or repository changed" };
    }
  } catch {
    result = { ...result, status: "FAIL", reason: "Smoke setup, transport or mutation check failed" };
  } finally {
    try {
      if (scratch) await rm(scratch, { recursive: true, force: true });
    } catch {
      result = { ...result, status: "FAIL", reason: "Scratch cleanup failed" };
    }
    if (originalLogLevel === undefined) delete process.env.GMCPT_LOG_LEVEL;
    else process.env.GMCPT_LOG_LEVEL = originalLogLevel;
  }
  if (cancellation?.aborted && result.status === "PASS")
    return { ...result, status: "FAIL", reason: "Smoke interrupted" };
  return result;
}

if (import.meta.main) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const result = await runAntigravitySmoke(process.argv.slice(2), controller.signal);
    console.log(JSON.stringify(result));
    process.exitCode = EXIT_CODES[result.status];
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
