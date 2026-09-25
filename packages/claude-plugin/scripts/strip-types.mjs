// Node refuses to strip TypeScript under node_modules, where npm places this package; strip it here.
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith("file:") || !url.endsWith(".ts") || !url.includes("/node_modules/")) {
      return nextLoad(url, context);
    }
    const source = stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"));
    return { format: "module", source, shortCircuit: true };
  },
});
