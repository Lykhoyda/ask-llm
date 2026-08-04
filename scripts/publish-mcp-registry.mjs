#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io";
const DUPLICATE_VERSION = /invalid version:\s*cannot publish duplicate version/i;
const OPTIONAL_FALSE_FIELDS = new Set(["isRequired", "isSecret"]);
const OUTPUT_LIMIT = 16_384;

function boundedTail(value) {
  return value.length <= OUTPUT_LIMIT ? value : value.slice(-OUTPUT_LIMIT);
}

function canonicalJson(value) {
  return JSON.stringify(value);
}

function semanticSetKey(fieldName, value) {
  if (fieldName === "packages") {
    return canonicalJson([
      value?.registryType ?? null,
      value?.registryBaseUrl ?? null,
      value?.identifier ?? null,
      value?.version ?? null,
      value?.fileSha256 ?? null,
      canonicalJson(value),
    ]);
  }
  if (fieldName === "environmentVariables") {
    return canonicalJson([value?.name ?? null, canonicalJson(value)]);
  }
  return null;
}

function compareCanonicalSetEntries(fieldName, left, right) {
  const leftKey = semanticSetKey(fieldName, left);
  const rightKey = semanticSetKey(fieldName, right);
  if (leftKey === null || rightKey === null || leftKey === rightKey) return 0;
  return leftKey < rightKey ? -1 : 1;
}

function semanticSetField(path) {
  if (path.length === 1 && path[0] === "packages") return "packages";
  if (
    path.length === 3 &&
    path[0] === "packages" &&
    Number.isInteger(path[1]) &&
    path[2] === "environmentVariables"
  ) {
    return "environmentVariables";
  }
  return null;
}

function normalizeRegistryValue(value, path = []) {
  if (Array.isArray(value)) {
    const normalized = value.map((child, index) => normalizeRegistryValue(child, [...path, index]));
    const fieldName = semanticSetField(path);
    return fieldName !== null
      ? [...normalized].sort((left, right) => compareCanonicalSetEntries(fieldName, left, right))
      : normalized;
  }
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !(child === false && OPTIONAL_FALSE_FIELDS.has(key)))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizeRegistryValue(child, [...path, key])]),
  );
}

export function recordsMatch(expected, actual) {
  return isDeepStrictEqual(normalizeRegistryValue(expected), normalizeRegistryValue(actual));
}

function identity(manifest) {
  return `${manifest.name}@${manifest.version}`;
}

async function responseDetail(response) {
  try {
    return boundedTail(await response.text());
  } catch {
    return "<response body unavailable>";
  }
}

