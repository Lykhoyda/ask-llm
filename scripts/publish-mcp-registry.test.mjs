import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { publishMissingRegistryVersions, recordsMatch } from "./publish-mcp-registry.mjs";

const scratchDirs = [];

function manifest(name, version) {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name,
    description: `${name} test server`,
    version,
    packages: [
      {
        registryType: "npm",
        identifier: `@ask-llm/${name}`,
        version,
        transport: { type: "stdio" },
        environmentVariables: [
          {
            name: "OPTIONAL_VALUE",
            description: "Optional value",
            isRequired: false,
            format: "string",
            isSecret: false,
          },
        ],
      },
    ],
  };
}

function registryRecord(value) {
  const copy = structuredClone(value);
  for (const variable of copy.packages[0].environmentVariables ?? []) {
    delete variable.isRequired;
    delete variable.isSecret;
  }
  return copy;
}

function writeManifests(values) {
  const directory = mkdtempSync(join(process.cwd(), ".registry-publish-test-"));
  scratchDirs.push(directory);
  mkdirSync(directory, { recursive: true });
  return values.map((value, index) => {
    const path = join(directory, `${index}.json`);
    writeFileSync(path, `${JSON.stringify(value)}\n`);
    return path;
  });
}

function responseFor(record) {
  return new Response(
    JSON.stringify({ servers: record ? [{ server: record }] : [], metadata: { count: record ? 1 : 0 } }),
    {
      headers: { "content-type": "application/json" },
    },
  );
}

function createLogger() {
  const lines = [];
  return {
    lines,
    log: { log: (line) => lines.push(line), error: (line) => lines.push(line) },
  };
}

function createPublisher({ publishResults = new Map(), validationResults = new Map() } = {}) {
  const calls = [];
  return {
    calls,
    run: async (operation, path) => {
      calls.push({ operation, path });
      if (operation === "validate") return validationResults.get(path) ?? { code: 0, output: "valid" };
      return publishResults.get(path) ?? { code: 0, output: "published" };
    },
  };
}

afterEach(() => {
  for (const directory of scratchDirs.splice(0)) rmSync(directory, { force: true, recursive: true });
});

test("semantic record matching accepts Registry omission of optional false fields", () => {
  const expected = manifest("ask-one", "1.0.0");
  expected.packages[0].packageArguments = [
    { type: "named", name: "--optional", isRequired: false, isSecret: false, isRepeated: false },
  ];
  expected.packages[0].runtimeArguments = [{ type: "positional", value: "optional", isRepeated: false }];
  const registryValue = registryRecord(expected);
  delete registryValue.packages[0].packageArguments[0].isRequired;
  delete registryValue.packages[0].packageArguments[0].isSecret;
  delete registryValue.packages[0].packageArguments[0].isRepeated;
  delete registryValue.packages[0].runtimeArguments[0].isRepeated;
  assert.equal(recordsMatch(expected, registryValue), true);
  const mismatched = registryRecord(expected);
  mismatched.packages[0].identifier = "@other/ask-one";
  assert.equal(recordsMatch(expected, mismatched), false);
});

test("semantic record matching accepts reordered packages and environment-variable mappings", () => {
  const expected = manifest("ask-one", "1.0.0");
  expected.packages[0].environmentVariables.push({
    name: "ANOTHER_VALUE",
    description: "Another optional value",
    isRequired: false,
    format: "string",
    isSecret: false,
  });
  expected.packages.push({
    registryType: "npm",
    identifier: "@ask-llm/ask-one-alternative",
    version: "1.0.0",
    transport: { type: "stdio" },
    environmentVariables: [{ name: "SECOND_PACKAGE_VALUE", description: "Second package value", format: "string" }],
  });

  const reordered = registryRecord(expected);
  reordered.packages.reverse();
  for (const packageRecord of reordered.packages) packageRecord.environmentVariables?.reverse();

  assert.equal(recordsMatch(expected, reordered), true);
});

test("semantic record matching rejects changed set entries and reordered argument arrays", () => {
  const expected = manifest("ask-one", "1.0.0");
  expected.packages[0].environmentVariables.push({
    name: "ANOTHER_VALUE",
    description: "Another optional value",
    format: "string",
  });
  expected.packages[0].packageArguments = [
    { type: "named", name: "--first" },
    { type: "named", name: "--second" },
  ];

  const changedMapping = registryRecord(expected);
  changedMapping.packages[0].environmentVariables.reverse();
  changedMapping.packages[0].environmentVariables[0].description = "Different description";
  assert.equal(recordsMatch(expected, changedMapping), false);

  const reorderedArguments = registryRecord(expected);
  reorderedArguments.packages[0].packageArguments.reverse();
  assert.equal(recordsMatch(expected, reorderedArguments), false);
});

