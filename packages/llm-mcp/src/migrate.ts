import { type Applied, backupConfig, firstLine, HOST_COMMAND_TIMEOUT_MS, hostEnv, NOT_FOUND } from "./hosts/apply.js";
import {
  customSettings,
  type DetectedHost,
  entryCommand,
  listServers,
  namedSource,
  type RegistrationState,
  readRegistration,
  type ServerEntry,
} from "./hosts/detect.js";
import { writeJsonKey } from "./hosts/json-merge.js";
import { legacyPackage, mentionedPackage } from "./hosts/legacy.js";
import { type HostId, SERVER_NAME } from "./hosts/registry.js";
import { runHost } from "./hosts/spawn.js";
import { commandText, isOwnRegistration } from "./plan.js";
import type { Confirm, HostResult, HostStatus } from "./setup.js";

// The page every deprecation message and every migration step points to.
export const MIGRATION_GUIDE = "https://lykhoyda.github.io/ask-llm/reference/migration.html";

export type MigrationAction = "retire" | "guidance";

// An earlier Ask LLM entry beside the host's `ask-llm` registration: a split provider server, a second
// unified server under another name, or Pi's `@ask-llm/plugin` package.
export interface MigrationFinding {
  id: HostId;
  name: string;
  label: string;
  entry: string;
  package: string;
  action: MigrationAction;
  command?: string[];
  reason: string;
  change: string;
}

function sameCommand(left: string[] | undefined, right: string[] | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((arg, i) => arg === right[i])
  );
}

function removeText(host: DetectedHost, name: string): string {
  const { registration } = host.spec;
  const source = namedSource(host.spec.registrationState, name);
  if (registration.kind === "json" && source.kind === "json")
    return `remove ${source.keyPath.join(".")} in ${source.file}`;
  const argv = registration.kind === "command" ? registration.remove?.(name) : undefined;
  return argv ? commandText(argv) : `remove the ${name} entry with ${host.name}'s own settings`;
}

function finding(host: DetectedHost, entry: ServerEntry): MigrationFinding | undefined {
  const exact = legacyPackage(entry.command);
  const pkg = exact ?? mentionedPackage(entry.command ? commandText(entry.command) : entry.text);
  if (!pkg) return undefined;
  const base = {
    id: host.id,
    name: host.name,
    label: `${host.name} entry ${entry.name}`,
    entry: entry.name,
    package: pkg,
  };
  const remove = removeText(host, entry.name);
  const current = entry.command ? `\`${commandText(entry.command)}\`` : pkg;
  if (exact && entry.command && !entry.custom && !entry.error) {
    return {
      ...base,
      action: "retire",
      command: entry.command,
      reason: `runs ${current}; Ask LLM now covers it`,
      change: remove,
    };
  }
  const why = entry.custom
    ? `with its own settings (${entry.custom})`
    : `in a form setup cannot classify (${entry.error ?? (entry.command ? "custom command options" : "no usable command")})`;
  return {
    ...base,
    action: "guidance",
    command: entry.command,
    reason: `runs ${current} ${why}; setup leaves it in place`,
    change: entry.error
      ? `inspect ${host.spec.configFile} and project overrides; preserve custom settings and verify the user-scope entry before manually using: ${remove}`
      : `carry over any settings you still need, then: ${remove}`,
  };
}

export async function planMigration(
  hosts: DetectedHost[],
  selected: HostId[] | undefined,
  env: NodeJS.ProcessEnv,
): Promise<MigrationFinding[]> {
  const findings: MigrationFinding[] = [];
  for (const host of hosts) {
    if (!host.installed || (selected && !selected.includes(host.id))) continue;
    for (const source of host.legacy ?? []) {
      findings.push({
        id: host.id,
        name: host.name,
        label: `${host.name} package ${source}`,
        entry: source,
        package: "@ask-llm/plugin",
        action: host.custom ? "guidance" : "retire",
        reason: host.custom
          ? `Ask LLM packages have their own settings (${host.custom}); setup leaves them in place`
          : "the earlier package that @ask-llm/mcp replaces",
        change: host.custom
          ? `preserve package filters and custom settings in ${host.spec.configFile}; follow ${MIGRATION_GUIDE}`
          : commandText(["pi", "remove", source]),
      });
    }
    if (host.spec.registrationState.kind === "packages") continue;
    if (host.registered === null && (host.spec.registrationState.kind !== "list" || !host.supported)) continue;
    let entries: ServerEntry[];
    try {
      entries = await listServers(host.spec.registrationState, host.binary, hostEnv(host, env));
    } catch {
      // The same unreadable surface already makes the host's plan entry manual.
      continue;
    }
    for (const entry of entries) {
      if (entry.name === SERVER_NAME) continue;
      const found = finding(host, entry);
      if (found) findings.push(found);
    }
  }
  return findings;
}

