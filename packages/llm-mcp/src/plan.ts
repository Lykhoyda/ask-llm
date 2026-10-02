import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { getSpawnEnv } from "@ask-llm/shared";
import type { DetectedHost } from "./hosts/detect.js";
import { legacyPackage, mentionedPackage } from "./hosts/legacy.js";
import { type HostId, SERVER_NAME } from "./hosts/registry.js";
import { resolveCommand } from "./utils/availability.js";

export type PlanAction = "register" | "replace" | "up-to-date" | "conflict" | "manual" | "skip";

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
  // For `replace`: the exact change that swaps the earlier entry for this install's.
  replace?: string;
  registration: PlannedRegistration;
  skillsDir?: string;
  restart: "new-session" | "app-restart";
}

export interface ServerPath {
  path: string;
  source: "global-bin" | "package-dist";
}

export const UNUSABLE_ENTRY = "an ask-llm entry exists but is disabled or has no usable command";

export const DURABLE_SERVER_GUIDANCE =
  "Install globally with `npm i -g @ask-llm/mcp`, then run `ask-llm setup --dry-run` for the exact per-host command.";

function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function commandText(argv: string[]): string {
  return argv.map(shellQuote).join(" ");
}

function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return a === b;
  }
}

export function isOwnCommand(command: string[] | undefined, server: string): boolean {
  return command?.length === 1 && sameFile(command[0], server);
}

export function isOwnRegistration(host: DetectedHost, server: string): boolean {
  if (host.spec.registrationState.kind === "packages") return host.registered === true && !host.custom;
  return isOwnCommand(host.command, server);
}

export async function resolveServerPath(ownCli: string): Promise<ServerPath> {
  const target = realpathSync(ownCli);
  if (target.split(sep).includes("_npx")) {
    throw new Error(
      `ask-llm is running from an npx cache, which is not a durable server path. ${DURABLE_SERVER_GUIDANCE}`,
    );
  }
  const onPath = await resolveCommand("ask-llm-mcp");
  if (onPath && sameFile(onPath, target)) {
    const npm = await resolveCommand("npm");
    if (npm) {
      try {
        const options = { encoding: "utf8" as const, timeout: 5000, env: getSpawnEnv() };
        const prefix = execFileSync(npm, ["prefix", "-g"], options).trim();
        const root = execFileSync(npm, ["root", "-g"], options).trim();
        if (
          onPath === join(prefix, "bin", "ask-llm-mcp") &&
          target === join(realpathSync(root), "@ask-llm", "mcp", "dist", "cli.js")
        )
          return { path: onPath, source: "global-bin" };
      } catch {}
    }
  }
  return { path: target, source: "package-dist" };
}

export function genericSnippet(server: string) {
  return { mcpServers: { [SERVER_NAME]: { command: server, args: [] } } };
}

function plannedRegistration(host: DetectedHost, server: string): PlannedRegistration {
  const { registration } = host.spec;
  if (registration.kind === "json") {
    const { keyPath, value } = registration.edit("add", server);
    return { kind: "json", file: registration.file, keyPath, entry: value };
  }
  const argv = registration.argv(server);
  return { kind: "command", argv, command: commandText(argv) };
}

export function manualText(registration: PlannedRegistration): string {
  if (registration.kind === "command") return registration.command;
  return `add ${JSON.stringify(registration.entry)} at ${registration.keyPath.join(".")} in ${registration.file}`;
}

// Swapping an earlier entry: hosts that refuse an add over an existing name lose it first; the rest overwrite in place.
export function replaceText(host: DetectedHost, server: string): string {
  const { registration } = host.spec;
  if (registration.kind === "json") {
    const { keyPath, value } = registration.edit("add", server);
    return `replace ${keyPath.join(".")} in ${registration.file} with ${JSON.stringify(value)}`;
  }
  const add = commandText(registration.argv(server));
  const remove = registration.remove?.(SERVER_NAME);
  return registration.refusesExisting && remove ? `${commandText(remove)} && ${add}` : add;
}

function decide(host: DetectedHost, server: string): { action: PlanAction; reason?: string } {
  if (host.registered === null) return { action: "manual", reason: host.error };
  if (!host.installed) {
    return {
      action: "skip",
      reason: host.leftoverConfig ? `not installed; leftover config at ${host.spec.configHome}` : "not installed",
    };
  }
  if (host.spec.registrationState.kind === "packages" && host.custom)
    return {
      action: "conflict",
      reason: `Ask LLM packages have their own settings (${host.custom}); setup leaves them in place`,
    };
  if (host.registered) {
    if (isOwnRegistration(host, server))
      return { action: "up-to-date", reason: "already registered to this ask-llm-mcp" };
    const current = host.command ? `\`${host.command.join(" ")}\`` : "an unrecognized command";
    if (legacyPackage(host.command)) {
      if (!host.custom && host.supported)
        return {
          action: "replace",
          reason: `an ask-llm entry runs ${current} from an earlier install; setup replaces it`,
        };
      if (host.custom) {
        const reason = `an ask-llm entry runs ${current} with its own settings (${host.custom}); setup will not carry them over or overwrite it`;
        return { action: "conflict", reason };
      }
    }
    return { action: "conflict", reason: `an ask-llm entry already runs ${current}; setup will not overwrite it` };
  }
  if (host.present) return { action: "conflict", reason: `${UNUSABLE_ENTRY}; setup will not overwrite it` };
  if (!host.supported) {
    const probe = [host.spec.binaries[0], ...(host.spec.versionProbe?.args ?? [])].join(" ");
    return { action: "manual", reason: `unrecognized \`${probe}\` output; check the syntax and run it manually` };
  }
  if (host.legacy?.length)
    return { action: "register", reason: `replaces ${host.legacy.join(", ")}, which setup then removes` };
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
      manual:
        action === "conflict" && host.spec.registrationState.kind === "packages" && host.custom
          ? `preserve package filters and custom settings in ${host.spec.configFile} when migrating to @ask-llm/mcp`
          : action === "manual" || (host.installed && !host.supported)
          ? manualText(registration)
          : action === "conflict" && mentionedPackage(host.command?.join(" "))
            ? `preserve custom settings and command options you still need, then: ${replaceText(host, server)}`
            : undefined,
      replace: action === "replace" ? replaceText(host, server) : undefined,
      registration,
      skillsDir: host.spec.skillsDir,
      restart: host.spec.restart,
    };
  });
}