test("semantic record matching preserves order in publisher-provided metadata arrays", () => {
  const expected = manifest("ask-one", "1.0.0");
  expected._meta = {
    "io.modelcontextprotocol.registry/publisher-provided": {
      packages: [{ identifier: "first" }, { identifier: "second" }],
      environmentVariables: [{ name: "FIRST" }, { name: "SECOND" }],
    },
  };

  const reorderedPackages = registryRecord(expected);
  reorderedPackages._meta["io.modelcontextprotocol.registry/publisher-provided"].packages.reverse();
  assert.equal(recordsMatch(expected, reorderedPackages), false);

  const reorderedEnvironmentVariables = registryRecord(expected);
  reorderedEnvironmentVariables._meta[
    "io.modelcontextprotocol.registry/publisher-provided"
  ].environmentVariables.reverse();
  assert.equal(recordsMatch(expected, reorderedEnvironmentVariables), false);
});

test("semantic record matching preserves schema-like false fields in publisher metadata", () => {
  const expected = manifest("ask-one", "1.0.0");
  expected._meta = {
    "io.modelcontextprotocol.registry/publisher-provided": {
      isRequired: false,
      isRepeated: false,
      isSecret: false,
    },
  };

  const withoutIsRequired = registryRecord(expected);
  delete withoutIsRequired._meta["io.modelcontextprotocol.registry/publisher-provided"].isRequired;
  assert.equal(recordsMatch(expected, withoutIsRequired), false);

  const withoutIsSecret = registryRecord(expected);
  delete withoutIsSecret._meta["io.modelcontextprotocol.registry/publisher-provided"].isSecret;
  assert.equal(recordsMatch(expected, withoutIsSecret), false);

  const withoutIsRepeated = registryRecord(expected);
  delete withoutIsRepeated._meta["io.modelcontextprotocol.registry/publisher-provided"].isRepeated;
  assert.equal(recordsMatch(expected, withoutIsRepeated), false);
});