function fileState(current: unknown): RegistrationState {
  const command = entryCommand(current);
  if (!command) return current === undefined ? { registered: false } : { registered: false, present: true };
  const custom = customSettings(current);
  return custom ? { registered: true, command, custom } : { registered: true, command };
}

const failed = (detail: string | undefined, backup?: string): Applied => ({ outcome: "failed", detail, backup });

function takeBackup(host: DetectedHost): { backup?: string; error?: string } {
  try {
    return { backup: backupConfig(host.spec.configFile) };
  } catch (error) {
    return { error: `cannot back up ${host.spec.configFile}: ${firstLine((error as Error).message)}` };
  }
}

async function run(host: DetectedHost, argv: string[], env: NodeJS.ProcessEnv) {
  const result = await runHost(host.binary as string, argv.slice(1), env, HOST_COMMAND_TIMEOUT_MS);
  const output = `${result.stderr}\n${result.stdout}`;
  return {
    ...result,
    output,
    summary: `${firstLine(output) || "no output"} (exit ${result.code ?? "timeout or signal"})`,
  };
}

// Replaces the host's earlier `ask-llm` entry (the one the plan saw) with this install. Only that entry
// changes: a failed swap on a host that refuses to overwrite puts the earlier entry back through the host's
// own add command, so edits made to the rest of the file meanwhile stay.
export async function replaceRegistration(
  host: DetectedHost,
  server: string,
  env: NodeJS.ProcessEnv,
): Promise<Applied> {
  const spawnEnv = hostEnv(host, env);
  const read = () => readRegistration(host.spec.registrationState, host.binary, spawnEnv);
  const earlier = host.command;
  const unchanged = (current: RegistrationState) =>
    current.registered === true && sameCommand(current.command, earlier) && !current.custom;
  const own = (current: RegistrationState) =>
    isOwnRegistration({ ...host, ...current, command: current.command }, server);
  const before = await read();
  if (before.registered === null) return failed(before.error);
  if (!unchanged(before))
    return { outcome: "conflict", detail: "the ask-llm entry changed since the preview; not replaced" };

  const { registration } = host.spec;
  if (registration.kind === "json") {
    let backup: string | undefined;
    const { keyPath, value } = registration.edit("add", server);
    try {
      writeJsonKey(registration.file, keyPath, value, (current) => {
        if (!unchanged(fileState(current))) return "the ask-llm entry changed since the preview; not replaced";
        const taken = takeBackup(host);
        backup = taken.backup;
        return taken.error;
      });
    } catch (error) {
      return failed(firstLine((error as Error).message), backup);
    }
    const after = await read();
    return own(after)
      ? { outcome: "changed", backup }
      : failed(after.error ?? "the new ask-llm entry was not found after the write", backup);
  }

  const remove = registration.remove?.(SERVER_NAME);
  if (!host.binary || (registration.refusesExisting && !remove))
    return failed(`${host.name} has no command to replace the entry`);
  const { backup, error } = takeBackup(host);
  if (error) return failed(error);
  if (registration.refusesExisting && remove) {
    const removed = await run(host, remove, spawnEnv);
    const gone = await read();
    if ((removed.code !== 0 && !NOT_FOUND.test(removed.output)) || gone.registered !== false || gone.present)
      return failed(
        `${removed.code === 0 ? "the earlier entry is still listed" : removed.summary}; nothing was replaced`,
        backup,
      );
  }
  const added = await run(host, registration.argv(server), spawnEnv);
  const after = await read();
  if (added.code === 0 && own(after)) return { outcome: "changed", backup };
  const problem = added.code === 0 ? "the ask-llm entry did not run this ask-llm-mcp afterwards" : added.summary;
  if (unchanged(after)) return failed(`${problem}; the earlier entry is unchanged`, backup);
  if (registration.refusesExisting && earlier && after.registered === false && !after.present) {
    await run(host, [...registration.argv(earlier[0]), ...earlier.slice(1)], spawnEnv);
    if (unchanged(await read())) return failed(`${problem}; the earlier entry restored`, backup);
  }
  return failed(`${problem}; the earlier entry could not be restored${backup ? `, the backup has it` : ""}`, backup);
}

