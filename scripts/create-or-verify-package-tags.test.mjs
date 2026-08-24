import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  createOrVerifyPackageTags,
  findVersionIntroducingCommit,
  lookupRemoteTag,
  pushMissingTag,
  verifyNpmGitHead,
} from "./create-or-verify-package-tags.mjs";

// Each test builds real git repositories via many subprocess calls; on Windows CI
// runners the slowest tests approach or exceed vitest's 5s default timeout.
vi.setConfig({ testTimeout: 60_000 });

const scratchDirectories = [];

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function manifest(name, version, extra = {}) {
  return `${JSON.stringify(
    {
      name,
      version,
      publishConfig: { access: "public" },
      ...extra,
    },
    null,
    2,
  )}\n`;
}

function writePackage(root, directory, name, version, extra) {
  const packageDirectory = join(root, "packages", directory);
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, "package.json"), manifest(name, version, extra));
}

function commitAll(root, message) {
  git(root, "add", ".");
  git(root, "commit", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "ask-llm-package-tags-"));
  scratchDirectories.push(directory);
  const root = join(directory, "work");
  const remote = join(directory, "remote.git");
  mkdirSync(root);
  git(directory, "init", "--bare", remote);
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.name", "Package Tag Test");
  git(root, "config", "user.email", "package-tags@example.test");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "tag.gpgSign", "false");

  writePackage(root, "one", "@ask-llm/one", "0.9.0");
  writePackage(root, "two", "@ask-llm/two", "0.8.0");
  writePackage(root, "shared", "@ask-llm/shared", "0.5.0", { private: true, publishConfig: undefined });
  const previous = commitAll(root, "initial versions");
  writePackage(root, "one", "@ask-llm/one", "1.0.0");
  writePackage(root, "two", "@ask-llm/two", "2.0.0");
  const release = commitAll(root, "version packages");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "origin", "HEAD:refs/heads/main");
  return { root, remote, previous, release };
}

function remoteTarget(root, remote, tag) {
  return lookupRemoteTag(`refs/tags/${tag}`, { cwd: root, remote });
}

