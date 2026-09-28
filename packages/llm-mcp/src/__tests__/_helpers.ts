import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = path.resolve(here, "..", "..");
export const REPO_ROOT = path.resolve(PLUGIN_ROOT, "..", "..");

export function readFile(rel: string): string {
  return fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf-8");
}

export function readJson<T = unknown>(rel: string): T {
  return JSON.parse(readFile(rel)) as T;
}

export function listSubdirs(rel: string): string[] {
  const dir = path.join(PLUGIN_ROOT, rel);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

export function listFiles(rel: string, ext: string): string[] {
  const dir = path.join(PLUGIN_ROOT, rel);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext))
    .map((e) => e.name);
}

export interface ParsedMarkdown {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

export function parseMarkdownFrontmatter(content: string): ParsedMarkdown {
  if (!content.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }
  const lines = content.split("\n");
  if (lines[0].trim() !== "---") {
    return { frontmatter: {}, body: content };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string | string[]> = {};
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;

  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    const arrayMatch = line.match(/^\s+-\s+(.+)$/);
    if (arrayMatch && currentKey && currentArray) {
      currentArray.push(arrayMatch[1].trim());
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const rawValue = kvMatch[2].trim();
    if (rawValue === "") {
      currentKey = key;
      currentArray = [];
      frontmatter[key] = currentArray;
    } else {
      frontmatter[key] = rawValue;
      currentKey = null;
      currentArray = null;
    }
  }

  return { frontmatter, body: lines.slice(endIdx + 1).join("\n") };
}
