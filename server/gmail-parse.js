// Pure functions that turn a Gmail API message (format=full) into our canonical message document.
// No I/O here, so it's easy to test and reuse for sample data.

const BODY_LIMIT = 20_000; // characters of plain text we keep per email
const HEADER_LIMIT = 120;

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com",
]);

const AUTOMATED_SENDER = /(no-?reply|do-?not-?reply|notifications?@|mailer-daemon|postmaster@|bounce)/i;
const BULK_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];

export function decodeBase64Url(data = "") {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function parseAddress(raw = "") {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2] : raw).trim().toLowerCase();
  const name = (m ? m[1].trim() : "") || email;
  return { name, email, domain: email.split("@")[1] || "" };
}

/** Splits "A <a@x>, "B, Jr" <b@y>, c@z" into addresses, respecting quotes and angle brackets. */
export function parseAddressList(raw = "") {
  const out = [];
  let cur = "";
  let quoted = false;
  let angle = false;
  for (const ch of raw) {
    if (ch === '"') quoted = !quoted;
    if (ch === "<") angle = true;
    if (ch === ">") angle = false;
    if (ch === "," && !quoted && !angle) {
      if (cur.trim()) out.push(parseAddress(cur));
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(parseAddress(cur));
  return out.filter((a) => a.email.includes("@"));
}

function headerMap(headers = []) {
  const map = {};
  for (const h of headers) {
    const k = h.name.toLowerCase();
    if (!(k in map)) map[k] = h.value; // first occurrence wins (e.g. many "Received")
  }
  return map;
}

function* walkParts(part) {
  if (!part) return;
  yield part;
  for (const p of part.parts || []) yield* walkParts(p);
}

function htmlToText(html) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/** Plain-text body: prefer text/plain, fall back to stripped text/html. Attachments are skipped. */
export function extractBody(payload) {
  let plain = "";
  let html = "";
  for (const p of walkParts(payload)) {
    if (p.filename || !p.body?.data) continue;
    if (p.mimeType === "text/plain" && !plain) plain = decodeBase64Url(p.body.data);
    if (p.mimeType === "text/html" && !html) html = decodeBase64Url(p.body.data);
  }
  const text = plain || (html ? htmlToText(html) : "");
  return { text: text.slice(0, BODY_LIMIT), truncated: text.length > BODY_LIMIT, hasHtml: Boolean(html) };
}

export function extractAttachments(payload) {
  const list = [];
  for (const p of walkParts(payload)) {
    if (!p.filename) continue;
    const disposition = (p.headers || []).find((h) => h.name.toLowerCase() === "content-disposition")?.value || "";
    list.push({
      filename: p.filename,
      mimeType: p.mimeType,
      size: p.body?.size ?? 0,
      attachmentId: p.body?.attachmentId ?? null,
      partId: p.partId,
      inline: /^inline/i.test(disposition),
    });
  }
  return list;
}

function hasCalendar(payload) {
  for (const p of walkParts(payload)) if (p.mimeType === "text/calendar" || /\.ics$/i.test(p.filename || "")) return true;
  return false;
}

function splitIds(v = "") {
  return (v.match(/<[^>]+>/g) || []).map((s) => s.toLowerCase());
}

export function isFreeMail(domain) {
  return FREE_MAIL.has(domain);
}

/**
 * Gmail message (format=full) → canonical document. `account` is the connected address.
 * Body text is returned separately so the caller can encrypt it before storing.
 */
export function normalizeMessage(m, account) {
  const self = account.toLowerCase();
  const selfDomain = self.split("@")[1] || "";
  const headers = (m.payload?.headers || []).slice(0, HEADER_LIMIT);
  const h = headerMap(headers);
  const labels = m.labelIds || [];

  const from = parseAddress(h.from || "");
  const to = parseAddressList(h.to);
  const cc = parseAddressList(h.cc);
  const bcc = parseAddressList(h.bcc);
  const replyTo = h["reply-to"] ? parseAddressList(h["reply-to"])[0] ?? null : null;
  const direction = labels.includes("SENT") || from.email === self ? "out" : "in";

  const autoSubmitted = h["auto-submitted"] || null;
  const isAutomated =
    (autoSubmitted && autoSubmitted.toLowerCase() !== "no") ||
    Boolean(h["x-autoreply"] || h["x-autorespond"]) ||
    AUTOMATED_SENDER.test(from.email);
  const precedence = (h.precedence || "").toLowerCase();
  const isBulk =
    Boolean(h["list-unsubscribe"] || h["list-id"]) ||
    ["bulk", "list", "junk"].includes(precedence) ||
    labels.some((l) => BULK_LABELS.includes(l));

  // Internal = same company domain. With a free-mail account (gmail.com…), only you are internal.
  const isInternal = direction === "out" || (!isFreeMail(selfDomain) && from.domain === selfDomain);

  const attachments = extractAttachments(m.payload);
  const body = extractBody(m.payload);

  return {
    doc: {
      gmailId: m.id,
      threadId: m.threadId,
      historyId: m.historyId ?? null,
      date: new Date(Number(m.internalDate)),
      sentAt: h.date ? new Date(h.date) : null,
      sizeEstimate: m.sizeEstimate ?? null,
      labelIds: labels,
      isUnread: labels.includes("UNREAD"),
      isStarred: labels.includes("STARRED"),
      isImportant: labels.includes("IMPORTANT"),
      category: (labels.find((l) => l.startsWith("CATEGORY_")) || "").replace("CATEGORY_", "").toLowerCase() || null,
      direction,
      isInternal,
      isAutomated,
      isBulk,
      from,
      replyTo,
      to,
      cc,
      bcc,
      deliveredTo: h["delivered-to"] || null,
      subject: h.subject || "(no subject)",
      snippet: m.snippet || "",
      messageId: (h["message-id"] || "").toLowerCase() || null,
      inReplyTo: splitIds(h["in-reply-to"])[0] ?? null,
      references: splitIds(h.references),
      listUnsubscribe: h["list-unsubscribe"] || null,
      listId: h["list-id"] || null,
      precedence: precedence || null,
      autoSubmitted,
      contentType: h["content-type"] || null,
      attachments,
      hasAttachments: attachments.some((a) => !a.inline),
      hasCalendarInvite: hasCalendar(m.payload),
      bodyTruncated: body.truncated,
      hasHtml: body.hasHtml,
      headers, // every top-level header, as Gmail sent it
      source: "gmail",
    },
    bodyText: body.text,
  };
}