function silentLog() {
  const lines = [];
  return {
    lines,
    logger: { log: (line) => lines.push(line), error: (line) => lines.push(line) },
  };
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

test("creates missing remote package tags at the version-introducing first-parent commit and excludes shared", () => {
  const { root, remote, release } = fixture();
  const { plans } = createOrVerifyPackageTags({ cwd: root, remote }, { log: silentLog().logger });

  assert.deepEqual(
    plans.map((plan) => plan.tag),
    ["@ask-llm/one@1.0.0", "@ask-llm/two@2.0.0"],
  );
  for (const plan of plans) assert.equal(remoteTarget(root, remote, plan.tag), release);
  assert.equal(remoteTarget(root, remote, "@ask-llm/shared@0.5.0"), null);
});

test("matching lightweight and annotated remote tags are verified without replacement", () => {
  const { root, remote, release } = fixture();
  git(root, "tag", "@ask-llm/one@1.0.0", release);
  git(root, "tag", "-a", "@ask-llm/two@2.0.0", "-m", "annotated package tag", release);
  git(
    root,
    "push",
    remote,
    "refs/tags/@ask-llm/one@1.0.0:refs/tags/@ask-llm/one@1.0.0",
    "refs/tags/@ask-llm/two@2.0.0:refs/tags/@ask-llm/two@2.0.0",
  );
  const before = git(root, "ls-remote", remote, "refs/tags/@ask-llm/*");

  const { missing } = createOrVerifyPackageTags({ cwd: root, remote }, { log: silentLog().logger });

  assert.equal(missing.length, 0);
  assert.equal(git(root, "ls-remote", remote, "refs/tags/@ask-llm/*"), before);
});

test("a mismatched remote tag fails before any missing tag is pushed", () => {
  const { root, remote, previous } = fixture();
  git(root, "push", remote, `${previous}:refs/tags/@ask-llm/one@1.0.0`);

  assert.throws(
    () => createOrVerifyPackageTags({ cwd: root, remote }, { log: silentLog().logger }),
    /Remote tag mismatch.*expected.*found/,
  );
  assert.equal(remoteTarget(root, remote, "@ask-llm/two@2.0.0"), null);
  assert.equal(remoteTarget(root, remote, "@ask-llm/one@1.0.0"), previous);
});

test("dry-run reports every mismatched remote tag before one failure and never retags", () => {
  const { root, remote, previous } = fixture();
  git(root, "push", remote, `${previous}:refs/tags/@ask-llm/one@1.0.0`);
  git(root, "push", remote, `${previous}:refs/tags/@ask-llm/two@2.0.0`);
  const { logger, lines } = silentLog();

  assert.throws(
    () => createOrVerifyPackageTags({ cwd: root, remote, dryRun: true }, { log: logger }),
    (error) => error.message.includes("@ask-llm/one@1.0.0") && error.message.includes("@ask-llm/two@2.0.0"),
  );
  assert.equal(lines.filter((line) => line.startsWith("MISMATCH ")).length, 2);
  assert.equal(remoteTarget(root, remote, "@ask-llm/one@1.0.0"), previous);
  assert.equal(remoteTarget(root, remote, "@ask-llm/two@2.0.0"), previous);
});

test("partial completion verifies an existing tag and creates only the missing tag", () => {
  const { root, remote, release } = fixture();
  git(root, "push", remote, `${release}:refs/tags/@ask-llm/one@1.0.0`);

  const { missing } = createOrVerifyPackageTags({ cwd: root, remote }, { log: silentLog().logger });

  assert.deepEqual(
    missing.map((plan) => plan.tag),
    ["@ask-llm/two@2.0.0"],
  );
  assert.equal(remoteTarget(root, remote, "@ask-llm/one@1.0.0"), release);
  assert.equal(remoteTarget(root, remote, "@ask-llm/two@2.0.0"), release);
});

test("a duplicate push race is accepted only when the remote winner has the expected target", () => {
  const target = "a".repeat(40);
  const plan = { tag: "@ask-llm/one@1.0.0", tagRef: "refs/tags/@ask-llm/one@1.0.0", target };
  const calls = [];
  const fakeGit = (args) => {
    calls.push(args);
    return { status: 1, stdout: "", stderr: "rejected: reference already exists" };
  };
  const { logger, lines } = silentLog();

  assert.equal(pushMissingTag(plan, { remote: "origin", git: fakeGit, lookup: () => target, log: logger }), "raced");
  assert.deepEqual(calls, [["push", "origin", `${target}:${plan.tagRef}`]]);
  assert.match(lines[0], /concurrently-created/);
  assert.throws(
    () => pushMissingTag(plan, { remote: "origin", git: fakeGit, lookup: () => "b".repeat(40), log: logger }),
    /remote now targets/,
  );
});

test("npm gitHead cross-check detects a wrong release commit", () => {
  const packageInfo = { name: "@ask-llm/one", version: "1.0.0" };
  const target = "a".repeat(40);
  const npm = () => ({ status: 0, stdout: `"${"b".repeat(40)}"\n`, stderr: "" });

  assert.throws(() => verifyNpmGitHead(packageInfo, target, { npm }), /npm gitHead mismatch/);
});

test("an npm gitHead mismatch skips only the affected package, still tags consistent packages, and fails the run", () => {
  const { root, remote, release } = fixture();
  const { logger, lines } = silentLog();
  const npm = (args) => ({
    status: 0,
    stdout: `"${args[1] === "@ask-llm/two@2.0.0" ? "b".repeat(40) : release}"\n`,
    stderr: "",
  });

  assert.throws(
    () => createOrVerifyPackageTags({ cwd: root, remote, verifyNpm: true }, { npm, log: logger }),
    /npm gitHead cross-check failed for @ask-llm\/two@2\.0\.0.*publishing a new version/,
  );
  assert.equal(remoteTarget(root, remote, "@ask-llm/one@1.0.0"), release);
  assert.equal(remoteTarget(root, remote, "@ask-llm/two@2.0.0"), null);
  assert.match(
    lines.find((line) => line.startsWith("INCONSISTENT ")),
    /@ask-llm\/two@2\.0\.0.*npm gitHead mismatch/,
  );
});

test("a failing npm view is not treated as a gitHead mismatch and creates no tags", () => {
  const { root, remote, release } = fixture();
  const { logger, lines } = silentLog();
  const npm = (args) =>
    args[1] === "@ask-llm/two@2.0.0"
      ? { status: 1, stdout: "", stderr: "npm ERR! 503 Service Unavailable" }
      : { status: 0, stdout: `"${release}"\n`, stderr: "" };

  assert.throws(
    () => createOrVerifyPackageTags({ cwd: root, remote, verifyNpm: true }, { npm, log: logger }),
    (error) =>
      /npm view @ask-llm\/two@2\.0\.0 gitHead failed.*503/.test(error.message) &&
      !/publishing a new version/.test(error.message),
  );
  assert.equal(remoteTarget(root, remote, "@ask-llm/one@1.0.0"), null);
  assert.equal(remoteTarget(root, remote, "@ask-llm/two@2.0.0"), null);
  assert.equal(
    lines.some((line) => line.startsWith("INCONSISTENT ")),
    false,
  );
});

test("dry-run reports missing tags without mutating the remote", () => {
  const { root, remote } = fixture();
  const { logger, lines } = silentLog();

  const { missing, dryRun } = createOrVerifyPackageTags({ cwd: root, remote, dryRun: true }, { log: logger });

  assert.equal(dryRun, true);
  assert.equal(missing.length, 2);
  assert.equal(remoteTarget(root, remote, "@ask-llm/one@1.0.0"), null);
  assert.equal(remoteTarget(root, remote, "@ask-llm/two@2.0.0"), null);
  assert.equal(lines.filter((line) => line.startsWith("MISSING ")).length, 2);
});

test("fails when the manifest version is absent from first-parent history", () => {
  const { root } = fixture();
  writePackage(root, "one", "@ask-llm/one", "9.9.9");
  const packageInfo = {
    name: "@ask-llm/one",
    version: "9.9.9",
    manifestPath: "packages/one/package.json",
  };

  assert.throws(() => findVersionIntroducingCommit(packageInfo, { cwd: root }), /No first-parent commit introduces/);
});

test("fails when a version was introduced more than once on first-parent history", () => {
  const { root } = fixture();
  writePackage(root, "one", "@ask-llm/one", "1.1.0");
  commitAll(root, "move version forward");
  writePackage(root, "one", "@ask-llm/one", "1.0.0");
  commitAll(root, "reintroduce old version");
  const packageInfo = {
    name: "@ask-llm/one",
    version: "1.0.0",
    manifestPath: "packages/one/package.json",
  };

  assert.throws(() => findVersionIntroducingCommit(packageInfo, { cwd: root }), /Ambiguous first-parent history/);
});

test("workflow structurally runs package tags after the unified release for publication and recovery", () => {
  const workflow = parseYaml(readFileSync(join(import.meta.dirname, "../.github/workflows/release.yml"), "utf8"));
  const steps = workflow.jobs.release.steps;
  const tagSteps = steps.filter((step) => step.name === "Create or verify per-package Git tags");
  const unifiedSteps = steps.filter((step) => step.name === "Create or verify unified GitHub Release");
  const failureStep = steps.find((step) => step.name === "Open tracking issue on release failure");
  const changesetsStep = steps.find((step) => step.name === "Create Release PR or Publish");
  const expectedGate =
    "steps.changesets.outputs.published == 'true' || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.retry_registry_publish)";

  assert.equal(tagSteps.length, 1);
  assert.equal(unifiedSteps.length, 1);
  assert.equal(tagSteps[0].run, "node scripts/create-or-verify-package-tags.mjs --verify-npm-git-head");
  assert.equal(tagSteps[0].if, expectedGate);
  assert.equal(unifiedSteps[0].if, expectedGate);
  assert.equal(changesetsStep.with["create-github-releases"], false);
  assert.equal(changesetsStep.with["push-git-tags"], false);
  assert.ok(steps.indexOf(unifiedSteps[0]) < steps.indexOf(tagSteps[0]));
  assert.ok(steps.indexOf(tagSteps[0]) < steps.indexOf(failureStep));
});
