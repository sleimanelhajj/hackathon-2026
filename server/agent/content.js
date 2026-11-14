// What the AI may read beyond subjects and previews: the body text of an email and the text inside its attachments.
// (decision #32). Everything returned here is untrusted email content: callers put it in the user turn only, escaped,
// and the system prompt tells the model never to follow instructions inside it.
//
// Limits keep cost, latency and exposure bounded:
// - bodies: quoted history and signatures-after-"--" are cut, email addresses are redacted, then truncated;
// - attachments (decision #43): PDF (scanned too), Word, Excel, PowerPoint, images, calendar invites, ZIP folders,
//   text, CSV, Markdown and HTML, at most 10 MB; see server/agent/files.js for each reader and the ZIP safety limits;
//   images and scanned PDFs are read by Gemini vision (server/agent/vision.js) only when a Gemini key is set;
// - attachment text is cached in `attachment_text`, encrypted like bodies, so each file is fetched and read once.
import { getDb } from "../db.js";
import { decrypt, encrypt } from "../crypto.js";
import { fetchAttachment } from "../gmail.js";
import { extractText, kindOf } from "./files.js";
import { describeFile } from "./vision.js";
import { GeminiError, geminiConfigured } from "./llm.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
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

/** Attachments worth reading: real files (not inline layout images) of a type we can read, not too big. */
export function readableAttachments(m) {
  return (m?.attachments ?? []).filter((a) => !a.inline && a.attachmentId && (a.size ?? 0) <= MAX_FILE_BYTES && kindOf(a) !== null);
}

/** Reads one file; images and scanned PDFs go to Gemini vision only when it's configured. */
function extract(a, data) {
  return extractText({ filename: a.filename, mimeType: a.mimeType, data }, { describe: geminiConfigured() ? describeFile : undefined });
}

/** Bumped when the readers change, so files that gave no text before are read again (decision #43 = 2). */
export const READER_VERSION = 2;

/** A cached result from an older reader that had no text: read the file again. */
export function isStale(cached) {
  return cached.status !== "ok" && cached.reader !== READER_VERSION;
}

/**
 * What to store for a read: "ok" (text), "empty" (no text), "failed" (a broken file) or null (don't cache, try again
 * next run). Not cached: a temporary Gemini failure, and an image or PDF read without vision (it may be a scan that
 * becomes readable once GEMINI_API_KEY is set).
 */
export function cacheDecision({ kind, text = "", error = null, visionOn }) {
  if (error) return error instanceof GeminiError && (error.retryable || error.status === 429 || error.status >= 500) ? null : "failed";
  if (text) return "ok";
  if (!visionOn && (kind === "image" || kind === "pdf")) return null;
  return "empty";
}

/**
 * Text inside one attachment of a stored message, truncated to maxChars. Fetches from Gmail only the first time;
 * broken files are cached too, so they aren't retried on every run (see cacheDecision). Returns "" when there's no text.
 */
export async function attachmentText(m, a, maxChars) {
  const kind = kindOf(a);
  if (!kind || m.source !== "gmail" || !a.attachmentId || (a.size ?? 0) > MAX_FILE_BYTES) return "";
  const col = getDb().collection("attachment_text");
  const _id = `${m.gmailId}:${a.partId}`;
  const cached = await col.findOne({ _id });
  if (cached && !isStale(cached)) {
    if (cached.status !== "ok") return "";
    try {
      return clip(decrypt(cached.textEnc), maxChars);
    } catch {
      return "";
    }
  }
  const visionOn = geminiConfigured();
  const meta = { gmailId: m.gmailId, filename: a.filename, kind, reader: READER_VERSION, extractedAt: new Date() };
  try {
    const { data } = await fetchAttachment(m.gmailId, a.attachmentId);
    const text = clip(squeeze(await extract(a, data)).replace(EMAIL, "[email]"), MAX_EXTRACT_CHARS);
    const status = cacheDecision({ kind, text, visionOn });
    if (status) {
      await col.updateOne({ _id }, { $set: { ...meta, status, chars: text.length, textEnc: text ? encrypt(text) : null } }, { upsert: true });
    }
    return clip(text, maxChars);
  } catch (err) {
    // Never log file contents; the reason is enough.
    const status = cacheDecision({ kind, error: err, visionOn });
    if (status) await col.updateOne({ _id }, { $set: { ...meta, status, error: String(err.message).slice(0, 200) } }, { upsert: true });
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
