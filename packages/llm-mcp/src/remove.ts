import { type Applied, applyRegistrar, canApply, changeText } from "./hosts/apply.js";
import type { DetectedHost } from "./hosts/detect.js";
import type { HostId } from "./hosts/registry.js";
import { isOwnRegistration, UNUSABLE_ENTRY } from "./plan.js";
import { type Confirm, type HostResult, type HostStatus, inScope, nextStep, result } from "./setup.js";

const REMOVED: Record<Applied["outcome"], HostStatus> = {
  changed: "removed",
  unchanged: "not-registered",
  conflict: "not-owned",
  failed: "failed",
};

function foreign(host: DetectedHost): string {
  return `an ask-llm entry runs \`${host.command?.join(" ") ?? "an unknown command"}\`, not this ask-llm-mcp; left in place`;
}

export async function applyRemove(
  hosts: DetectedHost[],
  server: string,
  selected: HostId[] | undefined,
  confirm: Confirm,
  env: NodeJS.ProcessEnv,
): Promise<HostResult[]> {
  const results: HostResult[] = [];
  for (const host of hosts.filter((candidate) => inScope(candidate, selected))) {
    const manual = changeText(host, "remove", server);
    if (!canApply(host)) {
      results.push(
        result(host, selected ? "manual" : "unsupported", { detail: `remove does not handle ${host.name} yet` }),
      );
    } else if (!host.installed) results.push(result(host, "skipped", { detail: "not installed" }));
    else if (host.registered === null) {
      const detail = `${host.error}; inspect the entry and remove it only if it runs this ask-llm-mcp`;
      results.push(result(host, "manual", { detail }));
    } else if (host.present) {
      results.push(result(host, "not-owned", { detail: `${UNUSABLE_ENTRY}; left in place` }));
    } else if (!host.registered) results.push(result(host, "not-registered"));
    else if (!isOwnRegistration(host, server)) results.push(result(host, "not-owned", { detail: foreign(host) }));
    else if (
      !(await confirm(
        `Remove Ask LLM from ${host.name}? ${host.spec.registration.kind === "command" ? "Runs" : "Writes"}: ${manual}`,
      ))
    ) {
      results.push(result(host, "declined"));
    } else {
      const applied = await applyRegistrar(host, "remove", server, env);
      const status = REMOVED[applied.outcome];
      results.push(
        result(host, status, {
          detail: applied.detail,
          backup: applied.backup,
          manual: status === "failed" ? manual : undefined,
          next: status === "removed" ? nextStep(host, false) : undefined,
        }),
      );
    }
  }
  return results;
}
