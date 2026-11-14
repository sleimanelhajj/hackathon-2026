import { getDb } from "./db.js";
import { BREAKDOWN_RULES, LIST_RULES } from "../shared/spec.js";

// ---------------------------------------------------------------------------
// Default business rules.
// Every number here is computed from fields Gmail returned (labels, headers, attachments,
// dates, addresses). No keyword guessing and no model: nothing is inferred from email text.
// Rule ids and their titles live in shared/spec.js (LIST_RULES / BREAKDOWN_RULES).
// ---------------------------------------------------------------------------

import { geminiConfigured } from "./agent/llm.js";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export const AUTOMATED = /(no-?reply|do-?not-?reply|notifications?@|mailer-daemon|newsletter|bounce)/i;
const DAY = 24 * 60 * 60 * 1000;
const RECENT_DAYS = 7;


function gmailLink(m) {
  return m.source === "gmail" ? `https://mail.google.com/mail/u/0/#all/${m.threadId}` : null;
}

function contactOf(m) {
  if (m.direction === "in") return m.from.name || m.from.email;
  const first = m.to?.[0];
  return first ? first.name || first.email : "(no recipient)";
}


const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** A message as a list row: what the rule-list widgets render. */
function messageItem(m, detail) {
  return {
    id: m.gmailId,
    threadId: m.threadId,
    contact: contactOf(m),
    title: m.subject,
    detail: detail ?? m.snippet,
    at: m.date,
    link: gmailLink(m),
  };
}

