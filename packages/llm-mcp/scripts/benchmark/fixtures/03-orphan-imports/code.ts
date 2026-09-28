// Task given to Claude: "Remove the legacy `formatV1` function — it's
// been replaced by `formatV2` everywhere."

import { z } from "zod";
import { format as formatDate } from "date-fns";
import { encodeBase64, decodeBase64 } from "./codec";
import { logger } from "./logger";

const userSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
});

export function formatV2(user: { id: string; createdAt: Date }): string {
  const safeId = encodeBase64(user.id);
  const dateStr = formatDate(user.createdAt, "yyyy-MM-dd");
  return `${safeId}@${dateStr}`;
}

export function parseUser(raw: unknown) {
  return userSchema.parse(raw);
}
