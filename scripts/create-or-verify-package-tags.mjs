#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function commandResult(command, args, { cwd, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

function defaultGit(args, options = {}) {
  return commandResult("git", args, options);
}

function defaultNpm(args, options = {}) {
  return commandResult("npm", args, options);
}

function parseJson(source, description) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${description}: ${error.message}`);
  }
}

export function discoverPublicPackages(root) {
  const packagesDirectory = join(root, "packages");
  const packages = [];

  for (const directory of readdirSync(packagesDirectory, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const manifestPath = join(packagesDirectory, directory.name, "package.json");
    let manifest;
    try {
      manifest = parseJson(readFileSync(manifestPath, "utf8"), relative(root, manifestPath));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (manifest.private === true || !manifest.name?.startsWith("@ask-llm/")) continue;
    if (manifest.publishConfig?.access !== "public") {
      throw new Error(`${manifest.name} is non-private but does not declare publishConfig.access=public`);
    }
    if (typeof manifest.version !== "string" || manifest.version.length === 0) {
      throw new Error(`${manifest.name} has no package version`);
    }
    packages.push({
      name: manifest.name,
      version: manifest.version,
      manifestPath: relative(root, manifestPath).replaceAll("\\", "/"),
    });
  }

  if (packages.length === 0) throw new Error("No public @ask-llm/* packages found");
  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

function versionAtCommit(commit, manifestPath, { cwd, git }) {
  const result = git(["show", `${commit}:${manifestPath}`], { cwd, allowFailure: true });
  if (result.status !== 0) return null;
  return parseJson(result.stdout, `${manifestPath} at ${commit}`).version ?? null;
}

export function findVersionIntroducingCommit(packageInfo, { cwd, git = defaultGit } = {}) {
  const history = git(["log", "--first-parent", "--format=%H", "HEAD", "--", packageInfo.manifestPath], {
    cwd,
  })
    .stdout.trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const candidates = [];

  for (const commit of history) {
    if (!COMMIT_PATTERN.test(commit)) throw new Error(`Unexpected commit in first-parent history: ${commit}`);
    if (versionAtCommit(commit, packageInfo.manifestPath, { cwd, git }) !== packageInfo.version) continue;
    const parent = git(["rev-parse", "--verify", `${commit}^1`], { cwd, allowFailure: true });
    const parentVersion =
      parent.status === 0 ? versionAtCommit(parent.stdout.trim(), packageInfo.manifestPath, { cwd, git }) : null;
    if (parentVersion !== packageInfo.version) candidates.push(commit);
  }

  const identity = `${packageInfo.name}@${packageInfo.version}`;
  if (candidates.length === 0) {
    throw new Error(`No first-parent commit introduces ${identity} in ${packageInfo.manifestPath}`);
  }
  if (candidates.length > 1) {
    throw new Error(`Ambiguous first-parent history for ${identity}: ${candidates.join(", ")}`);
  }
  return candidates[0];
}

export class NpmGitHeadMismatchError extends Error {
  constructor(identity, expected, found) {
    super(`npm gitHead mismatch for ${identity}: expected ${expected}, found ${found}`);
    this.name = "NpmGitHeadMismatchError";
    this.code = "NPM_GITHEAD_MISMATCH";
    this.identity = identity;
    this.expected = expected;
    this.found = found;
  }
}

export function verifyNpmGitHead(packageInfo, target, { cwd, npm = defaultNpm } = {}) {
  const identity = `${packageInfo.name}@${packageInfo.version}`;
  const result = npm(["view", identity, "gitHead", "--json"], { cwd });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`npm view ${identity} gitHead failed${detail ? `: ${detail}` : ""}`);
  }
  const gitHead = parseJson(result.stdout, `npm gitHead for ${identity}`);
  if (!COMMIT_PATTERN.test(gitHead)) throw new Error(`npm ${identity} has no valid gitHead`);
  if (gitHead !== target) throw new NpmGitHeadMismatchError(identity, target, gitHead);
}

export function lookupRemoteTag(tagRef, { cwd, remote, git = defaultGit } = {}) {
  const result = git(["ls-remote", remote, tagRef, `${tagRef}^{}`], { cwd });
  const refs = new Map();
  for (const line of result.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const [hash, ref] = line.split(/\s+/, 2);
    if (!COMMIT_PATTERN.test(hash) || !ref) throw new Error(`Malformed ls-remote result for ${tagRef}: ${line}`);
    if (refs.has(ref) && refs.get(ref) !== hash) throw new Error(`Conflicting remote values for ${ref}`);
    refs.set(ref, hash);
  }
  const peeled = refs.get(`${tagRef}^{}`);
  const direct = refs.get(tagRef);
  if (peeled) return peeled;
  return direct ?? null;
}

export function pushMissingTag(plan, { cwd, remote, git = defaultGit, lookup = lookupRemoteTag, log = console } = {}) {
  const result = git(["push", remote, `${plan.target}:${plan.tagRef}`], { cwd, allowFailure: true });
  if (result.status === 0) {
    log.log(`CREATED ${plan.tag} at ${plan.target}`);
    return "created";
  }

  // Another release/recovery job may have won after our ls-remote. Accept only
  // the exact target; a different winner remains a hard, non-retaggable error.
  const racedTarget = lookup(plan.tagRef, { cwd, remote, git });
  if (racedTarget === plan.target) {
    log.log(`VERIFIED concurrently-created ${plan.tag} at ${plan.target}`);
    return "raced";
  }
  const detail = (result.stderr || result.stdout).trim();
  throw new Error(
    `Failed to create ${plan.tag}${racedTarget ? `; remote now targets ${racedTarget}` : ""}${detail ? `: ${detail}` : ""}`,
  );
}

export function createOrVerifyPackageTags(
  { cwd = process.cwd(), remote = "origin", dryRun = false, verifyNpm = false } = {},
  { git = defaultGit, npm = defaultNpm, log = console } = {},
) {
  const root = resolve(cwd);
  const packages = discoverPublicPackages(root);
  const plans = [];
  const inconsistent = [];
  for (const packageInfo of packages) {
    const target = findVersionIntroducingCommit(packageInfo, { cwd: root, git });
    const tag = `${packageInfo.name}@${packageInfo.version}`;
    if (verifyNpm) {
      try {
        verifyNpmGitHead(packageInfo, target, { cwd: root, npm });
      } catch (error) {
        if (!(error instanceof NpmGitHeadMismatchError)) throw error;
        log.error(`INCONSISTENT ${tag}: ${error.message}`);
        inconsistent.push({ ...packageInfo, tag, target, reason: error.message });
        continue;
      }
    }
    plans.push({ ...packageInfo, tag, tagRef: `refs/tags/${tag}`, target });
  }

  // Verify every remote ref before creating any missing refs. A mismatch in one
  // package therefore cannot turn a recovery into a new partial completion.
  for (const plan of plans) {
    plan.remoteTarget = lookupRemoteTag(plan.tagRef, { cwd: root, remote, git });
    if (plan.remoteTarget && plan.remoteTarget !== plan.target) {
      const message = `MISMATCH ${plan.tag}: expected ${plan.target}, found ${plan.remoteTarget}`;
      log.error(message);
      throw new Error(`Remote tag mismatch for ${plan.tag}: expected ${plan.target}, found ${plan.remoteTarget}`);
    }
  }

  const missing = plans.filter((plan) => plan.remoteTarget === null);
  for (const plan of plans.filter((candidate) => candidate.remoteTarget !== null)) {
    log.log(`VERIFIED ${plan.tag} at ${plan.target}`);
  }
  if (dryRun) {
    for (const plan of missing) log.log(`MISSING ${plan.tag} at ${plan.target} (dry-run; would create)`);
  } else {
    for (const plan of missing) pushMissingTag(plan, { cwd: root, remote, git, log });
  }

  log.log(
    `${dryRun ? "Dry-run verified" : "Verified"} ${plans.length} public package tags (${missing.length} ${dryRun ? "missing" : "created or raced"}).`,
  );
  if (inconsistent.length > 0) {
    throw new Error(
      `npm gitHead cross-check failed for ${inconsistent.map((entry) => entry.tag).join(", ")}; no tag was created for these packages. npm gitHead is immutable, so recover by publishing a new version of each affected package.`,
    );
  }
  return { plans, missing, inconsistent, dryRun };
}

export function parseArguments(argv) {
  const options = { remote: "origin", dryRun: false, verifyNpm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--verify-npm-git-head") options.verifyNpm = true;
    else if (argument === "--remote") {
      options.remote = argv[index + 1];
      index += 1;
      if (!options.remote) throw new Error("--remote requires a value");
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    createOrVerifyPackageTags(parseArguments(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
