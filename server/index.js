import "dotenv/config";
import express from "express";
import { connectDb, getDb, pingDb } from "./db.js";
import { z } from "zod";
import { authUrl, canSend, checkForNewMail, consumeState, disconnectGmail, fetchAttachment, googleConfigured, handleCallback, resetStaleSync, sendEmailWithAttachment, sendReply, syncGmail } from "./gmail.js";
import { createAutoSync } from "./autosync.js";
import { buildDashboard } from "./dashboard.js";
import { seedSample } from "./sample.js";
import { decrypt, encrypt } from "./crypto.js";
import { ConflictError, getDashboard, removeWidgetFromBoard, resetDashboard, saveDashboard, undoDashboard } from "./dashboards.js";
import { geminiConfigured, geminiModel } from "./agent/llm.js";
import { resetStaleAnalysis, startAnalysis } from "./agent/classify.js";
import { draftReply, loadThread } from "./agent/reply.js";
import { writeEmail } from "./agent/email-writer.js";
import { threadView } from "./threads.js";
import { DEFAULT_SCHEMA, createSchema, ensureDatabase, getPool, loadData, postgresConfigured, tableCounts } from "./sales/db.js";
import { generateSalesData } from "./sales/seed.js";
import { salesDashboard } from "./sales/metrics.js";
import { runCustomQuery } from "./sales/custom.js";
import { runRecordsQuery } from "./sales/records.js";
import { listFolders, loadDocuments, onDocumentSaved, summariseAttachments } from "./documents.js";
import { loadPayments } from "./payments.js";
import { createPage, deletePage, listPages, renamePage } from "./pages.js";
import { runEmailQuery } from "./email-custom.js";
import { applyAppInvoice, applyEmailInvoice, emailInvoicesSince, listInvoiceChanges, undoInvoice } from "./inventory.js";
import { DEFAULT_TIME_ZONE, answerMeetingRequest, loadSchedule, processMeetingRequests, retryMeetingEmail, safeTimeZone, saveAvailability, syncSchedule } from "./schedule-data.js";
import { chat } from "./agent/chat.js";
import { publicInvoice, renderInvoicePdf } from "./agent/invoice.js";
import { assistantError, getAssistant, getChangeDesk } from "./agent/assistant.js";
import { companyData } from "./company-data/index.js";
import { applySecurity, healthRoute, serveClient } from "./http.js";
import { reportEnv } from "./env.js";
import { createTelegram, gramConnect, mongoTelegramStore } from "./telegram.js";
import { analyzeChat } from "./agent/telegram-insight.js";
import { createAgentLog, mongoAgentLogStore } from "./agent/agent-log.js";
import { asAgent, useAgentLog } from "./agent/trace.js";
import { TEAM, APP_AGENT } from "./agent/team.js";
import { fileURLToPath } from "node:url";
import { Category, Priority } from "../shared/spec.js";

/** Postgres errors in plain words, without echoing the connection string. */
function friendlyPgError(err) {
  const code = err?.code;
  if (code === "28P01") return "Postgres refused the username or password in POSTGRES_URL.";
  if (code === "3D000") return "The database in POSTGRES_URL doesn't exist. Open the Sales page and click \"Load sales records\" to create it.";
  if (code === "ECONNREFUSED") return "Can't reach Postgres. Is it running on the host and port in POSTGRES_URL?";
  if (code === "42P01") return "The sales tables don't exist yet. Open the Sales page and load the sales records.";
  return `Postgres error: ${String(err?.message || err).replace(/postgres(ql)?:\/\/[^\s]+/gi, "[connection string]")}`;
}

const app = express();
applySecurity(app);
app.use(express.json({ limit: "2mb" }));
app.get("/api/health", healthRoute(pingDb));

const APP_URL = process.env.APP_URL || "http://localhost:5173";
/** How often auto-sync asks Gmail for new mail (GMAIL_POLL_SECONDS, at least 20, default 60). */
const POLL_SECONDS = Math.max(20, Number(process.env.GMAIL_POLL_SECONDS) || 60);
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => res.status(400).json({ error: err.message }));

function publicConnection(conn) {
  if (!conn) return null;
  return {
    mode: conn.mode,
    email: conn.email,
    status: conn.status,
    scopes: conn.scopes || [],
    canSend: canSend(conn),
    lastSyncAt: conn.lastSyncAt || null,
    lastSyncCount: conn.lastSyncCount ?? null,
    error: conn.error || null,
    connectedAt: conn.createdAt || null,
    syncProgress: conn.syncProgress || null,
    // Automatic sync (decision #52): on unless the user turned it off; checks every POLL_SECONDS.
    autoSync: conn.mode === "live" && conn.autoSync !== false,
    autoSyncCheckedAt: conn.autoSyncCheckedAt || null,
    autoSyncEverySeconds: POLL_SECONDS,
    mailbox: conn.mailbox || null,
    analysis: conn.analysis
      ? {
          status: conn.analysis.status,
          error: conn.analysis.error ?? null,
          progress: conn.analysis.progress ?? null,
          lastRunAt: conn.analysis.lastRunAt ?? null,
          counts: conn.analysis.counts ?? null,
        }
      : null,
  };
}

