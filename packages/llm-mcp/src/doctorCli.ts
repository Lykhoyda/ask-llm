import { type DiagnosticReport, formatDiagnosticReport, type ProviderSpec, runDiagnostics } from "@ask-llm/shared";
import { type DetectedHost, detectHosts } from "./hosts/detect.js";
import { buildPlan, isOwnRegistration, resolveServerPath } from "./plan.js";
import {
  DoctorArgumentError,
  type DoctorCliOptions,
  doctorHelp,
  formatDoctorCliError,
  formatDoctorOutput,
  parseDoctorArguments,
  requestedStructuredFormat,
} from "./toonDoctor.js";
import { buildProviderSpecs } from "./utils/providerSpecs.js";

type DoctorHost = Omit<DetectedHost, "spec"> & { ownServer?: boolean; restart: string; manual?: string };

async function doctorHosts(ownCli: string): Promise<DoctorHost[]> {
  const server = await resolveServerPath(ownCli).then(
    ({ path }) => path,
    () => undefined,
  );
  const hosts = await detectHosts();
  const plan = server ? buildPlan(hosts, server) : undefined;
  return hosts.map(({ spec, ...host }, index) => ({
    ...host,
    ownServer: host.registered && server ? isOwnRegistration({ ...host, spec }, server) : undefined,
    restart: spec.restart,
    manual: plan?.[index].manual,
  }));
}

function formatHost(host: DoctorHost): string[] {
  if (!host.installed) {
    const lines = [`  - ${host.name}: not installed${host.leftoverConfig ? " (leftover config)" : ""}${host.error ? `, ${host.error}` : ""}`];
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
  const restart = host.restart === "app-restart" ? "restart the app" : "start a new session";
  const lines = [
    `  - ${host.name}: installed${version}, ${registration}`,
    `      after a registration change: ${restart}`,
  ];
  if (host.manual) lines.push(`      exact manual command: ${host.manual}`);
  return lines;
}

function formatHosts(hosts: DoctorHost[]): string {
  return ["Hosts:", ...hosts.flatMap(formatHost), ""].join("\n");
}

async function runDoctor(options: DoctorCliOptions, ownCli?: string): Promise<number> {
  if (options.help) {
    process.stdout.write(doctorHelp());
    return 0;
  }

  const specs: ProviderSpec[] = await buildProviderSpecs();
  const [report, hosts] = await Promise.all([
    runDiagnostics(specs),
    ownCli && options.format !== "toon" ? doctorHosts(ownCli) : Promise.resolve(undefined),
  ]);

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
    options = parseDoctorArguments(args);
  } catch (error) {
    if (!(error instanceof DoctorArgumentError)) throw error;
    process.stderr.write(formatDoctorCliError(error, requestedStructuredFormat(args)));
    return 2;
  }
  return runDoctor(options, ownCli);
}