export async function lookupExactRecord(manifest, { fetchImpl = fetch, registryUrl = DEFAULT_REGISTRY_URL } = {}) {
  const url = new URL("/v0/servers", registryUrl);
  url.searchParams.set("search", manifest.name);
  url.searchParams.set("version", manifest.version);

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Registry lookup for ${identity(manifest)} returned HTTP ${response.status}: ${await responseDetail(response)}`,
    );
  }

  const payload = await response.json();
  if (!Array.isArray(payload.servers)) {
    throw new Error(`Registry lookup for ${identity(manifest)} returned an invalid response: missing servers array`);
  }

  const matches = payload.servers
    .map((entry) => entry?.server)
    .filter((server) => server?.name === manifest.name && server?.version === manifest.version);

  if (matches.length > 1) {
    throw new Error(`Registry lookup for ${identity(manifest)} returned ${matches.length} exact records`);
  }

  return matches[0] ?? null;
}

export function runPublisherCommand(operation, manifestPath, { publisherPath = "./mcp-publisher" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(publisherPath, [operation, manifestPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    const capture = (stream, destination) => {
      stream.on("data", (chunk) => {
        const text = chunk.toString();
        destination.write(text);
        output = boundedTail(output + text);
      });
    };
    capture(child.stdout, process.stdout);
    capture(child.stderr, process.stderr);

    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code: code ?? 1, signal, output });
    });
  });
}

function failureMessage(result) {
  const detail = result.output.trim();
  const suffix = result.signal ? ` (signal ${result.signal})` : "";
  return detail ? `${detail}${suffix}` : `publisher exited ${result.code}${suffix} without output`;
}

export async function publishMissingRegistryVersions({
  manifestPaths,
  fetchImpl = fetch,
  registryUrl = DEFAULT_REGISTRY_URL,
  runPublisher = runPublisherCommand,
  log = console,
} = {}) {
  if (!Array.isArray(manifestPaths) || manifestPaths.length === 0) {
    throw new Error("At least one server.json path is required");
  }

  const failures = [];
  const selected = [];
  const skipped = [];
  const published = [];
  const raced = [];

  for (const manifestPath of manifestPaths) {
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      failures.push({ manifestPath, phase: "read", message: error.message });
      continue;
    }

    const target = identity(manifest);
    let validation;
    try {
      validation = await runPublisher("validate", manifestPath);
    } catch (error) {
      failures.push({ manifestPath, target, phase: "validate", message: error.message });
      continue;
    }
    if (validation.code !== 0) {
      failures.push({ manifestPath, target, phase: "validate", message: failureMessage(validation) });
      continue;
    }

    try {
      const existing = await lookupExactRecord(manifest, { fetchImpl, registryUrl });
      if (existing === null) {
        selected.push({ manifest, manifestPath, target });
      } else if (recordsMatch(manifest, existing)) {
        skipped.push(target);
        log.log(`Verified existing MCP Registry record; skipping ${target}`);
      } else {
        failures.push({
          manifestPath,
          target,
          phase: "verify",
          message: "an existing record has the same name and version but different manifest content",
        });
      }
    } catch (error) {
      failures.push({ manifestPath, target, phase: "lookup", message: error.message });
    }
  }

  if (selected.length > 0) {
    let login;
    try {
      login = await runPublisher("login", "github-oidc");
    } catch (error) {
      failures.push({ manifestPath: "<publisher>", phase: "login", message: error.message });
    }
    if (login && login.code !== 0) {
      failures.push({ manifestPath: "<publisher>", phase: "login", message: failureMessage(login) });
    }
  }

  const loginFailed = failures.some(({ phase }) => phase === "login");
  for (const candidate of loginFailed ? [] : selected) {
    const { manifest, manifestPath, target } = candidate;
    log.log(`Publishing missing MCP Registry record ${target}`);

    let result;
    try {
      result = await runPublisher("publish", manifestPath);
    } catch (error) {
      failures.push({ manifestPath, target, phase: "publish", message: error.message });
      continue;
    }

    if (result.code === 0) {
      published.push(target);
      continue;
    }

    if (!DUPLICATE_VERSION.test(result.output)) {
      failures.push({ manifestPath, target, phase: "publish", message: failureMessage(result) });
      continue;
    }

    try {
      const existing = await lookupExactRecord(manifest, { fetchImpl, registryUrl });
      if (existing !== null && recordsMatch(manifest, existing)) {
        raced.push(target);
        log.log(`Verified ${target} after a duplicate-version race; accepting the existing exact record`);
      } else {
        failures.push({
          manifestPath,
          target,
          phase: "duplicate-race",
          message:
            existing === null
              ? "publisher reported a duplicate, but an exact record was still absent"
              : "publisher reported a duplicate, but the existing record does not match the manifest",
        });
      }
    } catch (error) {
      failures.push({ manifestPath, target, phase: "duplicate-race", message: error.message });
    }
  }

  if (failures.length > 0) {
    log.error(`MCP Registry publication finished with ${failures.length} failure(s):`);
    for (const failure of failures) {
      log.error(`- ${failure.target ?? failure.manifestPath} [${failure.phase}]: ${failure.message}`);
    }
  } else {
    log.log(
      `MCP Registry publication complete: ${published.length} published, ${skipped.length} verified existing, ${raced.length} race-resolved`,
    );
  }

  return { failures, published, raced, selected: selected.map(({ target }) => target), skipped };
}

async function main() {
  const result = await publishMissingRegistryVersions({
    manifestPaths: process.argv.slice(2),
    registryUrl: process.env.MCP_REGISTRY_URL ?? DEFAULT_REGISTRY_URL,
    runPublisher: (operation, manifestPath) =>
      runPublisherCommand(operation, manifestPath, {
        publisherPath: process.env.MCP_PUBLISHER_PATH ?? "./mcp-publisher",
      }),
  });
  if (result.failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`MCP Registry publication failed before planning: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
