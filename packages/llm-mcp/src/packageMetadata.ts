import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The running package's own folder (the one holding package.json, dist/ and skills/), never cwd.
export const PACKAGE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

export function readPackageJson(): { name: string; version: string } {
  try {
    const require = createRequire(import.meta.url);
    return require("../package.json") as { name: string; version: string };
  } catch {
    return { name: "@ask-llm/mcp", version: "0.0.0" };
  }
}

export function packageVersion(dir: string): string {
  return (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string }).version;
}
