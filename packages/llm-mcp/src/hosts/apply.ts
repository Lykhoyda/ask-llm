import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { getSpawnEnv } from "@ask-llm/shared";
import { commandText, isOwnCommand, isOwnRegistration, UNUSABLE_ENTRY } from "../plan.js";
import { type DetectedHost, entryCommand, type RegistrationState, readRegistration } from "./detect.js";
import { type JsonEdit, writeJsonKey } from "./json-merge.js";
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

export function canRemove(host: DetectedHost): boolean {
  return host.spec.registration.kind === "json" || REGISTRARS[host.id] !== undefined;
}

// What setup or remove will do, in the words the confirmation and the manual step use.
export function changeText(host: DetectedHost, op: HostOp, server: string): string | undefined {
  const { registration } = host.spec;
  if (registration.kind === "json") {
    const { keyPath, value } = registration.edit(op, server);
    const at = `${keyPath.join(".")} in ${registration.file}`;
    return op === "add" ? `add ${JSON.stringify(value)} at ${at}` : `remove ${at}`;
  }
  const argv = op === "add" ? registration.argv(server) : REGISTRARS[host.id]?.(op, server);
  return argv && commandText(argv);
}

export interface Applied {
  outcome: "changed" | "unchanged" | "conflict" | "failed";
  detail?: string;
  backup?: string;
}

const HOST_COMMAND_TIMEOUT_MS = 30_000;
const ALREADY_EXISTS = /already (exists|configured)/i;
const NOT_FOUND = /not found|no mcp server named/i;

export function firstLine(text: string): string {
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
      : current.registered
        ? conflict(current.command)
        : { outcome: "unchanged" };
  }
  return undefined;
}

export function backupConfig(file: string | undefined): string | undefined {
  if (!file) return undefined;
  let resolved: string;
  try {
    resolved = realpathSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const backup = `${resolved}.ask-llm-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let source: number;
  try {
    source = openSync(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    let mode = 0o600;
    let stat: ReturnType<typeof fstatSync> | undefined;
    try {
      stat = fstatSync(source);
    } catch {
      stat = undefined;
    }
    if (stat && !stat.isFile()) throw new Error("config is not a regular file");
    if (stat) mode = stat.mode & 0o7777;
    const target = openSync(
      backup,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let length = readSync(source, buffer, 0, buffer.length, null);
      while (length > 0) {
        let offset = 0;
        while (offset < length) offset += writeSync(target, buffer, offset, length - offset);
        length = readSync(source, buffer, 0, buffer.length, null);
      }
      fchmodSync(target, mode);
    } catch (error) {
      closeSync(target);
      unlinkSync(backup);
      throw error;
    }
    closeSync(target);
    return backup;
  } finally {
    closeSync(source);
  }
}

export async function applyRegistrar(
  host: DetectedHost,
  op: HostOp,
  server: string,
  env: NodeJS.ProcessEnv,
): Promise<Applied> {
  const { registration } = host.spec;
  const argv =
    registration.kind === "command"
      ? op === "add"
        ? registration.argv(server)
        : REGISTRARS[host.id]?.(op, server)
      : undefined;
  if (registration.kind === "command" && (!argv || !host.binary))
    return { outcome: "failed", detail: `${host.name} has no command registrar` };
  const spawnEnv = { ...env, PATH: getSpawnEnv().PATH };
  const read = () => readRegistration(host.spec.registrationState, host.binary, spawnEnv);
  const refused = gate(host, await read(), op, server);
  if (refused) return refused;

  let backup: string | undefined;
  const backUp = (): string | undefined => {
    try {
      backup = backupConfig(host.spec.configFile);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `cannot back up ${host.spec.configFile}: ${firstLine(detail)}`;
    }
    return undefined;
  };
  let change: Changed | Applied;
  if (registration.kind === "json") {
    change = writeRegistrar(registration.file, registration.edit(op, server), op, server, backUp);
  } else {
    const unsaved = backUp();
    if (unsaved) return { outcome: "failed", detail: unsaved };
    change = await runRegistrar(host, argv as string[], op, spawnEnv);
  }
  const applied = "outcome" in change ? change : verify(host, op, server, change, await read());
  return backup ? { ...applied, backup } : applied;
}

interface Changed {
  benign: boolean;
  action: string;
}

async function runRegistrar(
  host: DetectedHost,
  argv: string[],
  op: HostOp,
  spawnEnv: NodeJS.ProcessEnv,
): Promise<Changed | Applied> {
  const run = await runHost(host.binary as string, argv.slice(1), spawnEnv, HOST_COMMAND_TIMEOUT_MS);
  const output = `${run.stderr}\n${run.stdout}`;
  const benign = (op === "add" ? ALREADY_EXISTS : NOT_FOUND).test(output);
  if (run.code !== 0 && !benign) {
    return {
      outcome: "failed",
      detail: `${firstLine(output) || "no output"} (exit ${run.code ?? "timeout or signal"})`,
    };
  }
  return { benign, action: `\`${argv.join(" ")}\`` };
}

// Ownership is checked again on the exact content being rewritten, and the backup is taken only once the file passed every check.
function writeRegistrar(
  file: string,
  edit: JsonEdit,
  op: HostOp,
  server: string,
  backUp: () => string | undefined,
): Changed | Applied {
  try {
    writeJsonKey(file, edit.keyPath, edit.value, (current) => {
      if (op === "add" && current !== undefined) return "an ask-llm entry appeared; not overwritten";
      if (op === "remove" && !isOwnCommand(entryCommand(current), server))
        return "the ask-llm entry no longer runs this ask-llm-mcp; left in place";
      return backUp();
    });
  } catch (error) {
    return { outcome: "failed", detail: firstLine(error instanceof Error ? error.message : String(error)) };
  }
  return { benign: false, action: `writing ${file}` };
}

function verify(
  host: DetectedHost,
  op: HostOp,
  server: string,
  { benign, action }: Changed,
  after: RegistrationState,
): Applied {
  if (after.registered === null) return { outcome: "failed", detail: after.error };
  if (op === "remove") {
    if (after.registered || after.present)
      return { outcome: "failed", detail: `ask-llm is still registered after ${action}` };
    return { outcome: benign ? "unchanged" : "changed" };
  }
  if (isOwnRegistration({ ...host, ...after, command: after.command }, server)) {
    return { outcome: benign ? "unchanged" : "changed" };
  }
  if (after.registered) return conflict(after.command);
  return { outcome: "failed", detail: `the ask-llm entry was not found after ${action}` };
}
