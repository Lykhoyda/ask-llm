#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
interface JsonObject {
  [key: string]: JsonValue;
}
type ServerManifest = JsonObject & { name: string; version: string };
type SemanticSetField = "packages" | "environmentVariables";
type JsonPath = Array<string | number>;

interface PublisherResult {
  code: number;
  signal?: NodeJS.Signals | null;
  output: string;
}

interface Logger {
  log(message: string): void;
  error(message: string): void;
}

type FetchLike = (url: URL) => Promise<Response>;
type RunPublisher = (operation: string, manifestPath: string) => Promise<PublisherResult>;

interface RegistryLookupPayload {
  servers?: Array<{ server?: JsonValue }>;
}

type FailurePhase = "read" | "validate" | "verify" | "lookup" | "login" | "publish" | "duplicate-race";
interface Failure {
  manifestPath: string;
  target?: string;
  phase: FailurePhase;
  message: string;
}

interface SelectedCandidate {
  manifest: ServerManifest;
  manifestPath: string;
  target: string;
}

interface PublishResult {
  failures: Failure[];
  published: string[];
  raced: string[];
  selected: string[];
  skipped: string[];
}

interface PublishOptions {
  manifestPaths?: string[];
  fetchImpl?: FetchLike;
  registryUrl?: string;
  runPublisher?: RunPublisher;
  log?: Logger;
}

const DEFAULT_REGISTRY_URL = "https://registry.modelcontextprotocol.io";
const DUPLICATE_VERSION = /invalid version:\s*cannot publish duplicate version/i;
const OPTIONAL_FALSE_FIELDS = new Set(["isRequired", "isSecret"]);
const OUTPUT_LIMIT = 16_384;

function boundedTail(value: string): string {
  return value.length <= OUTPUT_LIMIT ? value : value.slice(-OUTPUT_LIMIT);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function semanticSetKey(fieldName: string, value: JsonValue): string | null {
  const record = value as JsonObject | null;
  if (fieldName === "packages") {
    return canonicalJson([
      record?.registryType ?? null,
      record?.registryBaseUrl ?? null,
      record?.identifier ?? null,
      record?.version ?? null,
      record?.fileSha256 ?? null,
      canonicalJson(value),
    ]);
  }
  if (fieldName === "environmentVariables") {
    return canonicalJson([record?.name ?? null, canonicalJson(value)]);
  }
  return null;
}

function compareCanonicalSetEntries(fieldName: SemanticSetField, left: JsonValue, right: JsonValue): number {
  const leftKey = semanticSetKey(fieldName, left);
  const rightKey = semanticSetKey(fieldName, right);
  if (leftKey === null || rightKey === null || leftKey === rightKey) return 0;
  return leftKey < rightKey ? -1 : 1;
}

function semanticSetField(path: JsonPath): SemanticSetField | null {
  if (path.length === 1 && path[0] === "packages") return "packages";
  if (path.length === 3 && path[0] === "packages" && Number.isInteger(path[1]) && path[2] === "environmentVariables") {
    return "environmentVariables";
  }
  return null;
}

function isArgumentPath(path: JsonPath): boolean {
  return (
    path.length === 4 &&
    path[0] === "packages" &&
    Number.isInteger(path[1]) &&
    ["packageArguments", "runtimeArguments"].includes(path[2] as string) &&
    Number.isInteger(path[3])
  );
}

function isInputWithVariablesPath(path: JsonPath): boolean {
  const packageInput =
    isArgumentPath(path) ||
    (path.length === 4 &&
      path[0] === "packages" &&
      Number.isInteger(path[1]) &&
      path[2] === "environmentVariables" &&
      Number.isInteger(path[3]));
  const packageHeader =
    path.length === 5 &&
    path[0] === "packages" &&
    Number.isInteger(path[1]) &&
    path[2] === "transport" &&
    path[3] === "headers" &&
    Number.isInteger(path[4]);
  const remoteHeader =
    path.length === 4 &&
    path[0] === "remotes" &&
    Number.isInteger(path[1]) &&
    path[2] === "headers" &&
    Number.isInteger(path[3]);
  return packageInput || packageHeader || remoteHeader;
}

function isSchemaInputPath(path: JsonPath): boolean {
  if (isInputWithVariablesPath(path)) return true;
  if (
    path.length === 4 &&
    path[0] === "remotes" &&
    Number.isInteger(path[1]) &&
    path[2] === "variables" &&
    typeof path[3] === "string"
  ) {
    return true;
  }
  return (
    path.length >= 2 &&
    path.at(-2) === "variables" &&
    typeof path.at(-1) === "string" &&
    isInputWithVariablesPath(path.slice(0, -2))
  );
}

function isSchemaDefaultFalse(path: JsonPath, key: string, value: JsonValue): boolean {
  if (value !== false) return false;
  if (OPTIONAL_FALSE_FIELDS.has(key)) return isSchemaInputPath(path);
  return key === "isRepeated" && isArgumentPath(path);
}

function normalizeRegistryValue(value: JsonValue, path: JsonPath = []): JsonValue {
  if (Array.isArray(value)) {
    const normalized: JsonValue[] = value.map((child, index) => normalizeRegistryValue(child, [...path, index]));
    const fieldName = semanticSetField(path);
    return fieldName !== null
      ? [...normalized].sort((left, right) => compareCanonicalSetEntries(fieldName, left, right))
      : normalized;
  }
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !isSchemaDefaultFalse(path, key, child))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizeRegistryValue(child, [...path, key])]),
  );
}

