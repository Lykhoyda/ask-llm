export type Frontmatter = Record<string, string | number | boolean>;

export function parseFrontmatter(content: unknown): { frontmatter: Frontmatter; body: string; malformed: boolean } {
  if (typeof content !== "string" || content.length === 0) {
    return { frontmatter: {}, body: "", malformed: false };
  }
  const firstNewline = content.indexOf("\n");
  if (firstNewline === -1) return { frontmatter: {}, body: content, malformed: false };
  const opener = content.slice(0, firstNewline).replace(/\r$/, "");
  if (opener !== "---") return { frontmatter: {}, body: content, malformed: false };

  const rest = content.slice(firstNewline + 1);
  const closerMatch = rest.match(/^---\s*$/m);
  if (!closerMatch || typeof closerMatch.index !== "number") {
    return { frontmatter: {}, body: content, malformed: true };
  }

  const fmText = rest.slice(0, closerMatch.index);
  let body = rest.slice(closerMatch.index + closerMatch[0].length);
  if (body.startsWith("\r")) body = body.slice(1);
  if (body.startsWith("\n")) body = body.slice(1);

  const frontmatter: Frontmatter = {};
  for (const rawLine of fmText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (key.length === 0) continue;
    let valueRaw = line.slice(colon + 1);
    // Strip inline comment, but only when `#` follows whitespace.
    const inlineComment = valueRaw.match(/\s+#.*$/);
    if (inlineComment && typeof inlineComment.index === "number") {
      valueRaw = valueRaw.slice(0, inlineComment.index);
    }
    let value = valueRaw.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value === "true") frontmatter[key] = true;
    else if (value === "false") frontmatter[key] = false;
    else if (/^-?\d+$/.test(value)) frontmatter[key] = Number(value);
    else if (/^-?\d+\.\d+$/.test(value)) frontmatter[key] = Number(value);
    else frontmatter[key] = value;
  }
  return { frontmatter, body, malformed: false };
}
