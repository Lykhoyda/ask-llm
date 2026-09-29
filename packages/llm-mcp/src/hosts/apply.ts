import { getSpawnEnv } from "@ask-llm/shared";
import { isOwnRegistration, UNUSABLE_ENTRY } from "../plan.js";
import { type DetectedHost, type RegistrationState, readRegistration } from "./detect.js";
import { antigravity } from "./registrars/antigravity.js";
import { claude } from "./registrars/claude.js";
import { codex } from "./registrars/codex.js";
import { gemini } from "./registrars/gemini.js";
import { grok } from "./registrars/grok.js";
import type { HostId } from "./registry.js";
import { runHost } from "./spawn.js";

export type HostOp = "add" | "remove";
export type Registrar = (op: HostOp, server: string) => string[];

export const REGISTRARS: Partial<Record<HostId, Registrar>> = { claude, codex, agy: antigravity, grok, gemini };

export interface Applied {
  outcome: "changed" | "unchanged" | "conflict" | "failed";
  detail?: string;
}

const HOST_COMMAND_TIMEOUT_MS = 30_000;
const ALREADY_EXISTS = /already (exists|configured)/i;
const NOT_FOUND = /not found|no mcp server named/i;

function firstLine(text: string): string {
  return (text.split(/\r?\n/).find((line) => line.trim()) ?? "").trim().slice(0, 300);
}

function conflict(command: string[] | undefined): Applied {
  return {
    outcome: "conflict",
    detail: `an ask-llm entry already runs \`${command?.join(" ") ?? "an unknown command"}\``,
  };
}

// Every host except Claude overwrites on add, so ownership is checked on a fresh read right before any spawn.
function gate(host: DetectedHost, current: RegistrationState, op: HostOp, server: string): Applied | undefined {
  if (current.registered === null) return { outcome: "failed", detail: current.error };
  const owned = current.registered && isOwnRegistration({ ...host, ...current, command: current.command }, server);
  if (op === "add") {
    if (current.present) return { outcome: "conflict", detail: `${UNUSABLE_ENTRY}; not overwritten` };
    if (current.registered) return owned ? { outcome: "unchanged" } : conflict(current.command);
  } else if (!owned) {
    return current.present
      ? { outcome: "conflict", detail: `${UNUSABLE_ENTRY}; left in place` }
      : current.registered ? conflict(current.command) : { outcome: "unchanged" };
  }
  return undefined;
}

export async function applyRegistrar(
  host: DetectedHost,
  op: HostOp,
  server: string,
  env: NodeJS.ProcessEnv,
): Promise<Applied> {
  const registrar = REGISTRARS[host.id];
  if (!registrar || !host.binary) return { outcome: "failed", detail: `${host.name} has no command registrar` };
  const spawnEnv = { ...env, PATH: getSpawnEnv().PATH };
  const read = () => readRegistration(host.spec.registrationState, host.binary, spawnEnv);
  const refused = gate(host, await read(), op, server);
  if (refused) return refused;

  const argv = registrar(op, server);
  const run = await runHost(host.binary, argv.slice(1), spawnEnv, HOST_COMMAND_TIMEOUT_MS);
  const output = `${run.stderr}\n${run.stdout}`;
  const benign = (op === "add" ? ALREADY_EXISTS : NOT_FOUND).test(output);
  if (run.code !== 0 && !benign) {
    return {
      outcome: "failed",
      detail: `${firstLine(output) || "no output"} (exit ${run.code ?? "timeout or signal"})`,
    };
  }

  const after = await read();
  if (after.registered === null) return { outcome: "failed", detail: after.error };
  if (op === "remove") {
    if (after.registered || after.present)
      return { outcome: "failed", detail: `ask-llm is still registered after \`${argv.join(" ")}\`` };
    return { outcome: benign ? "unchanged" : "changed" };
  }
  if (isOwnRegistration({ ...host, ...after, command: after.command }, server)) {
    return { outcome: benign ? "unchanged" : "changed" };
  }
  if (after.registered) return conflict(after.command);
  return { outcome: "failed", detail: `the ask-llm entry was not found after \`${argv.join(" ")}\`` };
}