export function recordsMatch(expected: JsonValue, actual: JsonValue): boolean {
  return isDeepStrictEqual(normalizeRegistryValue(expected), normalizeRegistryValue(actual));
}

function identity(manifest: ServerManifest): string {
  return `${manifest.name}@${manifest.version}`;
}

async function responseDetail(response: Response): Promise<string> {
  try {
    return boundedTail(await response.text());
  } catch {
    return "<response body unavailable>";
  }
}

export async function lookupExactRecord(
  manifest: ServerManifest,
  { fetchImpl = fetch, registryUrl = DEFAULT_REGISTRY_URL }: { fetchImpl?: FetchLike; registryUrl?: string } = {},
): Promise<ServerManifest | null> {
  const url = new URL("/v0/servers", registryUrl);
  url.searchParams.set("search", manifest.name);
  url.searchParams.set("version", manifest.version);

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(
      `Registry lookup for ${identity(manifest)} returned HTTP ${response.status}: ${await responseDetail(response)}`,
    );
  }

  const payload = (await response.json()) as RegistryLookupPayload;
  if (!Array.isArray(payload.servers)) {
    throw new Error(`Registry lookup for ${identity(manifest)} returned an invalid response: missing servers array`);
  }

  const matches = payload.servers
    .map((entry) => entry?.server)
    .filter((server): server is ServerManifest => {
      const record = server as JsonObject | undefined;
      return record?.name === manifest.name && record?.version === manifest.version;
    });

  if (matches.length > 1) {
    throw new Error(`Registry lookup for ${identity(manifest)} returned ${matches.length} exact records`);
  }

  return matches[0] ?? null;
}

export function runPublisherCommand(
  operation: string,
  manifestPath: string,
  { publisherPath = "./mcp-publisher" }: { publisherPath?: string } = {},
): Promise<PublisherResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(publisherPath, [operation, manifestPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";

    const capture = (stream: NodeJS.ReadableStream, destination: NodeJS.WritableStream): void => {
      stream.on("data", (chunk: Buffer | string) => {
        const text = chunk.toString();
        destination.write(text);
        output = boundedTail(output + text);
      });
    };
    capture(child.stdout as NodeJS.ReadableStream, process.stdout);
    capture(child.stderr as NodeJS.ReadableStream, process.stderr);

    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code: code ?? 1, signal, output });
    });
  });
}

function failureMessage(result: PublisherResult): string {
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
}: PublishOptions = {}): Promise<PublishResult> {
  if (!Array.isArray(manifestPaths) || manifestPaths.length === 0) {
    throw new Error("At least one server.json path is required");
  }

  const failures: Failure[] = [];
  const selected: SelectedCandidate[] = [];
  const skipped: string[] = [];
  const published: string[] = [];
  const raced: string[] = [];

  for (const manifestPath of manifestPaths) {
    let manifest: ServerManifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ServerManifest;
    } catch (error) {
      failures.push({ manifestPath, phase: "read", message: (error as Error).message });
      continue;
    }

    const target = identity(manifest);
    let validation: PublisherResult;
    try {
      validation = await runPublisher("validate", manifestPath);
    } catch (error) {
      failures.push({ manifestPath, target, phase: "validate", message: (error as Error).message });
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
      failures.push({ manifestPath, target, phase: "lookup", message: (error as Error).message });
    }
  }

  if (selected.length > 0) {
    let login: PublisherResult | undefined;
    try {
      login = await runPublisher("login", "github-oidc");
    } catch (error) {
      failures.push({ manifestPath: "<publisher>", phase: "login", message: (error as Error).message });
    }
    if (login && login.code !== 0) {
      failures.push({ manifestPath: "<publisher>", phase: "login", message: failureMessage(login) });
    }
  }

  const loginFailed = failures.some(({ phase }) => phase === "login");
  for (const candidate of loginFailed ? [] : selected) {
    const { manifest, manifestPath, target } = candidate;
    log.log(`Publishing missing MCP Registry record ${target}`);

    let result: PublisherResult;
    try {
      result = await runPublisher("publish", manifestPath);
    } catch (error) {
      failures.push({ manifestPath, target, phase: "publish", message: (error as Error).message });
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
      failures.push({ manifestPath, target, phase: "duplicate-race", message: (error as Error).message });
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

async function main(): Promise<void> {
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
