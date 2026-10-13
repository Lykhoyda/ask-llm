import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps/docs/.vitepress/dist");
const base = "/ask-llm/";
const origin = "https://lykhoyda.github.io";
const errors: string[] = [];
const cache = new Map<string, string>();
let checked = 0;

function html(path: string): string {
  let source = cache.get(path);
  if (source === undefined) {
    source = readFileSync(path, "utf8");
    cache.set(path, source);
  }
  return source;
}

function destination(url: URL): string | undefined {
  if (url.origin !== origin || !url.pathname.startsWith(base)) return undefined;
  const path = resolve(dist, `.${decodeURIComponent(url.pathname.slice(base.length - 1))}`);
  if (path !== dist && !path.startsWith(`${dist}/`)) return undefined;
  if (existsSync(path) && statSync(path).isDirectory()) return join(path, "index.html");
  if (existsSync(path)) return path;
  return `${path}.html`;
}

function walk(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith(".html")) {
      const pageUrl = new URL(base + relative(dist, path), origin);
      for (const match of html(path).matchAll(/\bhref="([^"]+)"/g)) {
        const href = match[1].replaceAll("&amp;", "&");
        const url = new URL(href, pageUrl);
        let target = destination(url);
        if (!target) continue;
        checked++;
        if (!existsSync(target)) {
          errors.push(`${relative(dist, path)}: missing ${href}`);
          continue;
        }
        if (!url.hash || !target.endsWith(".html")) continue;
        const fragment = decodeURIComponent(url.hash.slice(1));
        if (html(target).includes(`id="${fragment}"`)) continue;
        // Old routes are redirect pages; validate their fragments against the destination.
        for (let hops = 0; hops < 5; hops++) {
          const moved = html(target).match(/http-equiv="refresh"[^>]*content="0; url=([^"]+)"/i)?.[1];
          if (!moved) break;
          target = destination(new URL(moved, pageUrl));
          if (!target || !existsSync(target)) break;
        }
        if (!target || !existsSync(target) || !html(target).includes(`id="${fragment}"`)) {
          errors.push(`${relative(dist, path)}: missing anchor ${href}`);
        }
      }
    }
  }
}

walk(dist);
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exit(1);
}
console.log(`Docs link check passed (${checked} internal links, including anchors and redirects).`);
