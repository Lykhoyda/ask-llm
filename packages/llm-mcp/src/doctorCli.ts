import { type ProviderSpec, runDiagnostics } from "@ask-llm/shared";
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

export async function runDoctorCli(args: string[]): Promise<number> {
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
