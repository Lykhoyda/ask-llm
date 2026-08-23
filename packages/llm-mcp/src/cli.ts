#!/usr/bin/env node

import { Logger, type MachineProvider, machineRequestSchema, type ProviderSpec, runDiagnostics } from "@ask-llm/shared";
import { PROVIDERS } from "./constants.js";
import { type ExecutorFn, startServer } from "./index.js";
import { machineJsonSchemaBundle, runMachineRequest } from "./machine.js";
import { readPackageJson } from "./packageMetadata.js";
import { startRepl } from "./repl.js";
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

const MAX_MACHINE_STDIN_BYTES = 2 * 1024 * 1024;

class MachineInputError extends Error {}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  let oversized = false;

  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_MACHINE_STDIN_BYTES) oversized = true;
    if (!oversized) chunks.push(buffer);
  }

  if (size === 0 || oversized) throw new MachineInputError();
  return Buffer.concat(chunks).toString("utf8");
}

function parseMachineInput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new MachineInputError();
  }
}

async function loadMachineExecutor(provider: MachineProvider): Promise<ExecutorFn | undefined> {
  const spec = PROVIDERS[provider];
  if (!spec) return undefined;

  try {
    const configuredOverride = process.env.ASK_LLM_MACHINE_EXECUTOR_MODULE;
    const allowOverride = process.env.ASK_LLM_MACHINE_ALLOW_EXECUTOR_OVERRIDE === "1";
    const moduleName = allowOverride && configuredOverride ? configuredOverride : spec.executorModule;
    const module = await import(moduleName);
    const executor = module[spec.executorFn];
    return typeof executor === "function" ? (executor as ExecutorFn) : undefined;
  } catch {
    Logger.warn(`Machine provider ${provider} could not be loaded`);
    return undefined;
  }
}

async function withDiagnosticsOnStderr<T>(run: () => Promise<T>): Promise<T> {
  const log = console.log;
  const info = console.info;
  console.log = console.error;
  console.info = console.error;
  try {
    return await run();
  } finally {
    console.log = log;
    console.info = info;
  }
}

function writeMachineDocument(document: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = process.stdout;
    let serialized: string;
    let settled = false;
    let callbackCheck: NodeJS.Immediate | undefined;

    function finish(error?: unknown): void {
      if (settled) return;
      settled = true;
      if (callbackCheck) clearImmediate(callbackCheck);
      output.off("error", handleError);
      if (error === undefined || error === null) resolve();
      else reject(error);
    }

    function handleError(error: Error): void {
      finish(error);
    }

    function handleWrite(error?: Error | null): void {
      if (callbackCheck) return;
      callbackCheck = setImmediate(() => finish(error));
    }

    try {
      serialized = `${JSON.stringify(document)}\n`;
      output.once("error", handleError);
      output.write(serialized, handleWrite);
    } catch (error) {
      finish(error);
    }
  });
}

async function runMachineCli(): Promise<number> {
  try {
    if (process.argv.length > 3) throw new MachineInputError();
    const input = parseMachineInput(await readStdin());
    const request = machineRequestSchema.safeParse(input);
    if (!request.success) throw new MachineInputError();

    const result = await withDiagnosticsOnStderr(() =>
      runMachineRequest(request.data, {
        loadExecutor: loadMachineExecutor,
        now: Date.now,
      }),
    );
    await writeMachineDocument(result);
    return 0;
  } catch (error) {
    if (!(error instanceof MachineInputError)) throw error;
    process.stderr.write(
      "machine input rejected: expected one valid JSON request on stdin\nUsage: ask-llm-mcp machine\n",
    );
    return 2;
  }
}

async function runDoctor(options: DoctorCliOptions): Promise<number> {
  if (options.help) {
    process.stdout.write(doctorHelp());
    return 0;
  }

  const specs: ProviderSpec[] = await buildProviderSpecs();
  const report = await runDiagnostics(specs);

  process.stdout.write(formatDoctorOutput(report, options));

  return report.status === "error" ? 1 : 0;
}

async function runDoctorCli(args: string[]): Promise<number> {
  let options: DoctorCliOptions;
  try {
    options = parseDoctorArguments(args);
  } catch (error) {
    if (!(error instanceof DoctorArgumentError)) throw error;
    process.stderr.write(formatDoctorCliError(error, requestedStructuredFormat(args)));
    return 2;
  }
  return runDoctor(options);
}

function cliHelp(): string {
  return [
    "Usage:",
    "  ask-llm-mcp                         Start the MCP server on stdio",
    "  ask-llm-mcp <command> [options]     Run a CLI command",
    "",
    "Commands:",
    "  doctor          Report provider and environment diagnostics",
    "  repl            Start the interactive multi-provider REPL",
    "  machine         Process one machine request from stdin",
    "  machine-schema  Print the machine protocol schema bundle",
    "",
    "Options:",
    "  -h, --help      Show this help",
    "  -V, --version   Show the package version",
    "",
    "Run ask-llm-mcp doctor --help for doctor options.",
    "",
  ].join("\n");
}

function rejectUnsupportedArgument(): void {
  process.stderr.write(`Error: unsupported command or argument.\n\n${cliHelp()}`);
  process.exitCode = 2;
}

const args = process.argv.slice(2);
const subcommand = args[0];

if (args.length === 0) {
  startServer().catch((error) => {
    Logger.error("Fatal error:", error);
    process.exit(1);
  });
} else if (args.length === 1 && (subcommand === "--help" || subcommand === "-h")) {
  process.stdout.write(cliHelp());
} else if (args.length === 1 && (subcommand === "--version" || subcommand === "-V")) {
  process.stdout.write(`${readPackageJson().version}\n`);
} else if (subcommand === "machine-schema" && args.length === 1) {
  writeMachineDocument(machineJsonSchemaBundle()).then(
    () => process.exit(0),
    () => {
      process.stderr.write("machine schema failed\n");
      process.exit(3);
    },
  );
} else if (subcommand === "machine") {
  runMachineCli().then(
    (code) => process.exit(code),
    () => {
      process.stderr.write("machine dispatcher failed\n");
      process.exit(3);
    },
  );
} else if (subcommand === "doctor") {
  runDoctorCli(args.slice(1)).then(
    (code) => process.exit(code),
    (error) => {
      Logger.error("doctor failed:", error);
      process.exit(1);
    },
  );
} else if (subcommand === "repl" && args.length === 1) {
  startRepl().then(
    (code) => process.exit(code),
    (error) => {
      Logger.error("repl failed:", error);
      process.exit(1);
    },
  );
} else {
  rejectUnsupportedArgument();
}
