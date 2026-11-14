import crypto from "node:crypto";
import { getDb } from "./db.js";
import { encrypt, decrypt } from "./crypto.js";
import { normalizeMessage } from "./gmail-parse.js";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const LOOKBACK_DAYS = Number(process.env.GMAIL_LOOKBACK_DAYS || 30);
const MAX_MESSAGES = Number(process.env.GMAIL_MAX_MESSAGES || 300);

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
  const profile = await gmailFetch(tokens.access_token, "profile", 1);
  const now = new Date();
  const existing = await getDb().collection("connections").findOne({ provider: "gmail" });
  // Switching accounts or replacing sample data: start from a clean store.
  if (!existing || existing.mode !== "live" || existing.email !== profile.emailAddress) {
    await getDb().collection("messages").deleteMany({});
    await getDb().collection("labels").deleteMany({});
  }
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
        historyId: existing?.mode === "live" && existing.email === profile.emailAddress ? existing.historyId ?? null : null,
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

// ---------------------------------------------------------------------------
// Gmail API access with quota pacing.
// Gmail allows 6,000 quota units per user per minute. messages.get with format=full costs 60
// (20 for minimal/metadata), messages.list 5, history.list 2, labels.list 1, getProfile 1.
// We keep a rolling one-minute budget below the limit and retry 429 / rate-limit 403s with backoff.
// ---------------------------------------------------------------------------
const QUOTA_PER_MINUTE = 5400;
const spent = []; // [timestamp, units]

async function takeQuota(units) {
  for (;;) {
    const now = Date.now();
    while (spent.length && now - spent[0][0] > 60_000) spent.shift();
    const used = spent.reduce((s, [, u]) => s + u, 0);
    if (used + units <= QUOTA_PER_MINUTE) {
      spent.push([now, units]);
      return;
    }
    await new Promise((r) => setTimeout(r, Math.max(250, 60_000 - (now - spent[0][0]))));
  }
}

class GmailHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function gmailFetch(token, path, units = 5) {
  for (let attempt = 0; ; attempt++) {
    await takeQuota(units);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return res.json();
    const body = await res.json().catch(() => ({}));
    const reason = body?.error?.errors?.[0]?.reason || "";
    const rateLimited = res.status === 429 || (res.status === 403 && /rateLimit|userRateLimit/i.test(reason));
    if (rateLimited && attempt < 5) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt + Math.random() * 500));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new GmailHttpError(res.status, "Google refused access. Reconnect Gmail.");
    throw new GmailHttpError(res.status, `Gmail API error ${res.status}${reason ? ` (${reason})` : ""}`);
  }
}

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

async function setProgress(connId, done, total, phase) {
  await getDb().collection("connections").updateOne({ _id: connId }, { $set: { syncProgress: { done, total, phase } } });
}

/** Labels with unread/total counts (1 + 1 unit per label). */
async function syncLabels(token) {
  const { labels = [] } = await gmailFetch(token, "labels", 1);
  const detailed = await mapLimit(labels, 4, (l) => gmailFetch(token, `labels/${encodeURIComponent(l.id)}`, 1));
  const col = getDb().collection("labels");
  await col.deleteMany({});
  if (detailed.length)
    await col.insertMany(
      detailed.map((l) => ({
        labelId: l.id,
        name: l.name,
        type: l.type,
        messagesTotal: l.messagesTotal ?? 0,
        messagesUnread: l.messagesUnread ?? 0,
        threadsTotal: l.threadsTotal ?? 0,
        threadsUnread: l.threadsUnread ?? 0,
        color: l.color ?? null,
      }))
    );
  return detailed.length;
}

/**
 * Applies label changes / deletions since the last sync using history.list (2 units/page).
 * Returns false when the stored historyId is too old (404): the caller then refreshes labels the slow way.
 */
async function applyHistory(token, startHistoryId) {
  const col = getDb().collection("messages");
  let pageToken;
  try {
    do {
      const types = ["labelAdded", "labelRemoved", "messageDeleted"].map((t) => `historyTypes=${t}`).join("&");
      const page = await gmailFetch(token, `history?startHistoryId=${startHistoryId}&${types}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`, 2);
      for (const h of page.history || []) {
        for (const a of h.labelsAdded || [])
          await col.updateOne({ gmailId: a.message.id }, { $addToSet: { labelIds: { $each: a.labelIds } } });
        for (const r of h.labelsRemoved || [])
          await col.updateOne({ gmailId: r.message.id }, { $pull: { labelIds: { $in: r.labelIds } } });
        for (const d of h.messagesDeleted || []) await col.deleteOne({ gmailId: d.message.id });
      }
      pageToken = page.nextPageToken;
    } while (pageToken);
    return true;
  } catch (err) {
    if (err instanceof GmailHttpError && err.status === 404) return false;
    throw err;
  }
}

