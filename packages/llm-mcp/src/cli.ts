#!/usr/bin/env node

import {
  formatDiagnosticReport,
  Logger,
  type MachineProvider,
  machineRequestSchema,
  type ProviderSpec,
  runDiagnostics,
} from "@ask-llm/shared";
import { PROVIDERS } from "./constants.js";
import { type ExecutorFn, startServer } from "./index.js";
import { machineJsonSchemaBundle, runMachineRequest } from "./machine.js";
import { startRepl } from "./repl.js";
import { buildProviderSpecs } from "./utils/providerSpecs.js";

const MAX_MACHINE_STDIN_BYTES = 150 * 1024;

class MachineInputError extends Error {}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_MACHINE_STDIN_BYTES) throw new MachineInputError();
    chunks.push(buffer);
  }

  if (size === 0) throw new MachineInputError();
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
    const moduleName = process.env.ASK_LLM_MACHINE_EXECUTOR_MODULE ?? spec.executorModule;
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
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof MachineInputError)) throw error;
    process.stderr.write("machine input rejected: expected one valid JSON request on stdin\n");
    return 2;
  }
}

async function runDoctor(jsonOutput: boolean): Promise<number> {
  const specs: ProviderSpec[] = await buildProviderSpecs();
  const report = await runDiagnostics(specs);

  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatDiagnosticReport(report));
  }

  return report.status === "error" ? 1 : 0;
}

const subcommand = process.argv[2];

if (subcommand === "machine-schema") {
  process.stdout.write(`${JSON.stringify(machineJsonSchemaBundle())}\n`);
  process.exit(0);
} else if (subcommand === "machine") {
  runMachineCli().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`machine dispatcher failed: ${String(error)}\n`);
      process.exit(3);
    },
  );
} else if (subcommand === "doctor") {
  const jsonOutput = process.argv.includes("--json");
  runDoctor(jsonOutput).then(
    (code) => process.exit(code),
    (error) => {
      Logger.error("doctor failed:", error);
      process.exit(1);
    },
  );
} else if (subcommand === "repl") {
  startRepl().then(
    (code) => process.exit(code),
    (error) => {
      Logger.error("repl failed:", error);
      process.exit(1);
    },
  );
} else {
  startServer().catch((error) => {
    Logger.error("Fatal error:", error);
    process.exit(1);
  });
}
