import "dotenv/config";
import express from "express";
import { connectDb, getDb, pingDb } from "./db.js";
import { z } from "zod";
import { authUrl, canSend, consumeState, disconnectGmail, fetchAttachment, googleConfigured, handleCallback, sendReply, syncGmail } from "./gmail.js";
import { buildDashboard } from "./dashboard.js";
import { seedSample } from "./sample.js";
import { decrypt } from "./crypto.js";
import { ConflictError, getDashboard, resetDashboard, saveDashboard, undoDashboard } from "./dashboards.js";
import { geminiConfigured, geminiModel } from "./agent/llm.js";
import { resetStaleAnalysis, startAnalysis } from "./agent/classify.js";
import { draftReply, loadThread } from "./agent/reply.js";
import { Category, Priority } from "../shared/spec.js";

const app = express();
app.use(express.json());

const APP_URL = process.env.APP_URL || "http://localhost:5173";
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
    gmail: publicConnection(conn),
  });
}));

app.get("/api/auth/google/start", (_req, res) => {
  if (!googleConfigured()) return res.status(400).send("Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.");
  res.redirect(authUrl());
});

app.get("/api/auth/google/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`${APP_URL}/?gmail=denied#/integrations`);
  if (!code || !consumeState(String(state))) return res.redirect(`${APP_URL}/?gmail=invalid#/integrations`);
  try {
    await handleCallback(String(code));
    // First sync (then AI analysis) runs in the background; status is visible in the UI.
    syncGmail().then(analyseInBackground).catch(() => {});
    res.redirect(`${APP_URL}/?gmail=connected#/integrations`);
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

// ---- Replies: AI draft, then send only after the user edits and approves it (decision #30) ----
app.post("/api/replies/draft", wrap(async (req, res) => {
  const threadId = z.string().min(1).max(200).parse(req.body?.threadId);
  res.json(await draftReply(threadId));
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
app.get("/api/dashboards/default", wrap(async (_req, res) => res.json(await getDashboard())));
app.put("/api/dashboards/default", async (req, res) => {
  try {
    res.json(await saveDashboard(req.body));
  } catch (err) {
    res.status(err instanceof ConflictError ? 409 : 400).json({ error: err.message });
  }
});
app.post("/api/dashboards/default/undo", wrap(async (_req, res) => res.json(await undoDashboard())));
app.post("/api/dashboards/default/reset", wrap(async (_req, res) => res.json(await resetDashboard())));

// API_PORT (not PORT): dev tools often set PORT for the web server.
const port = Number(process.env.API_PORT || 8787);
connectDb()
  .then(resetStaleAnalysis)
  .then(() => app.listen(port, () => console.log(`API ready on http://localhost:${port} (MongoDB connected)`)))
  .catch((err) => {
    console.error("Could not connect to MongoDB:", err.message);
    process.exit(1);
  });
