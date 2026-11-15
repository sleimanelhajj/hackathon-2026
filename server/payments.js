// Payments (decision #59): invoices to pay (received by email) and to collect (sent, from the app or from Gmail),
// each with its due date and a priority. Built from the attachment library (documents.js) and the app's invoices;
// a receipt with the same number marks an invoice paid. The figures were read from files by AI, so the widget says so.
import { getDb } from "./db.js";
import { loadDocuments } from "./documents.js";

const DAY = 864e5;
const RANK = { high: 0, medium: 1, low: 2 };
const norm = (n) => String(n ?? "").trim().toUpperCase();

function dueness(dueDate, now) {
  if (!dueDate) return { status: "no-due-date", priority: "low" };
  const days = Math.floor((new Date(`${dueDate}T23:59:59Z`).getTime() - now.getTime()) / DAY);
  if (days < 0) return { status: "overdue", priority: "high" };
  if (days <= 3) return { status: "due-soon", priority: "high" };
  return { status: "due", priority: days <= 14 ? "medium" : "low" };
}
const higher = (a, b) => (RANK[a] <= RANK[b] ? a : b);

/** Pure: the payment list (most urgent first) and totals still open. */
export function buildPayments({ docs = [], appInvoices = [], extractions = [], now = new Date() }) {
  const aiPriority = new Map(extractions.map((e) => [e._id ?? e.threadId, e.priority]));
  const paid = new Set(docs.filter((d) => d.docType === "receipt" && d.number).map((d) => norm(d.number)));
  const items = [];
  const seen = new Set();

  for (const inv of appInvoices.filter((i) => i.status === "sent")) {
    seen.add(norm(inv.invoiceNumber));
    items.push({ id: `app:${inv._id}`, source: "app", direction: "to-collect", counterparty: inv.customer?.name ?? null, number: inv.invoiceNumber,
      total: inv.totalMinor / 100, currency: inv.currency, issueDate: inv.issueDate, dueDate: inv.dueDate, threadId: null, filename: `${inv.invoiceNumber}.pdf`, ai: false });
  }
  for (const d of docs.filter((x) => x.docType === "invoice" && x.status === "ok")) {
    if (d.number && seen.has(norm(d.number))) continue;
    if (d.number) seen.add(norm(d.number));
    const out = d.direction === "out";
    items.push({ id: `doc:${d._id}`, source: "email", direction: out ? "to-collect" : "to-pay",
      counterparty: (out ? d.billedTo : d.issuer) || d.contact?.name || null, number: d.number, total: d.total, currency: d.currency,
      issueDate: d.issueDate, dueDate: d.dueDate, threadId: d.threadId, filename: d.filename, ai: true });
  }

  for (const item of items) {
    if (item.number && paid.has(norm(item.number))) { Object.assign(item, { status: "paid", priority: "low" }); continue; }
    const { status, priority } = dueness(item.dueDate, now);
    const hint = item.threadId ? aiPriority.get(item.threadId) : null;
    Object.assign(item, { status, priority: hint === "high" ? higher(priority, "high") : priority });
  }
  items.sort((a, b) => (a.status === "paid") - (b.status === "paid") || RANK[a.priority] - RANK[b.priority] || String(a.dueDate ?? "9999").localeCompare(String(b.dueDate ?? "9999")));

  const open = items.filter((i) => i.status !== "paid");
  const sum = (list) => Math.round(list.reduce((n, i) => n + (Number(i.total) || 0), 0) * 100) / 100;
  const currencies = [...new Set(open.map((i) => i.currency).filter(Boolean))];
  return {
    items,
    totals: {
      toPay: sum(open.filter((i) => i.direction === "to-pay")), toCollect: sum(open.filter((i) => i.direction === "to-collect")),
      overdue: open.filter((i) => i.status === "overdue").length, currency: currencies.length === 1 ? currencies[0] : currencies.length ? "mixed" : "USD",
    },
  };
}

/** GET /api/payments */
export async function loadPayments({ now = new Date() } = {}) {
  const db = getDb();
  const [docs, appInvoices, extractions] = await Promise.all([
    loadDocuments({ db, now: now.getTime() }),
    db.collection("invoices").find({ status: "sent" }, { projection: { invoiceNumber: 1, status: 1, customer: 1, totalMinor: 1, currency: 1, issueDate: 1, dueDate: 1, sentAt: 1 } }).toArray(),
    db.collection("extractions").find({}, { projection: { priority: 1 } }).toArray(),
  ]);
  return { ...buildPayments({ docs, appInvoices, extractions, now }), generatedAt: now };
}
