import "dotenv/config";
import express from "express";
import { connectDb, getDb, pingDb } from "./db.js";
import { authUrl, consumeState, disconnectGmail, googleConfigured, handleCallback, syncGmail } from "./gmail.js";
import { buildDashboard } from "./dashboard.js";
import { seedSample } from "./sample.js";

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
  };
}

app.get("/api/status", wrap(async (_req, res) => {
  const conn = await getDb().collection("connections").findOne({ provider: "gmail" });
  res.json({ database: await pingDb(), googleConfigured: googleConfigured(), gmail: publicConnection(conn) });
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
    syncGmail().catch(() => {}); // first sync runs in the background; status is visible in the UI
    res.redirect(`${APP_URL}/?gmail=connected#/integrations`);
  } catch (err) {
    console.error("OAuth callback failed:", err.message);
    res.redirect(`${APP_URL}/?gmail=failed#/integrations`);
  }
});

app.post("/api/integrations/gmail/sync", wrap(async (_req, res) => res.json(await syncGmail())));
app.post("/api/integrations/gmail/sample", wrap(async (_req, res) => res.json(await seedSample())));
app.delete("/api/integrations/gmail", wrap(async (_req, res) => {
  await disconnectGmail();
  res.json({ ok: true });
}));
app.get("/api/dashboard", wrap(async (_req, res) => res.json(await buildDashboard())));

// API_PORT (not PORT): dev tools often set PORT for the web server.
const port = Number(process.env.API_PORT || 8787);
connectDb()
  .then(() => app.listen(port, () => console.log(`API ready on http://localhost:${port} (MongoDB connected)`)))
  .catch((err) => {
    console.error("Could not connect to MongoDB:", err.message);
    process.exit(1);
  });
