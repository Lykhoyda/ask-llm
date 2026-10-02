import { type Applied, applyRegistrar } from "./hosts/apply.js";
import type { DetectedHost } from "./hosts/detect.js";
import type { HostId } from "./hosts/registry.js";
import { buildPlan, manualText } from "./plan.js";

export type HostStatus =
  | "registered"
  | "up-to-date"
  | "removed"
  | "not-registered"
  | "declined"
  | "skipped"
  | "conflict"
  | "not-owned"
  | "manual"
  | "unsupported"
  | "failed";

export interface HostResult {
  id: HostId;
  name: string;
  version?: string;
  status: HostStatus;
  detail?: string;
  manual?: string;
  next?: string;
  backup?: string;
}

export type Confirm = (question: string) => Promise<boolean>;

export const UNSUCCESSFUL: ReadonlySet<HostStatus> = new Set(["skipped", "conflict", "manual", "failed"]);

export function inScope(host: DetectedHost, selected: HostId[] | undefined): boolean {
  return selected ? selected.includes(host.id) : host.installed;
}

export function nextStep(host: DetectedHost, withNotice: boolean): string {
  const restart = host.spec.restart === "app-restart" ? "restart the app" : "start a new session";
  return [`${restart} to load the change`, withNotice && host.spec.notice].filter(Boolean).join(". ");
}

export function result(host: DetectedHost, status: HostStatus, extra: Partial<HostResult> = {}): HostResult {
  return { id: host.id, name: host.name, version: host.version, status, ...extra };
}

const ADDED: Record<Applied["outcome"], HostStatus> = {
  changed: "registered",
  unchanged: "up-to-date",
  conflict: "conflict",
  failed: "failed",
};

export async function applySetup(
  hosts: DetectedHost[],
  server: string,
  selected: HostId[] | undefined,
  confirm: Confirm,
  env: NodeJS.ProcessEnv,
): Promise<HostResult[]> {
  const plan = buildPlan(hosts, server);
  const results: HostResult[] = [];
  for (const [index, host] of hosts.entries()) {
    if (!inScope(host, selected)) continue;
    const { action, reason, registration } = plan[index];
    const manual = manualText(registration);
    if (action === "register") {
      const verb = registration.kind === "command" ? "Runs" : "Writes";
      if (!(await confirm(`Register Ask LLM with ${host.name}? ${verb}: ${manual}`))) {
        results.push(result(host, "declined"));
        continue;
      }
      const applied = await applyRegistrar(host, "add", server, env);
      const status = ADDED[applied.outcome];
      results.push(
        result(host, status, {
          detail: applied.detail,
          backup: applied.backup,
          manual: status === "failed" ? manual : undefined,
          next: status === "registered" ? nextStep(host, true) : undefined,
        }),
      );
    } else {
      const status = action === "skip" ? "skipped" : action;
      // A file host's foreign entry is reported with the exact entry this install would use; it is never written.
      const snippet = action === "manual" || (action === "conflict" && registration.kind === "json");
      results.push(
        result(host, status, {
          detail: action === "up-to-date" ? undefined : reason,
          manual: snippet ? manual : undefined,
        }),
      );
    }
  }
  return results;
}
