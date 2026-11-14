import "dotenv/config";
import express from "express";
import { connectDb, getDb, pingDb } from "./db.js";
import { authUrl, consumeState, disconnectGmail, googleConfigured, handleCallback, syncGmail } from "./gmail.js";
import { buildDashboard } from "./dashboard.js";
import { seedSample } from "./sample.js";
import { ConflictError, getDashboard, resetDashboard, saveDashboard, undoDashboard } from "./dashboards.js";
import { geminiConfigured, geminiModel } from "./agent/llm.js";
import { resetStaleAnalysis, startAnalysis } from "./agent/classify.js";
import { autoSyncInfo, startScheduler } from "./scheduler.js";

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
    autoSync: autoSyncInfo(),
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
app.get("/api/dashboard", wrap(async (_req, res) => {
  const d = await buildDashboard();
  // Background checks only apply to a live Gmail connection, never to sample data.
  if (d.connected) d.autoSync = d.mode === "live" ? autoSyncInfo() : null;
  res.json(d);
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
  .then(() =>
    app.listen(port, () => {
      console.log(`API ready on http://localhost:${port} (MongoDB connected)`);
      startScheduler();
    })
  )
  .catch((err) => {
    console.error("Could not connect to MongoDB:", err.message);
    process.exit(1);
  });