// Kick off AI analysis after new data lands. Never fails the request that triggered it.
const analyseInBackground = () =>
  startAnalysis().catch((err) => console.error("Could not start email analysis:", err.message));

app.get("/api/status", wrap(async (_req, res) => {
  const conn = await getDb().collection("connections").findOne({ provider: "gmail" });
  res.json({
    database: await pingDb(),
    googleConfigured: googleConfigured(),
    gemini: { configured: geminiConfigured(), model: geminiModel() },
    companyData: { configured: companyData.configured(), ...companyData.describe() },
    gmail: publicConnection(conn),
  });
}));

app.get("/api/auth/google/start", (req, res) => {
  if (!googleConfigured()) return res.status(400).send("Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.");
  // ?calendar=1 also asks for calendar.app.created (the app's own calendar only), for the Schedule page's sync.
  res.redirect(authUrl({ calendar: req.query.calendar === "1" }));
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const back = String(state ?? "").startsWith("cal-") ? "calendar" : "integrations";
  if (error) return res.redirect(`${APP_URL}/?gmail=denied#/${back}`);
  if (!code || !consumeState(String(state))) return res.redirect(`${APP_URL}/?gmail=invalid#/${back}`);
  try {
    await handleCallback(String(code));
    // First sync (then AI analysis) runs in the background; status is visible in the UI.
    syncGmail().then(analyseInBackground).catch(() => {});
    res.redirect(`${APP_URL}/?gmail=connected#/${back}`);
  } catch (err) {
    console.error("OAuth callback failed:", err.message);
    res.redirect(`${APP_URL}/?gmail=failed#/integrations`);
  }
});

app.post("/api/integrations/gmail/sync", wrap(async (_req, res) => {
  const result = await syncGmail();
  await analyseInBackground(); // only new or changed threads are sent to Gemini
  res.json(result);
}));
app.post("/api/integrations/gmail/sample", wrap(async (_req, res) => {
  const result = await seedSample();
  await analyseInBackground();
  res.json(result);
}));

// AI email analysis (Gemini). Runs in the background; poll /api/status or /api/dashboard for progress.
// { "force": true } re-analyses every thread instead of only new ones.
app.post("/api/analysis/run", wrap(async (req, res) => {
  if (!geminiConfigured()) return res.status(400).json({ error: "Gemini isn't set up. Add GEMINI_API_KEY to .env and restart the server." });
  res.json(await startAnalysis({ force: req.body?.force === true }));
}));
app.delete("/api/integrations/gmail", wrap(async (_req, res) => {
  await disconnectGmail();
  res.json({ ok: true });
}));
app.get("/api/dashboard", wrap(async (_req, res) => res.json(await buildDashboard())));

// Company-data assistant. The model sees only normalized, bounded records from server/company-data/provider.js.
// It has no database client, SQL or send tool. The client sends at most the last 10 text turns.
app.post("/api/agent/chat", wrap(async (req, res) => {
  const last = Array.isArray(req.body?.messages) ? req.body.messages.at(-1)?.content : "";
  res.json(await asAgent({ agent: "layla", task: String(last ?? ""), trigger: "you" }, () => chat(req.body?.messages)));
}));

// The workspace assistant (chat bubble): a LangGraph agent over the sales database (server/agent/sales-agent.js).
// Read-only tools; an invoice is only created when the user confirms a draft (POST /api/assistant/confirm).
const AssistantMessage = z.object({ threadId: z.string().uuid(), message: z.string().trim().min(1).max(4000) });
const AssistantConfirm = z.object({ threadId: z.string().uuid(), approve: z.boolean(), message: z.string().trim().max(4000).optional() });
app.post("/api/assistant/message", async (req, res) => {
  try {
    const input = AssistantMessage.parse(req.body);
    res.json(await asAgent({ agent: "layla", task: input.message, trigger: "you" }, () => getAssistant().send(input)));
  } catch (err) {
    res.status(400).json({ error: err?.issues ? "Type a message for the assistant." : assistantError(err) });
  }
});
// Changes to the sales records the user saved through the assistant (decision #68): the latest, and Undo.
app.get("/api/assistant/changes", wrap(async (_req, res) => res.json({ changes: await getChangeDesk().recent({ limit: 30 }) })));
app.post("/api/assistant/changes/:id/undo", wrap(async (req, res) => {
  const out = await getChangeDesk().undo(req.params.id);
  await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "user", action: "record_change_undone", changeId: out.id, ok: true }).catch(() => {});
  res.json(out);
}));
app.post("/api/assistant/confirm", async (req, res) => {
  try {
    const input = AssistantConfirm.parse(req.body);
    const task = input.approve ? "Save the invoice you confirmed" : "Change the invoice draft";
    res.json(await asAgent({ agent: "layla", task, trigger: "you" }, () => getAssistant().resume(input)));
  } catch (err) {
    res.status(400).json({ error: err?.issues ? "That confirmation wasn't valid. Try again." : assistantError(err) });
  }
});