/** Keeps the label-derived flags in step with labelIds after history updates. */
async function refreshLabelFlags() {
  const col = getDb().collection("messages");
  await col.updateMany({ source: "gmail" }, [
    {
      $set: {
        isUnread: { $in: ["UNREAD", "$labelIds"] },
        isStarred: { $in: ["STARRED", "$labelIds"] },
        isImportant: { $in: ["IMPORTANT", "$labelIds"] },
      },
    },
  ]);
}

/**
 * Full sync, step by step:
 *  1. profile (totals + historyId)        2. labels with counts
 *  3. label changes since last sync (history.list), cheap
 *  4. list message IDs in the lookback window (all categories, no spam/trash)
 *  5. fetch only NEW messages with format=full → headers, body, attachments
 *  6. drop messages that fell out of the window
 */
export async function syncGmail() {
  const db = getDb();
  const conn = await db.collection("connections").findOne({ provider: "gmail" });
  if (!conn || conn.mode !== "live") throw new Error("Gmail is not connected");

  await db.collection("connections").updateOne({ _id: conn._id }, { $set: { status: "syncing", error: null } });
  try {
    const token = await accessToken(conn);
    await setProgress(conn._id, 0, 0, "Reading your mailbox");
    const profile = await gmailFetch(token, "profile", 1);
    await syncLabels(token);

    const col = db.collection("messages");
    if (conn.historyId) {
      const ok = await applyHistory(token, conn.historyId);
      if (!ok) await col.deleteMany({ source: "gmail" }); // history expired: re-import cleanly
      else await refreshLabelFlags();
    }

    const ids = [];
    let pageToken;
    do {
      const q = encodeURIComponent(`newer_than:${LOOKBACK_DAYS}d`);
      const page = await gmailFetch(token, `messages?q=${q}&maxResults=500${pageToken ? `&pageToken=${pageToken}` : ""}`, 5);
      ids.push(...(page.messages || []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < MAX_MESSAGES);
    const wanted = ids.slice(0, MAX_MESSAGES);

    const have = new Set((await col.find({ gmailId: { $in: wanted } }, { projection: { gmailId: 1 } }).toArray()).map((d) => d.gmailId));
    const fresh = wanted.filter((id) => !have.has(id));

    let done = 0;
    await setProgress(conn._id, 0, fresh.length, "Importing email");
    const BATCH = 25;
    for (let i = 0; i < fresh.length; i += BATCH) {
      const slice = fresh.slice(i, i + BATCH);
      const full = await mapLimit(slice, 4, (id) => gmailFetch(token, `messages/${id}?format=full`, 60));
      const ops = full.map((m) => {
        const { doc, bodyText } = normalizeMessage(m, conn.email);
        return {
          updateOne: {
            filter: { gmailId: doc.gmailId },
            update: { $set: { ...doc, bodyEnc: bodyText ? encrypt(bodyText) : null, syncedAt: new Date() } },
            upsert: true,
          },
        };
      });
      if (ops.length) await col.bulkWrite(ops, { ordered: false });
      done += slice.length;
      await setProgress(conn._id, done, fresh.length, "Importing email");
    }

    // Keep the store bounded to the window we show.
    await col.deleteMany({ source: "gmail", gmailId: { $nin: wanted } });

    const count = await col.countDocuments({ source: "gmail" });
    await db.collection("connections").updateOne(
      { _id: conn._id },
      {
        $set: {
          status: "connected",
          lastSyncAt: new Date(),
          lastSyncCount: count,
          lastSyncNew: fresh.length,
          historyId: profile.historyId,
          mailbox: { messagesTotal: profile.messagesTotal, threadsTotal: profile.threadsTotal },
          error: null,
          syncProgress: null,
        },
      }
    );
    return { count, new: fresh.length };
  } catch (err) {
    await db.collection("connections").updateOne({ _id: conn._id }, { $set: { status: "error", error: err.message, syncProgress: null } });
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
  await db.collection("labels").deleteMany({});
  await db.collection("connections").deleteOne({ provider: "gmail" });
}
