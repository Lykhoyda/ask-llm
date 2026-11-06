import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it("requires a canonical changeset when a private bundled provider changes", () => {
  const root = mkdtempSync(join(tmpdir(), "ask-llm-bundled-changeset-"));
  const script = resolve(import.meta.dirname, "check-shared-changeset.ts");
  const source = join(root, "packages/codex-mcp/src/executor.ts");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  const commit = (message: string) => {
    git("add", ".");
    git("commit", "-m", message);
  };
  const check = () =>
    spawnSync(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, GITHUB_BASE_REF: "main" },
      encoding: "utf8",
    });
  try {
    git("init", "--initial-branch=main");
    git("config", "user.name", "Changeset Test");
    git("config", "user.email", "changeset@example.test");
    git("config", "commit.gpgsign", "false");
    mkdirSync(join(root, "packages/codex-mcp/src"), { recursive: true });
    writeFileSync(source, "export const value = { a: 'x' , b: [ 1,2 ] }\n");
    commit("baseline");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-b", "feature");
    writeFileSync(source, 'export const value = { a: "x", b: [1, 2] };\n');
    commit("reformat only");
    const formattedOnly = check();
    expect(formattedOnly.status, formattedOnly.stdout + formattedOnly.stderr).toBe(0);

    git("checkout", "main");
    writeFileSync(source, 'export const value = { a: "y", b: [1, 2] };\n');
    commit("main moves on");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "feature");
    const mainMoved = check();
    expect(mainMoved.status, mainMoved.stdout + mainMoved.stderr).toBe(0);

    writeFileSync(source, 'export const value = { a: " x", b: [1, 2] };\n');
    commit("whitespace inside a string literal");
    const missing = check();
    expect(missing.status, missing.stdout + missing.stderr).toBe(1);
    expect(missing.stderr).toContain("@ask-llm/mcp");

    mkdirSync(join(root, ".changeset"));
    writeFileSync(join(root, ".changeset/fix.md"), '---\n"@ask-llm/mcp": patch\n---\n\nFix provider behavior.\n');
    commit("canonical release");
    const covered = check();
    expect(covered.status, covered.stdout + covered.stderr).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