// Invoice PDFs are deterministic from a stored draft. Nothing is sent by downloading one.
app.get("/api/invoices/:id/pdf", async (req, res) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const invoice = await getDb().collection("invoices").findOne({ _id: id });
    if (!invoice) return res.status(404).json({ error: "Invoice draft not found." });
    const pdf = await renderInvoicePdf(invoice);
    const filename = `${invoice.invoiceNumber || "invoice"}.pdf`.replace(/[^a-z0-9._-]/gi, "_");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(pdf);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const InvoiceSendBody = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10000),
  approved: z.literal(true),
});
app.post("/api/invoices/:id/send", async (req, res) => {
  let claimed = false;
  let id;
  try {
    id = z.string().uuid().parse(req.params.id);
    const input = InvoiceSendBody.parse(req.body);
    const db = getDb();
    const invoice = await db.collection("invoices").findOne({ _id: id });
    if (!invoice) return res.status(404).json({ error: "Invoice draft not found." });
    if (invoice.status === "sent") return res.status(409).json({ error: "This invoice was already sent." });
    if (invoice.status === "sending") return res.status(409).json({ error: "This invoice is already being sent." });
    if (!invoice.readiness?.ready || !invoice.customer?.email) {
      return res.status(400).json({ error: invoice.readiness?.reasons?.[0] || "Review the invoice before sending it." });
    }
    const lock = await db.collection("invoices").updateOne(
      { _id: id, status: "draft" },
      { $set: { status: "sending", updatedAt: new Date(), sendError: null } }
    );
    if (!lock.matchedCount) return res.status(409).json({ error: "The invoice changed. Reload it before sending." });
    claimed = true;
    const pdf = await renderInvoicePdf(invoice);
    const sent = await sendEmailWithAttachment({
      to: [{ name: invoice.customer.name, email: invoice.customer.email }],
      subject: input.subject,
      body: input.body,
      attachment: { filename: `${invoice.invoiceNumber}.pdf`, contentType: "application/pdf", data: pdf },
    });
    // From here the external action happened. Never revert to draft on a local write failure, or a retry could duplicate it.
    claimed = false;
    const sentAt = new Date();
    await db.collection("invoices").updateOne(
      { _id: id, status: "sending" },
      { $set: { status: "sent", sentAt, sentGmailId: sent.id, updatedAt: sentAt, sendError: null } }
    ).catch((err) => console.error("Invoice was sent but its local status could not be saved:", err.message));
    await db.collection("audit_events").insertOne({
      at: sentAt, actor: "user", action: "invoice_sent", invoiceId: id, approved: true, ok: true,
    }).catch((err) => console.error("Invoice send audit could not be saved:", err.message));
    // Sent: stock goes down and the sale shows on the Sales page (decision #58). Never fails the send.
    if (postgresConfigured()) {
      await applyAppInvoice({ ...invoice, sentAt }).catch((err) => console.error("Stock update for a sent invoice failed:", err.message));
    }
    res.json(publicInvoice({ ...invoice, status: "sent", sentAt, updatedAt: sentAt }));
  } catch (err) {
    if (claimed && id) {
      await getDb().collection("invoices").updateOne(
        { _id: id, status: "sending" },
        { $set: { status: "draft", updatedAt: new Date(), sendError: String(err.message || err).slice(0, 300) } }
      ).catch(() => {});
    }
    res.status(400).json({ error: err.message });
  }
});

