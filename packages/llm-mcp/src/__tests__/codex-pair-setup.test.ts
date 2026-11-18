import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_ROOT } from "./_helpers.js";

const TEMPLATE = "---\nblockOn: HIGH\nreasoningEffort: xhigh\n---\n# Shared review context\n";
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  // git prints real paths; macOS tmpdir is a symlink.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pair-setup-")));
  dirs.push(dir);
  mkdirSync(join(dir, "home"));
  return dir;
}

// Isolate from the developer's global and XDG git ignore rules, which could already ignore .codex-pair/.
function gitEnv(base: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: join(base, "home"),
    XDG_CONFIG_HOME: join(base, "home"),
    GIT_CONFIG_GLOBAL: join(base, "home", "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
}

function git(base: string, cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: gitEnv(base) }).trim();
}

function repo(base: string, { template = true, gitignore }: { template?: boolean; gitignore?: string } = {}) {
  const root = join(base, "repo");
  mkdirSync(join(root, "src"), { recursive: true });
  git(base, base, "init", "-q", root);
  writeFileSync(join(root, "src", "index.ts"), "export {};\n");
  if (template) {
    mkdirSync(join(root, ".codex-pair.example"));
    writeFileSync(join(root, ".codex-pair.example", "context.md"), TEMPLATE);
  }
  if (gitignore !== undefined) writeFileSync(join(root, ".gitignore"), gitignore);
  git(base, root, "add", "-A");
  git(base, root, "commit", "-q", "-m", "init");
  return root;
}

function setup(base: string, cwd: string) {
  return spawnSync(process.execPath, [join(PLUGIN_ROOT, "scripts", "codex-pair-log.mjs"), "setup"], {
    cwd,
    encoding: "utf8",
    env: gitEnv(base),
    timeout: 10_000,
  });
}

const excludeFile = (base: string, root: string) =>
  resolve(root, git(base, root, "rev-parse", "--git-path", "info/exclude"));
const excludeLines = (base: string, root: string) => readFileSync(excludeFile(base, root), "utf8").split("\n");
const marker = (root: string) => join(root, ".codex-pair", "context.md");

describe("codex-pair-log setup", () => {
  it("copies the committed template in a normal clone, asks nothing and leaves git status clean", () => {
    const base = scratch();
    const root = repo(base, { gitignore: "dist/\n" });
    const result = setup(base, join(root, "src"));
    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")[0]).toMatch(/^created: /);
    expect(readFileSync(marker(root), "utf8")).toBe(TEMPLATE);
    expect(excludeLines(base, root)).toContain(".codex-pair/");
    expect(result.stdout).toContain(excludeFile(base, root));
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("dist/\n");
    expect(git(base, root, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it("resolves the exclude file through git in a fresh linked worktree whose .git is a file", () => {
    const base = scratch();
    const root = repo(base);
    const worktree = join(base, "worktree");
    git(base, root, "worktree", "add", "-q", worktree);
    expect(lstatSync(join(worktree, ".git")).isFile()).toBe(true);
    const result = setup(base, worktree);
    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")[0]).toMatch(/^created: /);
    expect(readFileSync(marker(worktree), "utf8")).toBe(TEMPLATE);
    const exclude = excludeFile(base, worktree);
    expect(exclude.startsWith(join(root, ".git"))).toBe(true);
    expect(excludeLines(base, worktree)).toContain(".codex-pair/");
    expect(existsSync(join(worktree, ".gitignore"))).toBe(false);
    expect(git(base, worktree, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it("never overwrites an existing marker and does not duplicate the exclude entry", () => {
    const base = scratch();
    const root = repo(base);
    mkdirSync(join(root, ".codex-pair"));
    writeFileSync(marker(root), "# my own context\n");
    const first = setup(base, root);
    expect(first.status).toBe(0);
    expect(first.stdout.split("\n")[0]).toMatch(/^exists: /);
    expect(readFileSync(marker(root), "utf8")).toBe("# my own context\n");
    const second = setup(base, root);
    expect(second.stdout).toContain("already ignored by git");
    expect(readFileSync(marker(root), "utf8")).toBe("# my own context\n");
    expect(excludeLines(base, root).filter((line) => line === ".codex-pair/")).toHaveLength(1);
    expect(git(base, root, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it("leaves the interactive draft to the skill when there is no template, then ignores the drafted marker", () => {
    const base = scratch();
    const root = repo(base, { template: false, gitignore: "dist/\n" });
    const before = readFileSync(excludeFile(base, root), "utf8");
    const result = setup(base, root);
    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")[0]).toMatch(/^no-template: /);
    expect(result.stdout).toContain(marker(root));
    expect(existsSync(join(root, ".codex-pair"))).toBe(false);
    expect(readFileSync(excludeFile(base, root), "utf8")).toBe(before);
    // The skill writes the confirmed draft, then runs setup again.
    mkdirSync(join(root, ".codex-pair"));
    writeFileSync(marker(root), "# drafted\n");
    const again = setup(base, root);
    expect(again.stdout.split("\n")[0]).toMatch(/^exists: /);
    expect(readFileSync(marker(root), "utf8")).toBe("# drafted\n");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("dist/\n");
    expect(git(base, root, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it("writes nothing outside a git repository", () => {
    const base = scratch();
    const plain = join(base, "plain");
    mkdirSync(join(plain, ".codex-pair.example"), { recursive: true });
    writeFileSync(join(plain, ".codex-pair.example", "context.md"), TEMPLATE);
    const result = setup(base, plain);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^not-git: /);
    expect(existsSync(join(plain, ".codex-pair"))).toBe(false);
  });

  it("refuses a template that is not a regular file", () => {
    const base = scratch();
    const root = repo(base, { template: false });
    writeFileSync(join(base, "outside.md"), "secret\n");
    mkdirSync(join(root, ".codex-pair.example"));
    symlinkSync(join(base, "outside.md"), join(root, ".codex-pair.example", "context.md"));
    const result = setup(base, root);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^invalid-template: /);
    expect(existsSync(join(root, ".codex-pair"))).toBe(false);
  });
});
