import { FACTORY_DEFAULT_HARNESS, GROK_HARNESSES, type GrokHarness, type GrokReasoningEffort } from "../constants.js";
import { executeGrokCLI, listGrokCliModels, probeGrokCli } from "./grokCliExecutor.js";
import { executeGrokAPI, isProviderAvailable as isApiConfigured, listModels } from "./grokExecutor.js";

export { executeGrokCLI, listGrokCliModels, probeGrokCli } from "./grokCliExecutor.js";
export { executeGrokAPI, listModels } from "./grokExecutor.js";

export interface GrokRouterOptions {
  prompt: string;
  model?: string;
  reasoningEffort?: GrokReasoningEffort;
  outputSchema?: Record<string, unknown>;
  harness?: GrokHarness;
  onProgress?: (newOutput: string) => void;
  signal?: AbortSignal;
}

function isGrokHarness(value: string): value is GrokHarness {
  return GROK_HARNESSES.some((harness) => harness === value);
}

function resolveHarness(explicit?: GrokHarness): GrokHarness {
  const configured = explicit ?? process.env.ASK_GROK_HARNESS ?? FACTORY_DEFAULT_HARNESS;
  if (isGrokHarness(configured)) return configured;
  throw new Error(`Unsupported Grok harness "${configured}". Use one of: ${GROK_HARNESSES.join(", ")}.`);
}

export async function isGrokProviderAvailable(): Promise<boolean> {
  const harness = resolveHarness();
  return harness === "xai-api" ? isApiConfigured() : probeGrokCli();
}

export async function listGrokModels(harness?: GrokHarness, signal?: AbortSignal): Promise<string[]> {
  return resolveHarness(harness) === "xai-api" ? listModels(signal) : listGrokCliModels(signal);
}

export async function executeGrok(options: GrokRouterOptions) {
  const harness = resolveHarness(options.harness);
  if (harness === "xai-api") return executeGrokAPI(options);
  if (options.outputSchema) {
    options.onProgress?.("Grok CLI structured output is prompt-constrained and validated locally.");
  }
  return executeGrokCLI(options);
}
