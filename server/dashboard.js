import { getDb } from "./db.js";
import { geminiConfigured } from "./agent/llm.js";
import { AUTOMATED_ADDRESS, businessDaysBetween, followUpPriority, isNoReply } from "../shared/followup.js";
import { Category } from "../shared/spec.js";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export const AUTOMATED = AUTOMATED_ADDRESS;
const DAY = 24 * 60 * 60 * 1000;

function gmailLink(m) {
  return m.source === "gmail" ? `https://mail.google.com/mail/u/0/#all/${m.threadId}` : null;
}

// Every number here is derived deterministically from synced message metadata.
// Nothing is guessed by a model, and the UI labels these as "derived".
export async function buildDashboard() {
  const db = getDb();
  const conn = await db.collection("connections").findOne({ provider: "gmail" });
  if (!conn) return { connected: false };

  const since = new Date(Date.now() - 30 * DAY);
  const messages = await db.collection("messages").find({ date: { $gte: since } }).sort({ date: 1 }).toArray();

  const threads = new Map();
  for (const m of messages) {
    if (!threads.has(m.threadId)) threads.set(m.threadId, []);
    threads.get(m.threadId).push(m);
  }

  const now = Date.now();
  const awaitingYou = [];
  const awaitingThem = [];
  for (const list of threads.values()) {
    const last = list[list.length - 1];
    const waitingDays = Math.floor((now - last.date.getTime()) / DAY);
    const row = {
      threadId: last.threadId,
      subject: last.subject,
      snippet: last.snippet,
      contact: last.direction === "in" ? last.from.name || last.from.email : (last.to || "").replace(/<.*>/, "").trim(),
      lastAt: last.date,
      waitingDays,
      waitingBusinessDays: businessDaysBetween(last.date, now),
      messages: list.length,
      link: gmailLink(last),
    };
    if (last.direction === "in" && !AUTOMATED.test(last.from.email)) awaitingYou.push(row);
    // "No reply" (decision #25): you wrote last, to someone outside your company, 3+ business days ago.
    if (isNoReply({ last, selfEmail: conn.email, now })) awaitingThem.push(row);
  }
  awaitingYou.sort((a, b) => b.waitingDays - a.waitingDays);
  awaitingThem.sort((a, b) => b.waitingBusinessDays - a.waitingBusinessDays);

  const inbound = messages.filter((m) => m.direction === "in");
  const outbound = messages.filter((m) => m.direction === "out");
  const people = new Map();
  for (const m of inbound) {
    if (AUTOMATED.test(m.from.email)) continue;
    const p = people.get(m.from.email) || { name: m.from.name || m.from.email, email: m.from.email, count: 0 };
    p.count += 1;
    people.set(m.from.email, p);
  }

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
      people: people.size,
      awaitingYou: awaitingYou.length,
      awaitingThem: awaitingThem.length,
    },
    awaitingYou: awaitingYou.slice(0, 20),
    awaitingThem: awaitingThem.slice(0, 20),
    topPeople: [...people.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    activity: days,
  };
}

// AI labels from server/agent/classify.js, joined to the threads in the current window.
// The category is *inferred* by a model (or *derived* for automated senders) and the UI says so on every row.
// Priority is *derived* here from the follow-up rules (shared/followup.js), at read time, because
// "3 business days without a reply" can become true without any new email arriving.
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
    // Labels made before the category list changed (e.g. the old "support") count as customer requests
    // until the next analysis run re-labels them (PROMPT_VERSION was bumped).
    const raw = e.correction?.category ?? e.category;
    const category = Category.options.includes(raw) ? raw : "request";
    const p = followUpPriority({ category, last, selfEmail: conn.email, now });
    rows.push({
      threadId: e._id,
      subject: last.subject,
      contact: latestIn ? latestIn.from.name || latestIn.from.email : (last.to || "").replace(/<.*>/, "").trim(),
      lastAt: last.date,
      waitingDays: Math.floor((now - last.date.getTime()) / DAY),
      waitingBusinessDays: p.waitingBusinessDays,
      link: gmailLink(last),
      category,
      priority: p.priority,
      priorityRule: p.rule,
      needsReply: p.needsReply,
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
