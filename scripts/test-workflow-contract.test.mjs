import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8");
const batch = "$" + "{{ matrix.batch }}";

function job(name) {
  const start = workflow.indexOf(`  ${name}:\n`);
  if (start === -1) throw new Error(`missing workflow job: ${name}`);
  const rest = workflow.slice(workflow.indexOf("\n", start) + 1);
  const next = rest.search(/^ {2}[a-z][a-z0-9-]*:\n/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("five-batch workflow contract", () => {
  const chains = [
    {
      setupId: "test-setup-node22-ubuntu",
      batchesId: "test-batches-node22-ubuntu",
      gateId: "test-node22-ubuntu",
      nodeVersion: "22.x",
      os: "ubuntu-latest",
    },
    {
      setupId: "test-setup-node24-ubuntu",
      batchesId: "test-batches-node24-ubuntu",
      gateId: "test-node24-ubuntu",
      nodeVersion: "24.x",
      os: "ubuntu-latest",
    },
    {
      setupId: "test-setup-node22-windows",
      batchesId: "test-batches-node22-windows",
      gateId: "test-node22-windows",
      nodeVersion: "22.x",
      os: "windows-latest",
    },
  ];

  it("runs install, build, lint, and changeset guard only in one setup per Node/OS leg", () => {
    for (const chain of chains) {
      const setup = job(chain.setupId);
      const batches = job(chain.batchesId);

      expect(setup).toContain(`runs-on: ${chain.os}`);
      expect(setup).toContain(`node-version: ${chain.nodeVersion}`);
      expect(setup).toContain("yarn install --immutable");
      expect(setup).toContain("run: yarn build");
      expect(setup).toContain("run: yarn lint");
      expect(setup).toContain("check-shared-changeset.mjs");
      expect(setup).toContain(`name: test-setup-${chain.nodeVersion}-${chain.os}`);

      expect(batches).not.toContain("yarn install");
      expect(batches).not.toContain("run: yarn build");
      expect(batches).not.toContain("run: yarn lint");
      expect(batches).not.toContain("check-shared-changeset.mjs");
    }
  });

  it("fans out exactly five test-only batches from the matching setup artifact", () => {
    for (const chain of chains) {
      const batches = job(chain.batchesId);

      expect(batches).toContain(`needs: ${chain.setupId}`);
      expect(batches).toContain("batch: [1, 2, 3, 4, 5]");
      expect(batches).toContain(`name: test-setup-${chain.nodeVersion}-${chain.os}`);
      expect(batches).toContain(`run: yarn test:batch "${batch}/5"`);
      expect(batches).toContain(`name: test-result-${chain.nodeVersion}-${chain.os}-${batch}`);
    }
  });

  it("keeps each legacy check dependent on only its matching five-batch matrix", () => {
    for (const chain of chains) {
      const batches = job(chain.batchesId);
      const gate = job(chain.gateId);
      const otherChains = chains.filter((candidate) => candidate !== chain);

      expect(gate).toContain(`name: test (${chain.nodeVersion}, ${chain.os})`);
      expect(gate).toContain("timeout-minutes: 15");
      expect(gate).toContain(`needs: ${chain.batchesId}`);
      expect(gate).toContain(`pattern: test-result-${chain.nodeVersion}-${chain.os}-*`);
      expect(gate).toContain("for batch in 1 2 3 4 5");

      for (const other of otherChains) {
        expect(batches).not.toContain(other.setupId);
        expect(gate).not.toContain(other.batchesId);
        expect(gate).not.toContain(`test-result-${other.nodeVersion}-${other.os}-*`);
      }
    }
  });
});
