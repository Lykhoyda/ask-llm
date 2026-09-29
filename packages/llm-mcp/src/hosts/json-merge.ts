import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export interface JsonEdit {
  keyPath: string[];
  // undefined deletes the key.
  value: unknown;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function realTarget(file: string): string {
  try {
    return realpathSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let link = false;
  try {
    link = lstatSync(file).isSymbolicLink();
  } catch {}
  if (link) throw new Error(`${file} is a dangling symlink; not changed`);
  return file;
}

function readExisting(file: string): string | undefined {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error(`${file} is not valid UTF-8; not changed`);
  return text;
}

// Digits and exponent with no insignificant zeros, so 1.0, 1 and 10e-1 compare equal.
function decimal(number: string): string {
  const [, sign = "", int = "", fraction = "", exponent = "0"] =
    /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(number) ?? [];
  const digits = `${int}${fraction}`.replace(/^0+/, "");
  const significant = digits.replace(/0+$/, "");
  if (!significant) return "0";
  return `${sign}${significant}e${Number(exponent) - fraction.length + digits.length - significant.length}`;
}

// JSON.parse would silently round these, so rewriting the file would change an unrelated setting.
function lossless(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (context?.source !== undefined && decimal(context.source) !== decimal(JSON.stringify(value))))
  )
    throw new RangeError("holds a number that would change when rewritten");
  return value;
}

function serialize(root: JsonObject, before: string | undefined): string {
  if (before === undefined) return `${JSON.stringify(root, null, 2)}\n`;
  const indent = /\n([ \t]+)\S/.exec(before)?.[1] ?? (before.trim().includes("\n") ? 2 : 0);
  const text = `${JSON.stringify(root, null, indent)}${before.endsWith("\n") ? "\n" : ""}`;
  return before.includes("\r\n") ? text.replaceAll("\n", "\r\n") : text;
}

// A crash between write and rename leaves the fixed-name temp file; the next run then stops instead of guessing.
function replaceAtomically(target: string, text: string, mode: number, before: string | undefined): void {
  const temp = `${target}.ask-llm-tmp`;
  let fd: number;
  try {
    fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(`${temp} exists from an interrupted write; inspect and delete it, then retry`);
    throw error;
  }
  try {
    writeFileSync(fd, text);
    fchmodSync(fd, mode);
    fsyncSync(fd);
    closeSync(fd);
    if (readExisting(target) !== before) throw new Error(`${target} changed while it was being updated; not changed`);
    renameSync(temp, target);
  } catch (error) {
    try {
      closeSync(fd);
    } catch {}
    unlinkSync(temp);
    throw error;
  }
}

export function writeJsonKey(
  file: string,
  keyPath: string[],
  value: unknown,
  check: (current: unknown) => string | undefined,
): void {
  const target = realTarget(file);
  const before = readExisting(target);
  let root: unknown = {};
  if (before !== undefined) {
    try {
      root = JSON.parse(before, lossless);
    } catch (error) {
      throw new Error(`${target} ${error instanceof RangeError ? error.message : "is not plain JSON"}; not changed`);
    }
  }
  if (!isObject(root)) throw new Error(`${target} does not hold a JSON object; not changed`);

  let parent = root;
  for (const key of keyPath.slice(0, -1)) {
    if (!Object.hasOwn(parent, key)) parent[key] = {};
    const next = parent[key];
    if (!isObject(next)) throw new Error(`${key} in ${target} is not a JSON object; not changed`);
    parent = next;
  }
  const key = keyPath[keyPath.length - 1];
  const refused = check(parent[key]);
  if (refused) throw new Error(refused);
  if (value === undefined) delete parent[key];
  else parent[key] = value;

  if (before === undefined) mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const mode = before === undefined ? 0o600 : statSync(target).mode & 0o7777;
  replaceAtomically(target, serialize(root, before), mode, before);
}
