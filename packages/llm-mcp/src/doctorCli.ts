import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type DiagnosticCheck,
  type DiagnosticReport,
  formatDiagnosticReport,
  type ProviderSpec,
  runDiagnostics,
} from "@ask-llm/shared";
import { PROVIDERS } from "./constants.js";
import { type DetectedHost, detectHosts } from "./hosts/detect.js";
import { legacyPackage } from "./hosts/legacy.js";
import { type ParityRow, parityRowsFor } from "./hosts/parity.js";
import type { ExecutorFn } from "./index.js";
import { dispatchMultiLlm } from "./multiLlm.js";
import { buildPlan, DURABLE_SERVER_GUIDANCE, isOwnRegistration, resolveServerPath } from "./plan.js";
import {
  DoctorArgumentError,
  type DoctorCliOptions,
  doctorHelp,
  formatDoctorCliError,
  formatDoctorOutput,
  parseDoctorArguments,
  requestedStructuredFormat,
} from "./toonDoctor.js";
import { loadProviderModule } from "./utils/providerModules.js";
import { buildProviderSpecs } from "./utils/providerSpecs.js";

const LIVE_PROMPT = "Reply with exactly: OK";
const LIVE_TIMEOUT_MS = 120_000;

type ExecutorLoader = (key: string) => Promise<ExecutorFn | undefined>;

async function loadExecutor(key: string): Promise<ExecutorFn | undefined> {
  const config = PROVIDERS[key];
  if (!config) return undefined;
  return (await loadProviderModule(config.executorModule))[config.executorFn] as ExecutorFn | undefined;
}

export async function exerciseProviders(
  report: DiagnosticReport,
  specs: ProviderSpec[],
  load: ExecutorLoader = loadExecutor,
): Promise<DiagnosticReport> {
  const keyByName = new Map(specs.map((spec) => [spec.name, spec.key]));
  const skipped = new Map<string, string>();
  const ready: string[] = [];
  for (const provider of report.providers) {
    const key = keyByName.get(provider.name);
    if (!key || !provider.states) continue;
    if (!provider.available) skipped.set(key, "not available");
    else if (provider.states.permitted === "no") skipped.set(key, "not permitted");
    else if (provider.states.authenticated === "no") skipped.set(key, "not authenticated");
    else ready.push(key);
  }

  const executors = new Map<string, ExecutorFn>();
  const grokHarness =
    process.env.ASK_GROK_HARNESS === "grok-cli" || (!process.env.ASK_GROK_HARNESS && !process.env.XAI_API_KEY?.trim())
      ? "grok-cli"
      : "xai-api";
  for (const key of ready) {
    const executor = await load(key).catch(() => undefined);
    if (executor) {
      executors.set(key, (options) =>
        executor({
          ...options,
          sandbox: "read-only",
          readOnly: true,
          singleAttempt: true,
          ...(key === "grok" ? { harness: grokHarness } : {}),
          ...(key === "codex" ? { reasoningEffort: "low" as const } : {}),
        }),
      );
    }
  }

  const cwd = process.cwd();
  const scratch = ready.length > 0 ? mkdtempSync(join(tmpdir(), "ask-llm-doctor-live-")) : undefined;
  let results: Awaited<ReturnType<typeof dispatchMultiLlm>>["results"] = [];
  try {
    if (scratch) {
      process.chdir(scratch);
      ({ results } = await dispatchMultiLlm({
        prompt: LIVE_PROMPT,
        providers: ready,
        getExecutor: (key) => executors.get(key),
        signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      }));
    }
  } finally {
    process.chdir(cwd);
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }

  const resultByKey = new Map(results.map((result) => [result.provider, result]));
  const checks: DiagnosticCheck[] = [];
  const providers = report.providers.map((provider) => {
    const key = keyByName.get(provider.name);
    if (!key || !provider.states) return provider;
    const result = resultByKey.get(key);
    const name = `Live: ${provider.name}`;
    if (!result) {
      checks.push({ name, status: "skip", message: `not exercised: ${skipped.get(key) ?? "not ready"}` });
    } else if (result.ok) {
      checks.push({
        name,
        status: "pass",
        message: `answered via ${result.model ?? "unreported model"} in ${result.durationMs}ms`,
      });
    } else {
      checks.push({ name, status: "fail", message: (result.error ?? "failed").slice(0, 300) });
    }
    return { ...provider, states: { ...provider.states, exercised: result?.ok ? ("yes" as const) : ("no" as const) } };
  });

  const allChecks = [...report.checks, ...checks];
  const status = allChecks.some((check) => check.status === "fail")
    ? "error"
    : allChecks.some((check) => check.status === "warn")
      ? "warning"
      : "ok";
  return { ...report, status, providers, checks: allChecks };
}

