// Plain-text email arrives hard-wrapped at ~72 characters. These helpers turn it back into readable paragraphs
// for the email viewer, and separate the quoted earlier conversation so it can be folded away.

const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/;
const QUOTE_START = [
  /^On .{3,200}wrote:\s*$/i,
  /^Le .{3,200}a écrit\s?:\s*$/i,
  /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}\s*$/i,
  /^>/,
];
/** A line at least this long was probably cut by the sender's line wrapping, so the next line continues it. */
const WRAPPED_LINE = 50;

/** Paragraphs of the email. Within a paragraph, list items, greetings and sign-offs keep their own lines. */
export function reflowEmail(text: string): string[] {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  if (!clean) return [];
  return clean.split(/\n[ \t]*\n+/).map((block) => {
    const out: string[] = [];
    let lastRaw = 0;
    for (const raw of block.split("\n")) {
      const line = raw.trimEnd();
      const startsNew = LIST_ITEM.test(line) || line.startsWith(">");
      if (out.length && !startsNew && lastRaw >= WRAPPED_LINE) out[out.length - 1] += ` ${line.trim()}`;
      else out.push(line);
      lastRaw = line.length;
    }
    return out.join("\n");
  });
}

/** The new part of an email and the quoted earlier conversation below it ("" when there is none). */
export function splitQuoted(text: string): { main: string; quoted: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const at = lines.findIndex((l) => QUOTE_START.some((re) => re.test(l.trim())));
  if (at < 0) return { main: text.trim(), quoted: "" };
  return { main: lines.slice(0, at).join("\n").trim(), quoted: lines.slice(at).join("\n").trim() };
}
