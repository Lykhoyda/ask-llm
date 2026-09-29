import { realpathSync } from "node:fs";
import { sep } from "node:path";
import type { DetectedHost } from "./hosts/detect.js";
import { type HostId, SERVER_NAME } from "./hosts/registry.js";
import { resolveCommand } from "./utils/availability.js";

export type PlanAction = "register" | "up-to-date" | "conflict" | "manual" | "skip";

export type PlannedRegistration =
  | { kind: "command"; argv: string[]; command: string }
  | { kind: "json"; file: string; keyPath: string[]; entry: unknown };

export interface PlanEntry {
  id: HostId;
  name: string;
  installed: boolean;
  version?: string;
  action: PlanAction;
  reason?: string;
  manual?: string;
  registration: PlannedRegistration;
  skillsDir?: string;
  restart: "new-session" | "app-restart";
}

export interface ServerPath {
  path: string;
  source: "global-bin" | "package-dist";
}

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

export function isOwnRegistration(host: DetectedHost, server: string): boolean {
  if (host.spec.registrationState.kind === "packages") return host.registered === true;
  return host.command?.length === 1 && sameFile(host.command[0], server);
}

export async function resolveServerPath(ownCli: string): Promise<ServerPath> {
  const target = realpathSync(ownCli);
  if (target.split(sep).includes("_npx")) {
    throw new Error(
      "ask-llm is running from an npx cache, which is not a durable server path. Install it with `npm i -g @ask-llm/mcp`, then run `ask-llm setup --dry-run` again.",
    );
  }
  const onPath = await resolveCommand("ask-llm-mcp");
  if (onPath && sameFile(onPath, target)) return { path: onPath, source: "global-bin" };
  return { path: target, source: "package-dist" };
}

export function genericSnippet(server: string) {
  return { mcpServers: { [SERVER_NAME]: { command: server, args: [] } } };
}

function plannedRegistration(host: DetectedHost, server: string): PlannedRegistration {
  const { registration } = host.spec;
  if (registration.kind === "json") {
    const { file, keyPath } = registration;
    return { kind: "json", file, keyPath, entry: registration.entry(server) };
  }
  const argv = registration.argv(server);
  return { kind: "command", argv, command: argv.map(shellQuote).join(" ") };
}

function manualText(registration: PlannedRegistration): string {
  if (registration.kind === "command") return registration.command;
  return `add ${JSON.stringify(registration.entry)} at ${registration.keyPath.join(".")} in ${registration.file}`;
}

function decide(host: DetectedHost, server: string): { action: PlanAction; reason?: string } {
  if (host.registered === null) return { action: "manual", reason: host.error };
  if (!host.installed) {
    return {
      action: "skip",
      reason: host.leftoverConfig ? `not installed; leftover config at ${host.spec.configHome}` : "not installed",
    };
  }
  if (host.registered) {
    if (isOwnRegistration(host, server))
      return { action: "up-to-date", reason: "already registered to this ask-llm-mcp" };
    const current = host.command ? `\`${host.command.join(" ")}\`` : "an unrecognized command";
    return { action: "conflict", reason: `an ask-llm entry already runs ${current}; setup will not overwrite it` };
  }
  if (!host.supported) {
    const probe = [host.spec.binaries[0], ...(host.spec.versionProbe?.args ?? [])].join(" ");
    return { action: "manual", reason: `unrecognized \`${probe}\` output; check the syntax and run it manually` };
  }
  if (host.spec.unverified) {
    return { action: "manual", reason: `${host.name} registration is unverified; add the entry manually` };
  }
  return { action: "register" };
}

export function buildPlan(hosts: DetectedHost[], server: string): PlanEntry[] {
  return hosts.map((host) => {
    const registration = plannedRegistration(host, server);
    const { action, reason } = decide(host, server);
    return {
      id: host.id,
      name: host.name,
      installed: host.installed,
      version: host.version,
      action,
      reason,
      manual: action === "manual" ? manualText(registration) : undefined,
      registration,
      skillsDir: host.spec.skillsDir,
      restart: host.spec.restart,
    };
  });
}
