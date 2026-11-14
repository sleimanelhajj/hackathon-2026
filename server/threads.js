// The full-email view of one conversation, for the reader in the app (GET /api/threads/:threadId).
// Unlike what goes to the AI (server/agent/content.js), the person sees the whole body, quoted history included.
// Encrypted bodies are decrypted here, on the server, and only the text leaves; raw headers and ids never do.
import { decrypt } from "./crypto.js";

function readBody(m) {
  if (!m.bodyEnc) return m.snippet || "";
  try {
    const text = decrypt(m.bodyEnc);
    return typeof text === "string" && text.trim() ? text.replace(/\r/g, "").trim() : m.snippet || "";
  } catch {
    return m.snippet || ""; // encrypted with another TOKEN_SECRET
  }
}

const addr = (a) => ({ name: a?.name || "", email: a?.email || "" });

/** `list`: the conversation's stored messages, oldest first. `extraction`: its AI label, or null. */
export function threadView(list, extraction) {
  const last = list.at(-1);
  return {
    threadId: last.threadId,
    subject: last.subject || "(no subject)",
    link: last.source === "gmail" ? `https://mail.google.com/mail/u/0/#all/${last.threadId}` : null,
    ai: extraction
      ? {
          summary: extraction.summary,
          category: extraction.correction?.category ?? extraction.category,
          priority: extraction.priority ?? null,
          needsReply: extraction.needsReply ?? false,
          suggestedAction: extraction.suggestedAction ?? null,
          reason: extraction.reason ?? null,
        }
      : null,
    messages: list.map((m) => ({
      gmailId: m.gmailId,
      direction: m.direction,
      date: m.date,
      from: addr(m.from),
      to: (Array.isArray(m.to) ? m.to : []).map(addr),
      cc: (Array.isArray(m.cc) ? m.cc : []).map(addr),
      body: readBody(m),
      attachments: (m.attachments ?? [])
        .filter((a) => !a.inline)
        .map((a) => ({
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          gmailId: m.gmailId,
          attachmentId: a.attachmentId ?? null,
          downloadable: m.source === "gmail" && Boolean(a.attachmentId),
        })),
    })),
  };
}
