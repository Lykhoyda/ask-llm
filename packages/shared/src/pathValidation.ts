import { isAbsolute } from "node:path";
import { z } from "zod";

/**
 * Element schema for includeDirs-style tool parameters. Directories handed to
 * provider CLIs (`--include-directories`, `--add-dir`) must stay inside the
 * workspace: traversal, absolute, and home-relative paths would widen what the
 * external CLI can read far beyond the repo the user pointed it at.
 */
export const relativeDirSchema = z
  .string()
  .refine((dir) => !dir.includes("..") && !isAbsolute(dir) && !dir.startsWith("~"), {
    message: "Directory paths must be relative without '..' or '~'",
  });
