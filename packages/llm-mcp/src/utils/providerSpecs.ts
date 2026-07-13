import type { ProviderSpec } from "@ask-llm/shared";
import { INSTALL_HINTS, isProviderEligible, PROVIDERS } from "../constants.js";

export async function buildProviderSpecs(): Promise<ProviderSpec[]> {
  const specs: ProviderSpec[] = [];
  for (const [key, config] of Object.entries(PROVIDERS)) {
    if (!isProviderEligible(config)) continue;

    const installHint = INSTALL_HINTS[key];
    let probeAvailability: ProviderSpec["probeAvailability"];
    if (config.availabilityModule && config.availabilityFn) {
      const moduleName = config.availabilityModule;
      const fnName = config.availabilityFn;
      probeAvailability = async () => {
        try {
          const mod = (await import(moduleName)) as Record<string, unknown>;
          const fn = mod[fnName] as (() => Promise<boolean>) | undefined;
          if (typeof fn !== "function") return false;
          return await fn();
        } catch {
          return false;
        }
      };
    }
    let enrich: ProviderSpec["enrich"];
    if (config.enrichModule && config.enrichFn) {
      const moduleName = config.enrichModule;
      const fnName = config.enrichFn;
      enrich = async (ctx) => {
        try {
          const mod = (await import(moduleName)) as Record<string, unknown>;
          const fn = mod[fnName] as ProviderSpec["enrich"] | undefined;
          if (typeof fn !== "function") return undefined;
          return await fn(ctx);
        } catch {
          return undefined;
        }
      };
    }

    specs.push({
      key,
      name: config.name,
      command: config.command,
      installHint,
      probeAvailability,
      enrich,
    });
  }
  return specs;
}
