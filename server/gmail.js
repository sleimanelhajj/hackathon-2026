import crypto from "node:crypto";
import { getDb } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const LOOKBACK_DAYS = 30;
const MAX_MESSAGES = 300;

// Short-lived OAuth state values (CSRF protection). In-memory is fine for a single dev server.
const pendingStates = new Map();

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function authUrl() {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.set(state, Date.now() + 10 * 60 * 1000);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function consumeState(state) {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return Boolean(exp && exp > Date.now());
}

async function tokenRequest(body) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      ...body,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error_description || json.error || "Token request failed");
  return json;
}

export async function handleCallback(code) {
  const tok = await tokenRequest({
    code,
    grant_type: "authorization_code",
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
  });
  const tokens = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    expires_at: Date.now() + (tok.expires_in - 60) * 1000,
  };
  const profile = await gmailFetch(tokens.access_token, "profile");
  const now = new Date();
  await getDb().collection("connections").updateOne(
    { provider: "gmail" },
    {
      $set: {
        provider: "gmail",
        mode: "live",
        email: profile.emailAddress,
        scopes: (tok.scope || SCOPES.join(" ")).split(" "),
        tokens: encrypt(tokens),
        status: "connected",
        error: null,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
}

async function accessToken(conn) {
  const tokens = decrypt(conn.tokens);
  if (tokens.expires_at > Date.now()) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error("Gmail access expired. Reconnect Gmail.");
  const tok = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
  const next = { ...tokens, access_token: tok.access_token, expires_at: Date.now() + (tok.expires_in - 60) * 1000 };
  await getDb().collection("connections").updateOne({ _id: conn._id }, { $set: { tokens: encrypt(next) } });
  return next.access_token;
}

async function gmailFetch(token, path) {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error("Google refused access. Reconnect Gmail.");
  if (!res.ok) throw new Error(`Gmail API error ${res.status}`);
  return res.json();
}

function parseAddress(raw = "") {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/);
  if (m) return { name: m[1].trim() || m[2], email: m[2].toLowerCase() };
  return { name: raw.trim(), email: raw.trim().toLowerCase() };
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function syncGmail() {
  const db = getDb();
  const conn = await db.collection("connections").findOne({ provider: "gmail" });
  if (!conn || conn.mode !== "live") throw new Error("Gmail is not connected");

  await db.collection("connections").updateOne({ _id: conn._id }, { $set: { status: "syncing", error: null } });
  try {
    const token = await accessToken(conn);
    const ids = [];
    let pageToken;
    do {
      const q = encodeURIComponent(`newer_than:${LOOKBACK_DAYS}d -category:promotions -category:social`);
      const page = await gmailFetch(token, `messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`);
      ids.push(...(page.messages || []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < MAX_MESSAGES);

    const self = conn.email.toLowerCase();
    const metas = await mapLimit(ids.slice(0, MAX_MESSAGES), 8, (id) =>
      gmailFetch(token, `messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)
    );

    const ops = metas.map((m) => {
      const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
      const from = parseAddress(h.from);
      const labels = m.labelIds || [];
      return {
        updateOne: {
          filter: { gmailId: m.id },
          update: {
            $set: {
              gmailId: m.id,
              threadId: m.threadId,
              from,
              to: h.to || "",
              subject: h.subject || "(no subject)",
              snippet: m.snippet || "",
              date: new Date(Number(m.internalDate)),
              labelIds: labels,
              direction: labels.includes("SENT") || from.email === self ? "out" : "in",
              source: "gmail",
            },
          },
          upsert: true,
        },
      };
    });
    if (ops.length) await db.collection("messages").bulkWrite(ops, { ordered: false });

    await db.collection("connections").updateOne(
      { _id: conn._id },
      { $set: { status: "connected", lastSyncAt: new Date(), lastSyncCount: ops.length, error: null } }
    );
    return { count: ops.length };
  } catch (err) {
    await db.collection("connections").updateOne({ _id: conn._id }, { $set: { status: "error", error: err.message } });
    throw err;
  }
}

export async function disconnectGmail() {
  const db = getDb();
  const conn = await db.collection("connections").findOne({ provider: "gmail" });
  if (conn?.mode === "live" && conn.tokens) {
    try {
      const { refresh_token, access_token } = decrypt(conn.tokens);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${refresh_token || access_token}`, { method: "POST" });
    } catch {
      // Revocation is best effort; local data is deleted regardless.
    }
  }
  await db.collection("messages").deleteMany({});
  await db.collection("extractions").deleteMany({}); // AI labels derived from those messages go too
  await db.collection("connections").deleteOne({ provider: "gmail" });
}
