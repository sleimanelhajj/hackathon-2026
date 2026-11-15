// Custom email widgets (decision #60): the assistant designs a typed query (shared/spec.js EmailCustomQuery) and this
// runs it over the synced mail: count emails, conversations or people in the last N days, filtered, grouped by sender,
// company, AI category or priority, direction, day or week. Plain code over MongoDB; nothing the model writes is run.
import { getDb } from "./db.js";
import { EmailCustomQuery, categoryInfo } from "../shared/spec.js";

const DAY = 864e5;
const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
/** Monday of the week `d` falls in (UTC), as YYYY-MM-DD. */
const weekOf = (d) => { const x = new Date(`${isoDay(d)}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return isoDay(x); };
const PRIORITY = { high: "High", medium: "Medium", low: "Low" };

/** The other person in a message: the sender of mail you got, the first recipient of mail you sent. */
const other = (m) => (m.direction === "out" ? m.to?.[0] : m.from) ?? {};

/** Pure: { rows: [{ key, value }], total, unit, period }. */
export function aggregateEmails({ messages, labels = [], query, now = new Date() }) {
  const qy = EmailCustomQuery.parse(query);
  const f = qy.filters;
  const from = new Date(now.getTime() - qy.days * DAY);
  const label = new Map(labels.map((l) => [l.threadId ?? l._id, l]));
  const needle = f.from.toLowerCase();
  const kept = messages.filter((m) => {
    if (new Date(m.date) < from || new Date(m.date) > now) return false;
    if (f.direction !== "any" && m.direction !== f.direction) return false;
    if (f.withAttachments && !m.hasAttachments) return false;
    const l = label.get(m.threadId);
    if (f.categories.length && !f.categories.includes(l?.category)) return false;
    if (f.priorities.length && !f.priorities.includes(l?.priority)) return false;
    if (f.needsReply !== null && Boolean(l?.needsReply) !== f.needsReply) return false;
    if (needle) { const p = other(m); if (![p.name, p.email].some((v) => String(v ?? "").toLowerCase().includes(needle))) return false; }
    return true;
  });
  const measure = (list) => {
    if (qy.metric === "emails") return list.length;
    if (qy.metric === "conversations") return new Set(list.map((m) => m.threadId)).size;
    return new Set(list.map((m) => String(other(m).email ?? "").toLowerCase()).filter(Boolean)).size;
  };
  const total = measure(kept);
  const unit = qy.metric;
  const period = { from: isoDay(from), to: isoDay(now), days: qy.days };
  if (qy.groupBy === "none") return { rows: [{ key: "Total", value: total }], total, unit, period };

  const keyOf = {
    sender: (m) => other(m).name || other(m).email || "Unknown",
    company: (m) => String(other(m).email ?? "").split("@")[1] || "Unknown",
    category: (m) => (label.get(m.threadId)?.category ? categoryInfo(label.get(m.threadId).category).title : "Not sorted yet"),
    priority: (m) => PRIORITY[label.get(m.threadId)?.priority] ?? "Not sorted yet",
    direction: (m) => (m.direction === "out" ? "Sent" : "Received"),
    day: (m) => isoDay(m.date),
    week: (m) => weekOf(m.date),
  }[qy.groupBy];
  const groups = new Map();
  for (const m of kept) {
    const k = keyOf(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m);
  }
  if (qy.groupBy === "day" || qy.groupBy === "week") {
    // Every bucket in the window, zeros included, oldest first.
    const keys = [];
    for (let t = from.getTime() + DAY; t <= now.getTime(); t += DAY) {
      const k = qy.groupBy === "day" ? isoDay(t) : weekOf(t);
      if (keys.at(-1) !== k && !keys.includes(k)) keys.push(k);
    }
    return { rows: keys.map((k) => ({ key: k, value: measure(groups.get(k) ?? []) })), total, unit, period };
  }
  const rows = [...groups].map(([key, list]) => ({ key, value: measure(list) }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    .slice(0, qy.limit);
  return { rows, total, unit, period };
}

/** Runs a query over the last 30 days of synced mail (POST /api/email/custom). */
export async function runEmailQuery(query, { now = new Date() } = {}) {
  const db = getDb();
  const messages = await db.collection("messages")
    .find({ date: { $gte: new Date(now.getTime() - 31 * DAY) } }, { projection: { threadId: 1, direction: 1, date: 1, from: 1, to: 1, hasAttachments: 1 } })
    .toArray();
  const labels = await db.collection("extractions").find({}, { projection: { category: 1, priority: 1, needsReply: 1 } }).toArray();
  return aggregateEmails({ messages, labels: labels.map((l) => ({ ...l, threadId: l._id })), query, now });
}