export async function buildDashboard() {
  const db = getDb();
  const conn = await db.collection("connections").findOne({ provider: "gmail" });
  if (!conn) return { connected: false };

  const now = Date.now();
  const since = new Date(now - 30 * DAY);
  const recent = now - RECENT_DAYS * DAY;
  const account = (conn.email || "").toLowerCase();
  const messages = await db.collection("messages").find({ date: { $gte: since } }).sort({ date: 1 }).toArray();
  const labels = await db.collection("labels").find({}).toArray();

  // Older sync format compatibility: messages without the new flags.
  for (const m of messages) {
    m.from = m.from || { name: "", email: "" };
    m.from.domain = m.from.domain || (m.from.email.split("@")[1] ?? "");
    m.to = Array.isArray(m.to) ? m.to : [];
    m.cc = m.cc || [];
    m.attachments = m.attachments || [];
    m.isAutomated = m.isAutomated ?? /(no-?reply|notifications?@|mailer-daemon)/i.test(m.from.email);
    m.isBulk = m.isBulk ?? false;
  }

  const inbound = messages.filter((m) => m.direction === "in");
  const outbound = messages.filter((m) => m.direction === "out");
  const human = (m) => !m.isAutomated && !m.isBulk;

  // ---- threads: waiting on you / them --------------------------------------------------------
  const threads = new Map();
  for (const m of messages) {
    if (!threads.has(m.threadId)) threads.set(m.threadId, []);
    threads.get(m.threadId).push(m);
  }
  const awaitingYou = [];
  const awaitingThem = [];
  for (const list of threads.values()) {
    const last = list[list.length - 1];
    const waitingDays = Math.floor((now - last.date.getTime()) / DAY);
    const row = {
      threadId: last.threadId,
      subject: last.subject,
      snippet: last.snippet,
      contact: contactOf(last),
      lastAt: last.date,
      waitingDays,
      messages: list.length,
      link: gmailLink(last),
    };
    // Waiting on you: a person wrote last, you were a direct recipient, and it isn't an invite to RSVP.
    const ccOnlyLast = last.cc.some((a) => a.email === account) && !last.to.some((a) => a.email === account);
    if (last.direction === "in" && human(last) && !ccOnlyLast && !last.hasCalendarInvite) awaitingYou.push(row);
    if (last.direction === "out" && waitingDays >= 3) awaitingThem.push(row);
  }
  awaitingYou.sort((a, b) => b.waitingDays - a.waitingDays);
  awaitingThem.sort((a, b) => b.waitingDays - a.waitingDays);

  // ---- reply times (via In-Reply-To, falling back to thread order) ---------------------------
  const byMessageId = new Map(messages.filter((m) => m.messageId).map((m) => [m.messageId, m]));
  const yourReplyHours = [];
  const theirReplyHours = [];
  for (const list of threads.values()) {
    list.forEach((m, i) => {
      const parent = (m.inReplyTo && byMessageId.get(m.inReplyTo)) || list[i - 1];
      if (!parent || parent.direction === m.direction) return;
      const hours = (m.date - parent.date) / 36e5;
      if (hours < 0 || hours > 24 * 30) return;
      if (m.direction === "out" && human(parent)) yourReplyHours.push(hours);
      if (m.direction === "in" && human(m)) theirReplyHours.push(hours);
    });
  }

  // ---- list rules ---------------------------------------------------------------------------
  const newest = (a, b) => b.date - a.date;

  // First contact = the earliest message with that person in either direction (messages are sorted by date).
  const firstAny = new Map();
  for (const m of messages) {
    const addrs = m.direction === "in" ? [m.from.email] : m.to.map((a) => a.email);
    for (const a of addrs) if (!firstAny.has(a)) firstAny.set(a, m.date.getTime());
  }
  const firstSeen = new Map();
  for (const m of inbound) if (human(m) && !firstSeen.has(m.from.email)) firstSeen.set(m.from.email, m);

  const realAttachments = (m) => m.attachments.filter((a) => !a.inline && a.mimeType !== "text/calendar" && !/\.ics$/i.test(a.filename));
  // One row per conversation: keep the newest matching message of each thread.
  const perThread = (list) => {
    const seen = new Set();
    return list.filter((m) => (seen.has(m.threadId) ? false : (seen.add(m.threadId), true)));
  };

  // Each rule: filter → newest first → one row per conversation → list item.
  const rule = (source, test, detail) => perThread(source.filter(test).sort(newest)).map((m) => messageItem(m, detail?.(m)));
  const isCcOnly = (m) => m.cc.some((a) => a.email === account) && !m.to.some((a) => a.email === account);

  const lists = {
    unreadImportant: rule(inbound, (m) => m.isUnread && m.isImportant && !m.isBulk),
    starred: rule(messages, (m) => m.isStarred),
    newContacts: [...firstSeen.values()]
      .filter((m) => (firstAny.get(m.from.email) ?? 0) >= recent && !m.isInternal)
      .sort(newest)
      .map((m) => messageItem(m, `${m.from.email} · ${m.subject}`)),
    attachments: rule(inbound, (m) => realAttachments(m).length > 0, (m) => realAttachments(m).map((a) => a.filename).join(", ")),
    meetingInvites: rule(inbound, (m) => m.hasCalendarInvite),
    ccOnly: rule(inbound, (m) => human(m) && isCcOnly(m)),
  };

  // ---- breakdowns ----------------------------------------------------------------------------
  const countBy = (items, key, label) => {
    const map = new Map();
    for (const it of items) {
      const k = key(it);
      if (!k) continue;
      const cur = map.get(k) || { key: k, label: label(it), value: 0 };
      cur.value += 1;
      map.set(k, cur);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  };

  const hours = Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: `${h}:00`, value: 0 }));
  for (const m of inbound) if (human(m)) hours[new Date(m.date).getHours()].value += 1;

  const people = countBy(inbound.filter(human), (m) => m.from.email, (m) => m.from.name || m.from.email);

  const breakdowns = {
    newsletters: countBy(inbound.filter((m) => m.isBulk), (m) => m.from.email, (m) => m.from.name || m.from.email).slice(0, 10),
    topDomains: countBy(inbound.filter((m) => human(m) && !m.isInternal), (m) => m.from.domain, (m) => m.from.domain).slice(0, 10),
    busiestHours: hours,
    labels: labels
      .filter((l) => l.messagesUnread > 0 && !["UNREAD", "SPAM", "TRASH", "DRAFT", "SENT", "CHAT"].includes(l.labelId))
      .map((l) => ({ key: l.labelId, label: l.type === "system" ? l.name.replace(/^CATEGORY_/, "").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : l.name, value: l.messagesUnread }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10),
  };

  // ---- activity per day ------------------------------------------------------------------------
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const start = new Date(now - i * DAY);
    start.setHours(0, 0, 0, 0);
    const end = start.getTime() + DAY;
    const inDay = messages.filter((m) => m.date >= start && m.date.getTime() < end);
    days.push({
      date: start.toISOString().slice(0, 10),
      received: inDay.filter((m) => m.direction === "in").length,
      sent: inDay.filter((m) => m.direction === "out").length,
    });
  }

  const ruleOut = Object.fromEntries(
    Object.keys(LIST_RULES).map((id) => [id, { count: lists[id]?.length ?? 0, items: (lists[id] ?? []).slice(0, 25) }])
  );
  const breakdownOut = Object.fromEntries(Object.keys(BREAKDOWN_RULES).map((id) => [id, breakdowns[id] ?? []]));

  return {
    connected: true,
    insights: await buildInsights(conn, threads, now),
    mode: conn.mode,
    account: conn.email,
    lastSyncAt: conn.lastSyncAt || null,
    status: conn.status,
    error: conn.error || null,
    windowDays: 30,
    totals: {
      received: inbound.length,
      sent: outbound.length,
      people: people.length,
      awaitingYou: awaitingYou.length,
      awaitingThem: awaitingThem.length,
      unreadImportant: lists.unreadImportant.length,
      starred: lists.starred.length,
      newContacts: lists.newContacts.length,
      attachments: lists.attachments.length,
      meetingInvites: lists.meetingInvites.length,
      ccOnly: lists.ccOnly.length,
      newsletters: inbound.filter((m) => m.isBulk).length,
      yourReplyHours: median(yourReplyHours),
      theirReplyHours: median(theirReplyHours),
    },
    awaitingYou: awaitingYou.slice(0, 20),
    awaitingThem: awaitingThem.slice(0, 20),
    topPeople: people.slice(0, 10).map((p) => ({ name: p.label, email: p.key, count: p.value })),
    activity: days,
    rules: ruleOut,
    breakdowns: breakdownOut,
  };
}