type DoctorHost = Omit<DetectedHost, "spec"> & {
  ownServer?: boolean;
  restart: string;
  manual?: string;
  parity?: Record<ParityRow, string>;
};

async function doctorHosts(ownCli: string): Promise<DoctorHost[]> {
  const server = await resolveServerPath(ownCli).then(
    ({ path }) => path,
    () => undefined,
  );
  const hosts = await detectHosts();
  const plan = server ? buildPlan(hosts, server) : undefined;
  return hosts.map(({ spec, ...host }, index) => {
    const needsManual = host.registered === null || (host.installed && !host.supported);
    return {
      ...host,
      ownServer: host.registered && server ? isOwnRegistration({ ...host, spec }, server) : undefined,
      restart: spec.restart,
      manual: plan?.[index].manual ?? (!server && needsManual ? DURABLE_SERVER_GUIDANCE : undefined),
      parity: host.installed ? parityRowsFor(spec.id) : undefined,
    };
  });
}

function formatHost(host: DoctorHost): string[] {
  if (!host.installed) {
    const lines = [
      `  - ${host.name}: not installed${host.leftoverConfig ? " (leftover config)" : ""}${host.error ? `, ${host.error}` : ""}`,
    ];
    if (host.manual) lines.push(`      exact manual command: ${host.manual}`);
    return lines;
  }
  const version = host.version ? ` (${host.version})` : host.supported ? "" : " (unrecognized version)";
  let registration = "not registered";
  if (host.registered === null) registration = host.error ?? "registration unknown";
  else if (host.registered && host.ownServer) registration = "registered to this ask-llm-mcp";
  else if (host.registered && host.ownServer === false) {
    registration = `registered to \`${host.command?.join(" ") ?? "an unrecognized command"}\``;
  } else if (host.registered) registration = "registered";
  if (host.legacy?.length) registration += `; earlier ${host.legacy.join(", ")} still listed`;
  if (host.legacy?.length || (host.ownServer === false && legacyPackage(host.command)))
    registration += " (`ask-llm setup` migrates it)";
  const restart = host.restart === "app-restart" ? "restart the app" : "start a new session";
  const lines = [
    `  - ${host.name}: installed${version}, ${registration}`,
    `      after a registration change: ${restart}`,
  ];
  if (host.manual) lines.push(`      exact manual command: ${host.manual}`);
  for (const [row, value] of Object.entries(host.parity ?? {})) lines.push(`      ${row}: ${value}`);
  return lines;
}

function formatHosts(hosts: DoctorHost[]): string {
  return ["Hosts:", ...hosts.flatMap(formatHost), ""].join("\n");
}

async function runDoctor(options: DoctorCliOptions, ownCli?: string): Promise<number> {
  if (options.help) {
    process.stdout.write(doctorHelp(Boolean(ownCli)));
    return 0;
  }

  const specs: ProviderSpec[] = await buildProviderSpecs();
  const [probed, hosts] = await Promise.all([
    runDiagnostics(specs),
    ownCli && options.format !== "toon" ? doctorHosts(ownCli) : Promise.resolve(undefined),
  ]);

  const report = options.live ? await exerciseProviders(probed, specs) : probed;
  process.stdout.write(hosts ? formatWithHosts(report, hosts, options) : formatDoctorOutput(report, options));

  return report.status === "error" ? 1 : 0;
}

function formatWithHosts(report: DiagnosticReport, hosts: DoctorHost[], options: DoctorCliOptions): string {
  if (options.format === "json") return `${JSON.stringify({ ...report, hosts }, null, 2)}\n`;
  return `${formatDiagnosticReport(report)}${formatHosts(hosts)}`;
}

export async function runDoctorCli(args: string[], ownCli?: string): Promise<number> {
  let options: DoctorCliOptions;
  try {
    options = parseDoctorArguments(args, Boolean(ownCli));
  } catch (error) {
    if (!(error instanceof DoctorArgumentError)) throw error;
    process.stderr.write(formatDoctorCliError(error, requestedStructuredFormat(args)));
    return 2;
  }
  return runDoctor(options, ownCli);
}