// Stored emails for the Email data page (local dev server only; there is no auth yet).
// Gmail fields are as fetched; `ai` (priority, category, needs reply) comes from the AI analysis and the page
// labels it as an AI guess.
// GET /api/messages?q=&direction=in|out&from=a@b.com&status=unread|starred|important|attachments|needsReply
//                  &priority=high|medium|low&category=lead&page=0&limit=25
const STATUS_FILTERS = {
  unread: { isUnread: true },
  starred: { isStarred: true },
  important: { isImportant: true },
  attachments: { hasAttachments: true },
};
app.get("/api/messages", wrap(async (req, res) => {
  const db = getDb();
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(0, Number(req.query.page) || 0);
  const and = [];
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    and.push({ $or: [{ subject: rx }, { snippet: rx }, { "from.email": rx }, { "from.name": rx }, { "to.email": rx }, { "attachments.filename": rx }] });
  }
  if (req.query.direction === "in" || req.query.direction === "out") and.push({ direction: req.query.direction });
  const from = String(req.query.from || "").trim().toLowerCase().slice(0, 320);
  if (from) and.push({ $or: [{ "from.email": from }, { "to.email": from }] });
  const status = String(req.query.status || "");
  if (STATUS_FILTERS[status]) and.push(STATUS_FILTERS[status]);

  // AI filters match whole conversations through their extraction.
  const ai = {};
  if (Priority.safeParse(req.query.priority).success) ai.priority = req.query.priority;
  if (Category.safeParse(req.query.category).success)
    ai.$or = [{ "correction.category": req.query.category }, { correction: { $exists: false }, category: req.query.category }];
  if (status === "needsReply") ai.needsReply = true;
  if (Object.keys(ai).length) and.push({ threadId: { $in: await db.collection("extractions").distinct("_id", ai) } });

  const filter = and.length ? { $and: and } : {};
  const col = db.collection("messages");
  const [docs, total, all] = await Promise.all([
    col.find(filter, { projection: { bodyEnc: 0, headers: 0, _id: 0 } }).sort({ date: -1 }).skip(page * limit).limit(limit).toArray(),
    col.countDocuments(filter),
    col.countDocuments(),
  ]);
  const ex = await db
    .collection("extractions")
    .find({ _id: { $in: [...new Set(docs.map((d) => d.threadId))] } }, { projection: { priority: 1, category: 1, needsReply: 1, correction: 1, certainty: 1 } })
    .toArray();
  const byThread = new Map(
    ex.map((e) => [e._id, { priority: e.priority, category: e.correction?.category ?? e.category, needsReply: e.needsReply, certainty: e.correction ? "confirmed" : e.certainty }])
  );
  res.json({ total, all, page, limit, messages: docs.map((d) => ({ ...d, ai: byThread.get(d.threadId) ?? null })) });
}));