// AI labels from server/agent/classify.js, joined to the threads in the current window.
// These are *inferred* by a model (or *derived* for automated senders) and the UI says so on every row.
async function buildInsights(conn, threads, now) {
  const a = conn.analysis ?? {};
  const docs = threads.size
    ? await getDb().collection("extractions").find({ _id: { $in: [...threads.keys()] } }).toArray()
    : [];

  const rows = [];
  for (const e of docs) {
    const list = threads.get(e._id);
    const last = list[list.length - 1];
    const latestIn = [...list].reverse().find((m) => m.direction === "in");
    rows.push({
      threadId: e._id,
      subject: last.subject,
      contact: contactOf(latestIn ?? last),
      lastAt: last.date,
      waitingDays: Math.floor((now - last.date.getTime()) / DAY),
      link: gmailLink(last),
      category: e.correction?.category ?? e.category,
      priority: e.priority,
      needsReply: e.needsReply,
      summary: e.summary,
      reason: e.reason,
      suggestedAction: e.suggestedAction ?? null,
      certainty: e.correction ? "confirmed" : e.certainty, // a user correction (planned) beats the model
      // A newer message arrived after this label was made; it'll be refreshed on the next run.
      stale: e.lastMessageId !== last.gmailId,
    });
  }
  rows.sort((x, y) => PRIORITY_RANK[x.priority] - PRIORITY_RANK[y.priority] || new Date(y.lastAt) - new Date(x.lastAt));

  const counts = {};
  for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1;

  return {
    configured: geminiConfigured(),
    status: a.status ?? "never",
    error: a.error ?? null,
    progress: a.progress ?? null,
    lastRunAt: a.lastRunAt ?? null,
    model: a.model ?? null,
    analysedThreads: rows.length,
    totalThreads: threads.size,
    categories: Object.entries(counts)
      .map(([category, count]) => ({ category, count }))
      .sort((x, y) => y.count - x.count),
    rows: rows.slice(0, 150),
  };
}