test("partial state verifies present records and publishes only missing records", async () => {
  const present = manifest("ask-present", "1.0.0");
  const missing = manifest("ask-missing", "2.0.0");
  const paths = writeManifests([present, missing]);
  const publisher = createPublisher();
  const logger = createLogger();

  const result = await publishMissingRegistryVersions({
    manifestPaths: paths,
    fetchImpl: async (url) =>
      responseFor(url.searchParams.get("search") === present.name ? registryRecord(present) : null),
    runPublisher: publisher.run,
    log: logger.log,
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.skipped, ["ask-present@1.0.0"]);
  assert.deepEqual(result.published, ["ask-missing@2.0.0"]);
  assert.deepEqual(
    publisher.calls.filter(({ operation }) => operation === "publish").map(({ path }) => path),
    [paths[1]],
  );
});

test("all-present state is an explicit verified no-op", async () => {
  const values = [manifest("ask-one", "1.0.0"), manifest("ask-two", "2.0.0")];
  const paths = writeManifests(values);
  const publisher = createPublisher();
  const logger = createLogger();

  const result = await publishMissingRegistryVersions({
    manifestPaths: paths,
    fetchImpl: async (url) =>
      responseFor(registryRecord(values.find(({ name }) => name === url.searchParams.get("search")))),
    runPublisher: publisher.run,
    log: logger.log,
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.published, []);
  assert.deepEqual(result.skipped, ["ask-one@1.0.0", "ask-two@2.0.0"]);
  assert.equal(
    publisher.calls.some(({ operation }) => operation === "publish"),
    false,
  );
  assert.equal(
    publisher.calls.some(({ operation }) => operation === "login"),
    false,
  );
  assert.ok(logger.lines.some((line) => line.includes("0 published, 2 verified existing")));
});

test("all-missing state publishes every validated manifest", async () => {
  const values = [manifest("ask-one", "1.0.0"), manifest("ask-two", "2.0.0")];
  const paths = writeManifests(values);
  const publisher = createPublisher();

  const result = await publishMissingRegistryVersions({
    manifestPaths: paths,
    fetchImpl: async () => responseFor(null),
    runPublisher: publisher.run,
    log: createLogger().log,
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.published, ["ask-one@1.0.0", "ask-two@2.0.0"]);
  assert.equal(publisher.calls.filter(({ operation }) => operation === "publish").length, 2);
});

test("same-version content mismatch fails closed and is not published", async () => {
  const expected = manifest("ask-one", "1.0.0");
  const existing = registryRecord(expected);
  existing.description = "different content";
  const [path] = writeManifests([expected]);
  const publisher = createPublisher();

  const result = await publishMissingRegistryVersions({
    manifestPaths: [path],
    fetchImpl: async () => responseFor(existing),
    runPublisher: publisher.run,
    log: createLogger().log,
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].phase, "verify");
  assert.equal(
    publisher.calls.some(({ operation }) => operation === "publish"),
    false,
  );
});

test("duplicate race is accepted only after the exact record appears", async () => {
  const expected = manifest("ask-race", "1.0.0");
  const [path] = writeManifests([expected]);
  let lookups = 0;
  const publisher = createPublisher({
    publishResults: new Map([[path, { code: 1, output: "invalid version: cannot publish duplicate version" }]]),
  });

  const result = await publishMissingRegistryVersions({
    manifestPaths: [path],
    fetchImpl: async () => responseFor(lookups++ === 0 ? null : registryRecord(expected)),
    runPublisher: publisher.run,
    log: createLogger().log,
  });

  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.raced, ["ask-race@1.0.0"]);
  assert.equal(lookups, 2);
});

test("duplicate race with a mismatched record fails closed", async () => {
  const expected = manifest("ask-race", "1.0.0");
  const mismatched = registryRecord(expected);
  mismatched.description = "not the submitted manifest";
  const [path] = writeManifests([expected]);
  let lookups = 0;
  const publisher = createPublisher({
    publishResults: new Map([[path, { code: 1, output: "invalid version: cannot publish duplicate version" }]]),
  });

  const result = await publishMissingRegistryVersions({
    manifestPaths: [path],
    fetchImpl: async () => responseFor(lookups++ === 0 ? null : mismatched),
    runPublisher: publisher.run,
    log: createLogger().log,
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].phase, "duplicate-race");
});

test("OIDC login failures are preserved without attempting selected publishes", async () => {
  const values = [manifest("ask-one", "1.0.0"), manifest("ask-two", "2.0.0")];
  const paths = writeManifests(values);
  const publisher = createPublisher({
    publishResults: new Map([["github-oidc", { code: 1, output: "OIDC token exchange failed: HTTP 403" }]]),
  });

  const result = await publishMissingRegistryVersions({
    manifestPaths: paths,
    fetchImpl: async () => responseFor(null),
    runPublisher: publisher.run,
    log: createLogger().log,
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].phase, "login");
  assert.match(result.failures[0].message, /HTTP 403/);
  assert.equal(publisher.calls.filter(({ operation }) => operation === "publish").length, 0);
});

test("real publisher failures are preserved while later selected servers are still attempted", async () => {
  const values = [manifest("ask-auth-fails", "1.0.0"), manifest("ask-succeeds", "2.0.0")];
  const paths = writeManifests(values);
  const publisher = createPublisher({
    publishResults: new Map([[paths[0], { code: 1, output: "authentication failed: HTTP 403" }]]),
  });
  const logger = createLogger();

  const result = await publishMissingRegistryVersions({
    manifestPaths: paths,
    fetchImpl: async () => responseFor(null),
    runPublisher: publisher.run,
    log: logger.log,
  });

  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].phase, "publish");
  assert.match(result.failures[0].message, /HTTP 403/);
  assert.deepEqual(result.published, ["ask-succeeds@2.0.0"]);
  assert.equal(publisher.calls.filter(({ operation }) => operation === "publish").length, 2);
  assert.ok(logger.lines.some((line) => line.includes("finished with 1 failure")));
});

test("validation and Registry lookup failures fail closed without blocking unrelated candidates", async () => {
  const values = [manifest("ask-invalid", "1.0.0"), manifest("ask-lookup-fails", "2.0.0"), manifest("ask-ok", "3.0.0")];
  const paths = writeManifests(values);
  const publisher = createPublisher({
    validationResults: new Map([[paths[0], { code: 1, output: "schema validation failed" }]]),
  });

  const result = await publishMissingRegistryVersions({
    manifestPaths: paths,
    fetchImpl: async (url) => {
      if (url.searchParams.get("search") === "ask-lookup-fails") throw new Error("network unavailable");
      return responseFor(null);
    },
    runPublisher: publisher.run,
    log: createLogger().log,
  });

  assert.deepEqual(
    result.failures.map(({ phase }) => phase),
    ["validate", "lookup"],
  );
  assert.deepEqual(result.published, ["ask-ok@3.0.0"]);
});