// People in the stored email (senders and recipients), for the "Person" filter.
app.get("/api/messages/people", wrap(async (_req, res) => {
  const conn = await getDb().collection("connections").findOne({ provider: "gmail" });
  const self = (conn?.email || "").toLowerCase();
  const rows = await getDb()
    .collection("messages")
    .aggregate([
      { $project: { p: { $cond: [{ $eq: ["$direction", "in"] }, ["$from"], { $ifNull: ["$to", []] }] } } },
      { $unwind: "$p" },
      { $match: { "p.email": { $nin: [null, "", self] } } },
      { $group: { _id: { $toLower: "$p.email" }, name: { $max: "$p.name" }, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 200 },
    ])
    .toArray();
  res.json(rows.map((r) => ({ email: r._id, name: r.name || "", count: r.count })));
}));
app.get("/api/messages/:gmailId", wrap(async (req, res) => {
  const doc = await getDb().collection("messages").findOne({ gmailId: req.params.gmailId });
  if (!doc) return res.status(404).json({ error: "Not found" });
  const { bodyEnc, _id, ...rest } = doc;
  let bodyText = null;
  try { bodyText = bodyEnc ? decrypt(bodyEnc) : null; } catch { bodyText = "(can't decrypt: different TOKEN_SECRET)"; }
  res.json({ ...rest, bodyText });
}));

// One conversation in full, for the email viewer: every message's body and files, plus the AI's summary.
app.get("/api/threads/:threadId", wrap(async (req, res) => {
  const threadId = z.string().min(1).max(200).parse(req.params.threadId);
  const list = await loadThread(threadId);
  const extraction = await getDb().collection("extractions").findOne({ _id: threadId });
  res.json(threadView(list, extraction));
}));

// ---- Sales (Postgres, decision #36). Demo data only for now; every response says so (sample: true). ----
app.get("/api/sales/status", async (_req, res) => {
  if (!postgresConfigured()) return res.json({ configured: false, connected: false, counts: null, error: null });
  try {
    const counts = await tableCounts(getPool());
    res.json({ configured: true, connected: true, counts, error: null });
  } catch (err) {
    res.json({ configured: true, connected: false, counts: null, error: friendlyPgError(err) });
  }
});
app.post("/api/sales/seed", async (_req, res) => {
  try {
    if (!postgresConfigured()) return res.status(400).json({ error: "Postgres isn't set up. Add POSTGRES_URL to .env and restart the server." });
    await ensureDatabase();
    await createSchema(getPool());
    await loadData(getPool(), DEFAULT_SCHEMA, generateSalesData({ months: 24, now: new Date() }));
    res.json({ ok: true, counts: await tableCounts(getPool()) });
  } catch (err) {
    res.status(400).json({ error: friendlyPgError(err) });
  }
});
app.get("/api/sales/dashboard", async (req, res) => {
  try {
    if (!postgresConfigured()) return res.status(400).json({ error: "Postgres isn't set up. Add POSTGRES_URL to .env and restart the server." });
    const months = [1, 3, 6, 12].includes(Number(req.query.months)) ? Number(req.query.months) : 12;
    if (!(await tableCounts(getPool()))?.orders) return res.status(404).json({ error: "No sales data yet. Load the sales records on the Sales page first." });
    res.json(await salesDashboard(getPool(), { months }));
  } catch (err) {
    res.status(400).json({ error: friendlyPgError(err) });
  }
});

// ---- Replies: AI draft, then send only after the user edits and approves it (decision #30) ----
// Optional: the owner's own instructions and the current text, so "Rewrite with my instructions" changes the draft (#69).
const ReplyDraftBody = z.object({
  threadId: z.string().min(1).max(200),
  guidance: z.string().trim().max(2000).default(""),
  current: z.string().trim().max(20000).default(""),
});
app.post("/api/replies/draft", wrap(async (req, res) => {
  const { threadId, guidance, current } = ReplyDraftBody.parse(req.body ?? {});
  res.json(await draftReply(threadId, { guidance, current }));
}));

const Addr = z.object({ name: z.string().max(200).default(""), email: z.string().trim().email().max(320) });
const SendBody = z.object({
  threadId: z.string().min(1).max(200),
  to: z.array(Addr).min(1).max(20),
  cc: z.array(Addr).max(20).default([]),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  approved: z.literal(true), // the client sets this only from the Send button in the reply dialog
});
app.post("/api/replies/send", async (req, res) => {
  const parsed = SendBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "The reply is incomplete: check the recipients, subject and message." });
  const input = parsed.data;
  try {
    // Threading headers come from our own store, never from the request.
    const list = await loadThread(input.threadId);
    const last = list.at(-1);
    const references = [...(last.references || []), last.messageId].filter(Boolean).slice(-20);
    const sent = await sendReply({ ...input, inReplyTo: last.messageId || null, references });
    // Metadata only: the text itself lives in Gmail's Sent folder.
    await getDb().collection("sent_replies").insertOne({
      threadId: input.threadId, gmailId: sent.id, to: input.to.map((a) => a.email), subject: input.subject, sentAt: new Date(),
    });
    syncGmail().then(analyseInBackground).catch(() => {}); // pick up the sent message so "waiting on you" updates
    res.json({ ok: true, id: sent.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- New emails the assistant drafted in the chat (decision #69) ----
// Rewrite: the email writer changes the current draft as the user asks. Nothing is sent.
const EmailRewriteBody = z.object({
  to: z.string().trim().max(1000).default(""),
  subject: z.string().trim().max(300).default(""),
  body: z.string().trim().min(1).max(20000),
  instruction: z.string().trim().min(1).max(1000),
});
app.post("/api/email/rewrite", wrap(async (req, res) => {
  const parsed = EmailRewriteBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Say what to change in the email." });
  const { to, subject, body, instruction } = parsed.data;
  const out = await writeEmail({ to, current: { subject, body }, change: instruction, request: instruction });
  res.json({ subject: out.subject, body: out.body, note: out.note });
}));
// Send: only from the draft's Send button, after the user confirmed the exact recipients and text (AGENTS.md rule 4).
const EmailSendBody = z.object({
  to: z.array(Addr).min(1).max(20),
  cc: z.array(Addr).max(20).default([]),
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  approved: z.literal(true),
});
app.post("/api/email/send", async (req, res) => {
  const parsed = EmailSendBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "The email is incomplete: check the recipients, subject and message." });
  const input = parsed.data;
  try {
    const sent = await sendReply({ to: input.to, cc: input.cc, subject: input.subject, body: input.body, inReplyTo: null, references: [] });
    await getDb().collection("sent_emails").insertOne({ gmailId: sent.id, to: input.to.map((a) => a.email), subject: input.subject, source: "assistant", sentAt: new Date() });
    await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "user", action: "email_sent", gmailId: sent.id, ok: true }).catch(() => {});
    syncGmail().then(analyseInBackground).catch(() => {});
    res.json({ ok: true, id: sent.id });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Download one attachment of a stored email (read-only scope). Only attachments on record can be fetched.
app.get("/api/attachments/:gmailId/:attachmentId", async (req, res) => {
  try {
    const msg = await getDb().collection("messages").findOne({ gmailId: req.params.gmailId }, { projection: { attachments: 1 } });
    const att = msg?.attachments?.find((a) => a.attachmentId && a.attachmentId === req.params.attachmentId);
    if (!att) return res.status(404).json({ error: "Attachment not found." });
    const { data } = await fetchAttachment(req.params.gmailId, att.attachmentId);
    const name = (att.filename || "attachment").replace(/[\r\n"\\/]/g, "_");
    // Always a download, never rendered on our origin.
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(data);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Dashboard layout spec (widgets + grid positions)
// One saved layout per board: "default" (email) or "sales". Unknown boards are rejected by checkBoard.
app.get("/api/dashboards/:board", wrap(async (req, res) => res.json(await getDashboard(req.params.board))));
app.put("/api/dashboards/:board", async (req, res) => {
  try {
    res.json(await saveDashboard(req.body, req.params.board));
  } catch (err) {
    res.status(err instanceof ConflictError ? 409 : 400).json({ error: err.message });
  }
});
app.post("/api/dashboards/:board/undo", wrap(async (req, res) => res.json(await undoDashboard(req.params.board))));
app.post("/api/dashboards/:board/reset", wrap(async (req, res) => res.json(await resetDashboard(req.params.board))));
// The email schedule (Schedule page): reply tasks, follow-ups, meetings and deadlines built from Gmail data.
// ?tz= is the browser's time zone, so tasks land in the user's working hours.
app.get("/api/schedule", wrap(async (req, res) => {
  res.json(await loadSchedule({ tz: safeTimeZone(String(req.query.tz || DEFAULT_TIME_ZONE)) }));
}));
// Writes the schedule to the app's own Google calendar ("AI Workspace OS"). Leaves the workspace, so it needs an
// explicit approval from the confirm dialog (AGENTS.md rule 4); the model can never call this.
app.post("/api/schedule/sync", async (req, res) => {
  try {
    if (req.body?.approved !== true) return res.status(400).json({ error: "Confirm the sync first." });
    res.json(await syncSchedule({ tz: safeTimeZone(String(req.body?.tz || DEFAULT_TIME_ZONE)) }));
  } catch (err) {
    res.status(400).json({ error: String(err?.message ?? err).slice(0, 300) });
  }
});

// Dashboard pages (decision #60): the main board is the first page; more can be added, renamed and deleted.
app.get("/api/dashboard-pages", wrap(async (_req, res) => res.json({ pages: await listPages() })));
app.post("/api/dashboard-pages", async (req, res) => {
  try { res.json(await createPage(req.body?.name)); } catch (err) { res.status(400).json({ error: err?.issues?.[0]?.message ?? String(err?.message ?? err) }); }
});
app.patch("/api/dashboard-pages/:id", async (req, res) => {
  try { res.json(await renamePage(req.params.id, req.body?.name)); } catch (err) { res.status(400).json({ error: err?.issues?.[0]?.message ?? String(err?.message ?? err) }); }
});
app.delete("/api/dashboard-pages/:id", async (req, res) => {
  try { res.json(await deletePage(req.params.id)); } catch (err) { res.status(400).json({ error: String(err?.message ?? err) }); }
});
// Data for a custom email widget (made by the assistant): its typed query, run over the synced mail.
app.post("/api/email/custom", async (req, res) => {
  try { res.json(await runEmailQuery(req.body?.query)); } catch (err) { res.status(400).json({ error: err?.issues ? "That email chart isn't valid." : String(err?.message ?? err) }); }
});

// Invoices to pay and to collect, with due dates and priority (decision #59).
app.get("/api/payments", wrap(async (_req, res) => res.json(await loadPayments())));

// Invoices moving stock and Sales (decision #58): the log, and Undo for one change.
app.get("/api/inventory/changes", wrap(async (_req, res) => {
  res.json({ configured: postgresConfigured(), changes: postgresConfigured() ? await listInvoiceChanges() : [] });
}));
app.post("/api/inventory/changes/:key/undo", async (req, res) => {
  try {
    if (req.body?.approved !== true) return res.status(400).json({ error: "Confirm the undo first." });
    const key = z.string().min(3).max(300).regex(/^(sale|purchase):/).parse(req.params.key);
    const out = await undoInvoice(key);
    await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "user", action: "invoice_change_undone", key, approved: true, ok: true }).catch(() => {});
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err?.issues ? "That isn't a stock change." : String(err?.message ?? err).slice(0, 300) });
  }
});

// The attachment library (decision #56): folders per contact with an AI summary of each file. Files not read yet
// are read in the background (a bounded run), so the page fills in as they're done.
app.get("/api/files", wrap(async (_req, res) => {
  const out = await listFolders();
  if (out.pending && !out.reading && out.aiConfigured) {
    summariseAttachments().catch((err) => console.error("Attachment summaries:", err.message));
    out.reading = true;
  }
  res.json(out);
}));

// Meeting requests (decision #55). Availability: weekly hours plus date changes; the first save switches requests on.
app.put("/api/meetings/availability", async (req, res) => {
  try {
    await saveAvailability(req.body?.availability, safeTimeZone(String(req.body?.tz || DEFAULT_TIME_ZONE)));
    processMeetingRequests().catch((err) => console.error("Meeting requests:", err.message));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: String(err?.message ?? err).slice(0, 300) });
  }
});
// Accept or decline a request waiting for the user. Sends an email, so only from the page's buttons (approved: true).
const RequestId = z.string().regex(/^mr-[A-Za-z0-9]{1,40}-\d{1,15}$/);
app.post("/api/meetings/requests/:id/answer", async (req, res) => {
  try {
    if (req.body?.approved !== true || typeof req.body?.accept !== "boolean") return res.status(400).json({ error: "Choose accept or decline first." });
    res.json(await answerMeetingRequest(RequestId.parse(req.params.id), req.body.accept));
  } catch (err) {
    res.status(400).json({ error: err?.issues ? "That isn't a meeting request." : String(err?.message ?? err).slice(0, 300) });
  }
});
app.post("/api/meetings/requests/:id/retry", async (req, res) => {
  try {
    if (req.body?.approved !== true) return res.status(400).json({ error: "Confirm the retry first." });
    res.json(await retryMeetingEmail(RequestId.parse(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: err?.issues ? "That isn't a meeting request." : String(err?.message ?? err).slice(0, 300) });
  }
});

// The chat's "Remove" button for a widget the assistant added.
app.delete("/api/dashboards/:board/widgets/:id", async (req, res) => {
  try {
    res.json(await removeWidgetFromBoard(req.params.board, z.string().regex(/^[a-z0-9-]{1,40}$/).parse(req.params.id)));
  } catch (err) {
    res.status(err instanceof ConflictError ? 409 : 400).json({ error: err?.issues ? "That isn't a widget id." : err.message });
  }
});

// Data for a custom widget (made by the assistant): the widget's typed query, run as fixed, parameterized SQL.
app.post("/api/sales/custom", async (req, res) => {
  try {
    if (!postgresConfigured()) return res.status(400).json({ error: "Postgres isn't set up. Add POSTGRES_URL to .env and restart the server." });
    res.json(await runCustomQuery(getPool(), req.body?.query));
  } catch (err) {
    res.status(400).json({ error: err?.issues ? "This widget's settings aren't valid." : friendlyPgError(err) });
  }
});

// Data for a list widget (decision #69): the widget's typed query, run as fixed, parameterized SQL.
app.post("/api/sales/records", async (req, res) => {
  try {
    if (!postgresConfigured()) return res.status(400).json({ error: "Postgres isn't set up. Add POSTGRES_URL to .env and restart the server." });
    res.json(await runRecordsQuery(getPool(), req.body?.query));
  } catch (err) {
    res.status(400).json({ error: err?.issues ? "This list's settings aren't valid." : friendlyPgError(err) });
  }
});

// Turn automatic Gmail sync on or off (Integrations page).
app.put("/api/integrations/gmail/auto-sync", wrap(async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "Say whether auto-sync should be on or off." });
  const r = await getDb().collection("connections").updateOne({ provider: "gmail", mode: "live" }, { $set: { autoSync: req.body.enabled } });
  if (!r.matchedCount) return res.status(400).json({ error: "Connect your Gmail first." });
  res.json({ autoSync: req.body.enabled });
}));

// ---------- Logs (decision #67): Gemini costs and how the agents worked. Read-only; nothing an email or chat says. ----------
const agentLogStore = mongoAgentLogStore(getDb);
const agentLog = createAgentLog({ store: agentLogStore });
useAgentLog(agentLog);
const Days = z.coerce.number().int().min(1).max(90).catch(30);
app.get("/api/agents", (_req, res) => res.json({ agents: TEAM, other: APP_AGENT }));
app.get("/api/logs/usage", wrap(async (req, res) => res.json(await agentLog.usage({ days: Days.parse(req.query.days) }))));
app.get("/api/logs/runs", wrap(async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(60).catch(30).parse(req.query.limit);
  res.json(await agentLog.runs({ limit, days: Days.parse(req.query.days) }));
}));

