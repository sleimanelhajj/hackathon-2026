import { getDb } from "./db.js";

const AUTOMATED = /(no-?reply|do-?not-?reply|notifications?@|mailer-daemon|newsletter|bounce)/i;
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
      messages: list.length,
      link: gmailLink(last),
    };
    if (last.direction === "in" && !AUTOMATED.test(last.from.email)) awaitingYou.push(row);
    if (last.direction === "out" && waitingDays >= 3) awaitingThem.push(row);
  }
  awaitingYou.sort((a, b) => b.waitingDays - a.waitingDays);
  awaitingThem.sort((a, b) => b.waitingDays - a.waitingDays);

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
  for (let i = 13; i >= 0; i--) {
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
    awaitingYou: awaitingYou.slice(0, 8),
    awaitingThem: awaitingThem.slice(0, 6),
    topPeople: [...people.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    activity: days,
  };
}
