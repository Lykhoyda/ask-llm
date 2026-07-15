import { closeSync, existsSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { withAntigravityInvocationLock } from "../../invocationLock.js";

const [baseDir, markerDir, workerId, releasePath = ""] = process.argv.slice(2);

writeFileSync(join(markerDir, `attempt-${workerId}`), "");

await withAntigravityInvocationLock(baseDir, async () => {
  const activePath = join(markerDir, "active");
  let activeFile: number | undefined;
  try {
    activeFile = openSync(activePath, "wx", 0o600);
  } catch {
    writeFileSync(join(markerDir, `overlap-${workerId}`), "");
  }
  writeFileSync(join(markerDir, `enter-${workerId}`), "");
  while (releasePath && !existsSync(releasePath)) await delay(10);
  if (activeFile !== undefined) closeSync(activeFile);
  rmSync(activePath, { force: true });
  writeFileSync(join(markerDir, `exit-${workerId}`), "");
});
