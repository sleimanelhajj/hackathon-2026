import "dotenv/config";
import express from "express";
import { connectDb, getDb, pingDb } from "./db.js";
import { authUrl, consumeState, disconnectGmail, googleConfigured, handleCallback, syncGmail } from "./gmail.js";
import { buildDashboard } from "./dashboard.js";
import { seedSample } from "./sample.js";
import { decrypt } from "./crypto.js";
import { ConflictError, getDashboard, resetDashboard, saveDashboard, undoDashboard } from "./dashboards.js";
import { geminiConfigured, geminiModel } from "./agent/llm.js";
import { resetStaleAnalysis, startAnalysis } from "./agent/classify.js";

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

// Inspect what's stored per email (for the team, to see exactly what Gmail gave us).
// Local dev server only; there is no auth yet.
// GET /api/messages?limit=50&page=0&q=lena&direction=in
app.get("/api/messages", wrap(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(0, Number(req.query.page) || 0);
  const filter = {};
  const q = String(req.query.q || "").trim().slice(0, 100);
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ subject: rx }, { snippet: rx }, { "from.email": rx }, { "from.name": rx }, { "to.email": rx }, { "attachments.filename": rx }];
  }
  if (req.query.direction === "in" || req.query.direction === "out") filter.direction = req.query.direction;
  const col = getDb().collection("messages");
  const [docs, total, all] = await Promise.all([
    col.find(filter, { projection: { bodyEnc: 0, headers: 0, _id: 0 } }).sort({ date: -1 }).skip(page * limit).limit(limit).toArray(),
    col.countDocuments(filter),
    col.countDocuments(),
  ]);
  res.json({ total, all, page, limit, messages: docs });
}));
app.get("/api/messages/:gmailId", wrap(async (req, res) => {
  const doc = await getDb().collection("messages").findOne({ gmailId: req.params.gmailId });
  if (!doc) return res.status(404).json({ error: "Not found" });
  const { bodyEnc, _id, ...rest } = doc;
  let bodyText = null;
  try { bodyText = bodyEnc ? decrypt(bodyEnc) : null; } catch { bodyText = "(can't decrypt: different TOKEN_SECRET)"; }
  res.json({ ...rest, bodyText });
}));

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
