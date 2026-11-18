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
    expect(result.stdout).toContain("draft .codex-pair/context.md interactively in the current directory");
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

  it("keeps a no-template interactive draft scoped to its invoking subpackage", () => {
    const base = scratch();
    const root = repo(base, { template: false });
    const project = join(root, "packages", "foo");
    mkdirSync(project, { recursive: true });
    const before = readFileSync(excludeFile(base, root), "utf8");
    const result = setup(base, project);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^no-template: /);
    expect(result.stdout).toContain("draft .codex-pair/context.md interactively in the current directory");
    expect(result.stdout).not.toContain(marker(root));
    expect(existsSync(join(project, ".codex-pair"))).toBe(false);
    expect(existsSync(join(root, ".codex-pair"))).toBe(false);
    expect(readFileSync(excludeFile(base, root), "utf8")).toBe(before);
    mkdirSync(join(project, ".codex-pair"));
    writeFileSync(marker(project), "# foo context\n");
    const again = setup(base, project);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^exists: /);
    expect(again.stdout).toContain(marker(project));
    expect(readFileSync(marker(project), "utf8")).toBe("# foo context\n");
    expect(existsSync(join(root, ".codex-pair"))).toBe(false);
    expect(git(base, root, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it.each([false, true])("preserves an ancestor subpackage marker with template=%s", (template) => {
    const base = scratch();
    const root = repo(base, { template });
    const project = join(root, "packages", "foo");
    const nested = join(project, "src");
    mkdirSync(nested, { recursive: true });
    mkdirSync(join(project, ".codex-pair"));
    writeFileSync(marker(project), "# foo context\n");
    const result = setup(base, nested);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^exists: /);
    expect(result.stdout).toContain(marker(project));
    expect(readFileSync(marker(project), "utf8")).toBe("# foo context\n");
    expect(existsSync(join(root, ".codex-pair"))).toBe(false);
    writeFileSync(join(project, ".codex-pair", "log.jsonl"), "private review\n");
    expect(git(base, root, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it("stops existing-marker discovery at the repository root", () => {
    const base = scratch();
    const root = repo(base, { template: false });
    mkdirSync(join(base, ".codex-pair"));
    writeFileSync(marker(base), "# outside context\n");
    const result = setup(base, join(root, "src"));
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^no-template: /);
    expect(existsSync(join(root, ".codex-pair"))).toBe(false);
    expect(readFileSync(marker(base), "utf8")).toBe("# outside context\n");
  });

  it.each([false, true])("excludes logs and caches beyond a marker-only ignore rule with existing=%s", (existing) => {
    const base = scratch();
    const gitignore = ".codex-pair/context.md\n";
    const root = repo(base, { gitignore });
    if (existing) {
      mkdirSync(join(root, ".codex-pair"));
      writeFileSync(marker(root), "# personal context\n");
    }
    const result = setup(base, root);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(existing ? /^exists: / : /^created: /);
    expect(excludeLines(base, root)).toContain(".codex-pair/");
    expect(readFileSync(marker(root), "utf8")).toBe(existing ? "# personal context\n" : TEMPLATE);
    writeFileSync(join(root, ".codex-pair", "log.jsonl"), "private review\n");
    mkdirSync(join(root, ".codex-pair", "state"));
    writeFileSync(join(root, ".codex-pair", "state", "cache.json"), "{}\n");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(gitignore);
    expect(git(base, root, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it("leaves local excludes unchanged when git already ignores the whole directory", () => {
    const base = scratch();
    const root = repo(base, { gitignore: ".codex-pair/\n" });
    const before = readFileSync(excludeFile(base, root), "utf8");
    const result = setup(base, root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already ignored by git");
    expect(readFileSync(excludeFile(base, root), "utf8")).toBe(before);
    writeFileSync(join(root, ".codex-pair", "log.jsonl"), "private review\n");
    expect(git(base, root, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it.each([false, true])(
    "reports ignore failure when a directory negation overrides local excludes with existing=%s",
    (existing) => {
      const base = scratch();
      const gitignore = "!.codex-pair/\n";
      const root = repo(base, { gitignore });
      if (existing) {
        mkdirSync(join(root, ".codex-pair"));
        writeFileSync(marker(root), "# personal context\n");
      }
      const result = setup(base, root);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(existing ? /^exists: / : /^created: /);
      expect(result.stdout).toContain("is still not ignored by git");
      expect(result.stdout).not.toContain("is ignored through");
      expect(readFileSync(marker(root), "utf8")).toBe(existing ? "# personal context\n" : TEMPLATE);
      expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(gitignore);
      writeFileSync(join(root, ".codex-pair", "log.jsonl"), "private review\n");
      expect(git(base, root, "status", "--porcelain", "--untracked-files=all")).toContain(".codex-pair/log.jsonl");
    },
  );

  it("writes nothing outside a git repository", () => {
    const base = scratch();
    const plain = join(base, "plain");
    mkdirSync(join(plain, ".codex-pair.example"), { recursive: true });
    writeFileSync(join(plain, ".codex-pair.example", "context.md"), TEMPLATE);
    const result = setup(base, plain);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^not-git: /);
    expect(result.stdout).toContain("draft .codex-pair/context.md interactively in the current directory");
    expect(existsSync(join(plain, ".codex-pair"))).toBe(false);
  });

  it.each([false, true])(
    "checks directory-wide exclusion for an ancestor subpackage marker with negation=%s",
    (negated) => {
      const base = scratch();
      const root = repo(base);
      const project = join(root, "packages", "foo");
      const nested = join(project, "src");
      mkdirSync(nested, { recursive: true });
      const gitignore = `.codex-pair/context.md\n${negated ? "!.codex-pair/\n" : ""}`;
      writeFileSync(join(project, ".gitignore"), gitignore);
      git(base, root, "add", "-A");
      git(base, root, "commit", "-q", "-m", "subpackage ignore rules");
      mkdirSync(join(project, ".codex-pair"));
      writeFileSync(marker(project), "# personal context\n");
      const result = setup(base, nested);
      expect(result.status).toBe(negated ? 1 : 0);
      expect(result.stdout).toMatch(/^exists: /);
      expect(result.stdout).toContain(marker(project));
      expect(readFileSync(marker(project), "utf8")).toBe("# personal context\n");
      expect(existsSync(join(root, ".codex-pair"))).toBe(false);
      expect(readFileSync(join(project, ".gitignore"), "utf8")).toBe(gitignore);
      writeFileSync(join(project, ".codex-pair", "log.jsonl"), "private review\n");
      const status = git(base, root, "status", "--porcelain", "--untracked-files=all");
      if (negated) {
        expect(result.stdout).toContain("is still not ignored by git");
        expect(status).toContain("packages/foo/.codex-pair/log.jsonl");
      } else {
        expect(status).toBe("");
      }
    },
  );

  it("refuses a committed template directory symlink to private context outside the repository", () => {
    const base = scratch();
    const root = repo(base, { template: false });
    const external = join(base, "repo-private", ".codex-pair");
    mkdirSync(external, { recursive: true });
    const privateContext = "# private external context\n";
    writeFileSync(join(external, "context.md"), privateContext);
    symlinkSync("../repo-private/.codex-pair", join(root, ".codex-pair.example"));
    git(base, root, "add", "-A");
    git(base, root, "commit", "-q", "-m", "symlinked template directory");
    const before = readFileSync(excludeFile(base, root), "utf8");
    const result = setup(base, root);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^invalid-template: /);
    expect(existsSync(join(root, ".codex-pair"))).toBe(false);
    expect(readFileSync(join(external, "context.md"), "utf8")).toBe(privateContext);
    expect(readFileSync(excludeFile(base, root), "utf8")).toBe(before);
    expect(git(base, root, "status", "--porcelain", "--untracked-files=all")).toBe("");
  });

  it.each([
    { scope: "", existing: false, template: true },
    { scope: "", existing: true, template: true },
    { scope: "packages/foo", existing: false, template: true },
    { scope: "packages/foo", existing: true, template: true },
    { scope: "packages/foo", existing: false, template: false },
  ])(
    "refuses a symlinked marker directory with scope=$scope existing=$existing template=$template",
    ({ scope, existing, template }) => {
      const base = scratch();
      const root = repo(base, { template });
      const project = join(root, scope);
      const nested = join(project, "src");
      mkdirSync(nested, { recursive: true });
      const external = join(base, "private-state");
      mkdirSync(external);
      if (existing) writeFileSync(join(external, "context.md"), "# private context\n");
      symlinkSync(external, join(project, ".codex-pair"));
      const before = readFileSync(excludeFile(base, root), "utf8");
      const result = setup(base, nested);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/^invalid-marker: /);
      expect(existsSync(join(external, "context.md"))).toBe(existing);
      if (existing) expect(readFileSync(join(external, "context.md"), "utf8")).toBe("# private context\n");
      expect(readFileSync(excludeFile(base, root), "utf8")).toBe(before);
      if (scope) expect(existsSync(join(root, ".codex-pair"))).toBe(false);
    },
  );

  it.each(["", "packages/foo"])(
    "refuses an existing marker file symlink in '%s' without changing excludes",
    (scope) => {
      const base = scratch();
      const root = repo(base);
      const project = join(root, scope);
      const nested = join(project, "src");
      mkdirSync(nested, { recursive: true });
      mkdirSync(join(project, ".codex-pair"));
      const external = join(base, "private-context.md");
      writeFileSync(external, "# private context\n");
      symlinkSync(external, marker(project));
      const before = readFileSync(excludeFile(base, root), "utf8");
      const result = setup(base, nested);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/^invalid-marker: /);
      expect(lstatSync(marker(project)).isSymbolicLink()).toBe(true);
      expect(readFileSync(external, "utf8")).toBe("# private context\n");
      expect(readFileSync(excludeFile(base, root), "utf8")).toBe(before);
      if (scope) expect(existsSync(join(root, ".codex-pair"))).toBe(false);
    },
  );

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