async function retire(
  host: DetectedHost,
  found: MigrationFinding,
  server: string,
  env: NodeJS.ProcessEnv,
): Promise<Applied> {
  const spawnEnv = hostEnv(host, env);
  const source = namedSource(host.spec.registrationState, found.entry);
  const read = () => readRegistration(source, host.binary, spawnEnv);
  const packages = source.kind === "packages";
  const listed = (current: RegistrationState) =>
    packages ? (current.legacy ?? []).includes(found.entry) : current.registered === true || current.present === true;
  const unchanged = (current: RegistrationState) =>
    packages
      ? listed(current) && !current.custom
      : current.registered === true && sameCommand(current.command, found.command) && !current.custom;

  const before = await read();
  if (before.registered === null) return failed(before.error);
  if (!listed(before)) return { outcome: "unchanged" };
  if (!unchanged(before)) return { outcome: "conflict", detail: "the entry changed since the preview; left in place" };

  const canonical = await readRegistration(host.spec.registrationState, host.binary, spawnEnv);
  if (
    canonical.registered !== true ||
    canonical.custom ||
    !isOwnRegistration({ ...host, ...canonical, command: canonical.command, custom: canonical.custom }, server)
  )
    return {
      outcome: "conflict",
      detail: "Ask LLM is no longer registered without custom settings to this install; earlier entry left in place",
    };

  const { registration } = host.spec;
  let backup: string | undefined;
  if (registration.kind === "json" && source.kind === "json") {
    try {
      writeJsonKey(source.file, source.keyPath, undefined, (current) => {
        if (!unchanged(fileState(current))) return "the entry changed since the preview; left in place";
        const taken = takeBackup(host);
        backup = taken.backup;
        return taken.error;
      });
    } catch (error) {
      return failed(firstLine((error as Error).message), backup);
    }
  } else {
    const argv = packages
      ? ["pi", "remove", found.entry]
      : registration.kind === "command"
        ? registration.remove?.(found.entry)
        : undefined;
    if (!argv || !host.binary) return failed(`${host.name} has no command to remove the entry`);
    const taken = takeBackup(host);
    if (taken.error) return failed(taken.error);
    backup = taken.backup;
    const removed = await run(host, argv, spawnEnv);
    if (removed.code !== 0 && !NOT_FOUND.test(removed.output)) return failed(removed.summary, backup);
  }
  const after = await read();
  if (after.registered === null) return failed(after.error, backup);
  return listed(after)
    ? failed(`${found.entry} is still listed after the change`, backup)
    : { outcome: "changed", backup };
}

// Statuses after which the host runs this install, so an earlier entry beside it is safe to retire.
const READY: ReadonlySet<HostStatus> = new Set(["registered", "replaced", "up-to-date"]);

export async function applyMigration(
  findings: MigrationFinding[],
  hosts: DetectedHost[],
  server: string,
  registrations: HostResult[],
  confirm: Confirm,
  env: NodeJS.ProcessEnv,
): Promise<HostResult[]> {
  const results: HostResult[] = [];
  for (const found of findings) {
    const host = hosts.find(({ id }) => id === found.id) as DetectedHost;
    const result = (status: HostStatus, extra: Partial<HostResult> = {}) =>
      results.push({ id: found.id, name: found.label, status, ...extra });
    if (found.action === "guidance") {
      result("manual", { detail: found.reason, manual: found.change });
      continue;
    }
    const registration = registrations.find(({ id }) => id === found.id);
    if (!registration || !READY.has(registration.status)) {
      result("kept", { detail: `Ask LLM is not registered in ${host.name} yet, so this entry stays` });
      continue;
    }
    const verb = host.spec.registration.kind === "json" ? "Writes" : "Runs";
    if (
      !(await confirm(
        `Remove the earlier ${found.package} from ${host.name} (${found.entry})? ${verb}: ${found.change}`,
      ))
    ) {
      result("declined");
      continue;
    }
    const applied = await retire(host, found, server, env);
    const status: HostStatus =
      applied.outcome === "changed" || applied.outcome === "unchanged" ? "retired" : applied.outcome;
    results.push({
      id: found.id,
      name: found.label,
      status,
      detail: applied.outcome === "unchanged" ? "already gone" : applied.detail,
      backup: applied.backup,
      manual: status === "failed" ? found.change : undefined,
    });
  }
  return results;
}
