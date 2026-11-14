// What the AI may read beyond subjects and previews: the body text of an email and the text inside its attachments.
// (decision #32). Everything returned here is untrusted email content: callers put it in the user turn only, escaped,
// and the system prompt tells the model never to follow instructions inside it.
//
// Limits keep cost, latency and exposure bounded:
// - bodies: quoted history and signatures-after-"--" are cut, email addresses are redacted, then truncated;
// - attachments: only PDF, Word (.docx), plain text, CSV, Markdown and HTML, at most 5 MB, text truncated;
// - attachment text is cached in `attachment_text`, encrypted like bodies, so each file is fetched from Gmail once.
import { getDb } from "../db.js";
import { decrypt, encrypt } from "../crypto.js";
import { fetchAttachment } from "../gmail.js";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EXTRACT_CHARS = 20_000; // stored per attachment; callers ask for less
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

const squeeze = (s) => s.replace(/\r/g, "").replace(/[ \t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Drops the quoted previous conversation and anything after a "-- " signature marker. */
export function stripQuoted(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^(On .{3,200}wrote:|Le .{3,200}a écrit\s?:|Am .{3,200}schrieb .{0,80}:)$/i.test(t)) break;
    if (/^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(t)) break;
    // Outlook-style quoted header block: "From: …" followed shortly by "Sent:" or "Date:".
    if (/^From:\s/i.test(t) && out.length > 2 && lines.slice(i + 1, i + 4).some((l) => /^(Sent|Date):/i.test(l.trim()))) break;
    if (t === "--") break;
    if (t.startsWith(">")) continue;
    out.push(lines[i]);
  }
  return out.join("\n");
}

/** The readable body of one stored message (needs `bodyEnc`), cleaned and truncated, or "" when there is none. */
export function messageBody(m, maxChars) {
  if (!m?.bodyEnc) return "";
  let text;
  try {
    text = decrypt(m.bodyEnc);
  } catch {
    return ""; // encrypted with another TOKEN_SECRET
  }
  if (typeof text !== "string") return "";
  return clip(squeeze(stripQuoted(text)).replace(EMAIL, "[email]"), maxChars);
}

/** Attachments worth reading: real files of a type we can turn into text, not too big. */
export function readableAttachments(m) {
  return (m?.attachments ?? []).filter(
    (a) => !a.inline && a.attachmentId && (a.size ?? 0) <= MAX_FILE_BYTES && kindOf(a) !== null && !/\.ics$/i.test(a.filename || "")
  );
}

function kindOf(a) {
  const name = (a.filename || "").toLowerCase();
  const type = a.mimeType || "";
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (type.includes("wordprocessingml") || name.endsWith(".docx")) return "docx";
  if (type === "text/html" || /\.html?$/.test(name)) return "html";
  if (type.startsWith("text/") || /\.(txt|csv|md|tsv|json)$/.test(name)) return "text";
  return null;
}

async function extract(kind, buf) {
  if (kind === "pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : text;
  }
  if (kind === "docx") {
    const mammoth = (await import("mammoth")).default;
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  const raw = buf.toString("utf8");
  if (kind === "html") return raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  return raw;
}

/**
 * Text inside one attachment of a stored message, truncated to maxChars. Fetches from Gmail only the first time;
 * failures are cached too, so a broken file isn't retried on every run. Returns "" when there's no text.
 */
export async function attachmentText(m, a, maxChars) {
  const kind = kindOf(a);
  if (!kind || m.source !== "gmail" || !a.attachmentId || (a.size ?? 0) > MAX_FILE_BYTES) return "";
  const col = getDb().collection("attachment_text");
  const _id = `${m.gmailId}:${a.partId}`;
  const cached = await col.findOne({ _id });
  if (cached) {
    if (cached.status !== "ok") return "";
    try {
      return clip(decrypt(cached.textEnc), maxChars);
    } catch {
      return "";
    }
  }
  try {
    const { data } = await fetchAttachment(m.gmailId, a.attachmentId);
    const text = clip(squeeze(await extract(kind, data)).replace(EMAIL, "[email]"), MAX_EXTRACT_CHARS);
    await col.updateOne(
      { _id },
      { $set: { gmailId: m.gmailId, filename: a.filename, kind, status: text ? "ok" : "empty", chars: text.length, textEnc: text ? encrypt(text) : null, extractedAt: new Date() } },
      { upsert: true }
    );
    return clip(text, maxChars);
  } catch (err) {
    // Never log file contents; the reason is enough.
    await col.updateOne({ _id }, { $set: { gmailId: m.gmailId, filename: a.filename, kind, status: "failed", error: String(err.message).slice(0, 200), extractedAt: new Date() } }, { upsert: true });
    return "";
  }
}

/** Text of up to `maxFiles` readable attachments of a message: [{ name, text }] (files without text are left out). */
export async function attachmentsText(m, { maxFiles, maxChars }) {
  const out = [];
  for (const a of readableAttachments(m).slice(0, maxFiles)) {
    const text = await attachmentText(m, a, maxChars);
    if (text) out.push({ name: a.filename, text });
  }
  return out;
}