// ---------- Telegram (decisions #64, #65): the user signs in with phone + code (+ two-step password), chooses the
// people to follow, gets an AI insight per chat, and sends only messages they wrote and confirmed. ----------
const telegramStore = mongoTelegramStore(getDb);
const telegram = createTelegram({
  store: telegramStore, connect: gramConnect(), encrypt, decrypt,
  analyze: geminiConfigured() ? (input) => analyzeChat(input) : null,
});
// Telegram errors are already plain words; never echo a phone number, code or password back into a log.
const tgRoute = (fn) => (req, res) => fn(req, res).catch((err) => res.status(400).json({ error: err.message }));
app.get("/api/integrations/telegram", tgRoute(async (_req, res) => res.json(await telegram.status())));
app.post("/api/integrations/telegram/code", tgRoute(async (req, res) => res.json(await telegram.requestCode(req.body?.phone))));
app.post("/api/integrations/telegram/verify", tgRoute(async (req, res) => {
  const out = await telegram.verifyCode(req.body?.code);
  if (out.connected) telegram.sync().catch(() => {}); // first read in the background; the status shows progress
  res.json(out);
}));
app.post("/api/integrations/telegram/password", tgRoute(async (req, res) => {
  const out = await telegram.verifyPassword(req.body?.password);
  telegram.sync().catch(() => {});
  res.json(out);
}));
app.post("/api/integrations/telegram/cancel", tgRoute(async (_req, res) => res.json(await telegram.cancelLogin())));
app.post("/api/integrations/telegram/sync", tgRoute(async (_req, res) => res.json(await telegram.sync())));
app.delete("/api/integrations/telegram", tgRoute(async (_req, res) => res.json(await telegram.disconnect())));
app.get("/api/telegram/chats", tgRoute(async (_req, res) => res.json({ chats: await telegram.chats() })));
app.get("/api/telegram/chats/:id/messages", tgRoute(async (req, res) => res.json({ messages: await telegram.messages(req.params.id) })));
// Who to follow: saved, then read again in the background so the list matches.
app.put("/api/integrations/telegram/people", tgRoute(async (req, res) => {
  const out = await telegram.setPeople(req.body?.people);
  if ((await telegram.status()).connected) telegram.sync().catch(() => {});
  res.json(out);
}));
// The saved insight, or a new one when the chat has newer messages; POST makes a new one now.
app.get("/api/telegram/chats/:id/insight", tgRoute(async (req, res) => res.json(await telegram.insight(req.params.id))));
app.post("/api/telegram/chats/:id/insight", tgRoute(async (req, res) => res.json(await telegram.insight(req.params.id, { refresh: true }))));
// Sends one message the user wrote and confirmed in the app's dialog (decision #65). Never called by the assistant.
app.post("/api/telegram/chats/:id/send", tgRoute(async (req, res) => {
  if (req.body?.confirmed !== true) return res.status(400).json({ error: "Confirm the message before sending it." });
  res.json({ message: await telegram.send(req.params.id, req.body?.text) });
}));

