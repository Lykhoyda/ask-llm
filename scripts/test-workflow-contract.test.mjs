import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8");
const nodeVersion = "$" + "{{ matrix.node-version }}";
const os = "$" + "{{ matrix.os }}";
const batch = "$" + "{{ matrix.batch }}";

function job(name) {
  const start = workflow.indexOf(`  ${name}:\n`);
  if (start === -1) throw new Error(`missing workflow job: ${name}`);
  const rest = workflow.slice(workflow.indexOf("\n", start) + 1);
  const next = rest.search(/^ {2}[a-z][a-z-]*:\n/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("five-batch workflow contract", () => {
  const setup = job("test-setup");
  const batches = job("test-batches");
  const gate = job("test");

  it("runs install, build, lint, and changeset guard only in one setup per Node/OS leg", () => {
    expect(setup).toContain("node-version: [22.x, 24.x]");
    expect(setup).toContain("os: [ubuntu-latest, windows-latest]");
    expect(setup).toContain("yarn install --immutable");
    expect(setup).toContain("run: yarn build");
    expect(setup).toContain("run: yarn lint");
    expect(setup).toContain("check-shared-changeset.mjs");
    expect(setup).toContain(`name: test-setup-${nodeVersion}-${os}`);

    expect(batches).not.toContain("yarn install");
    expect(batches).not.toContain("run: yarn build");
    expect(batches).not.toContain("run: yarn lint");
    expect(batches).not.toContain("check-shared-changeset.mjs");
  });

  it("fans out exactly five test-only batches from the matching setup artifact", () => {
    expect(batches).toContain("needs: test-setup");
    expect(batches).toContain("batch: [1, 2, 3, 4, 5]");
    expect(batches).toContain(`name: test-setup-${nodeVersion}-${os}`);
    expect(batches).toContain(`run: yarn test:batch "${batch}/5"`);
    expect(batches).toContain(`name: test-result-${nodeVersion}-${os}-${batch}`);
  });

  it("keeps each legacy check scoped to its own five Node/OS result markers", () => {
    expect(gate).toContain(`name: test (${nodeVersion}, ${os})`);
    expect(gate).toContain(`pattern: test-result-${nodeVersion}-${os}-*`);
    expect(gate).toContain("for batch in 1 2 3 4 5");
    expect(gate).not.toContain("needs.test-batches.result");
  });
});