// The built web app (npm run build) is served from here too, so one process is the whole app in production.
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const servesClient = serveClient(app, DIST);

// API_PORT (not PORT): dev tools often set PORT for the web server. In production a host's PORT is used when API_PORT is unset.
const port = Number(process.env.API_PORT || (process.env.NODE_ENV === "production" && process.env.PORT) || 8787);
/** Sales tables are upgraded in place, and invoices the AI reads from email start moving stock (decision #58). */
async function startInventory() {
  if (!postgresConfigured()) return;
  try {
    await createSchema(getPool());
    const since = await emailInvoicesSince();
    let storeName = null;
    const apply = async (doc) => {
      if (doc.docType !== "invoice" || doc.status !== "ok") return;
      storeName ??= (await getPool().query(`SELECT name FROM "${DEFAULT_SCHEMA}".store_profile WHERE id = 1`)).rows[0]?.name ?? "";
      const out = await applyEmailInvoice(doc, { storeName, since });
      if (out.applied) await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "agent", action: "invoice_applied", key: out.key, source: "email", ok: true }).catch(() => {});
    };
    onDocumentSaved(apply);
    // Catch up on invoices read while the server was down or before this hook worked; each invoice counts once anyway.
    // In the background, so the server answers requests right away.
    (async () => { for (const doc of await loadDocuments()) await apply(doc).catch((err) => console.error("Stock from an emailed invoice:", err.message)); })()
      .catch((err) => console.error("Stock catch-up:", err.message));
  } catch (err) {
    console.error("Inventory updates are off:", err.message);
  }
}

if (!reportEnv()) process.exit(1);

connectDb()
  .then(() => telegramStore.ensureIndexes())
  .then(() => agentLogStore.ensureIndexes())
  .then(resetStaleAnalysis)
  .then(resetStaleSync)
  .then(startInventory)
  .then(() => app.listen(port, () => {
    console.log(`API ready on http://localhost:${port} (MongoDB connected)${servesClient ? ", serving the built app" : ""}`);
    // New mail: a cheap check every POLL_SECONDS, a full sync and AI sorting only when the mailbox changed.
    createAutoSync({ check: checkForNewMail, sync: syncGmail, after: analyseInBackground, intervalMs: POLL_SECONDS * 1000 }).start();
    // Meeting requests (decision #55): answer new ones every minute, once the user has saved their availability.
    setInterval(() => processMeetingRequests().catch((err) => console.error("Meeting requests:", err.message)), 60_000).unref();
  }))
  .catch((err) => {
    console.error("Could not connect to MongoDB:", err.message);
    process.exit(1);
  });
