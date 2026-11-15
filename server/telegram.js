// Telegram (decision #64). The user signs in to their own Telegram account from the Integrations page: phone number,
// the code Telegram sends, and their two-step password if they set one. The app keeps only the session, encrypted;
// never the code or the password. It reads a bounded set of recent chats, stores message text encrypted, and is
// read-only: nothing is sent. Disconnect signs the session out of Telegram and deletes the chats here.
//
// Message text is untrusted data (AGENTS.md rule 6): it is shown to the user, never fed into a prompt or a tool.

/** Bounded work (rule 8): the most recent chats, the most recent messages in each, within the lookback window. */
export const MAX_CHATS = 30;
export const MAX_MESSAGES = 40;
export const LOOKBACK_DAYS = 30;
/** With people chosen, how far down the chat list to look for them (chat names only, no messages). */
export const SEARCH_DIALOGS = 200;
export const MAX_PEOPLE = 30;
const NAME_MAX = 80;
/** Telegram's own limit for one text message. */
export const MAX_SEND_CHARS = 4096;
/** Bump when the insight prompt or shape changes, so saved insights are made again. */
const INSIGHT_VERSION = 1;
const LOGIN_TTL_MS = 10 * 60_000;
/** The longest any single call to Telegram may take before the user gets a message instead of a spinner. */
const TIMEOUT_MS = 25_000;

const env = (...names) => names.map((n) => process.env[n]).find((v) => typeof v === "string" && v.trim()) ?? "";

/** api_id / api_hash from my.telegram.org. Accepts TELEGRAM_API_ID or API_ID (and the lowercase spellings). */
export function telegramConfig() {
  const apiId = Number(env("TELEGRAM_API_ID", "API_ID", "api_id"));
  const apiHash = env("TELEGRAM_API_HASH", "API_HASH", "api_hash").trim();
  return Number.isInteger(apiId) && apiId > 0 && apiHash ? { apiId, apiHash } : null;
}

class TelegramError extends Error {}
const fail = (message) => { throw new TelegramError(message); };

/** Telegram's error codes in plain words. Unknown errors keep a short generic message (no internals). */
function friendly(err) {
  if (err instanceof TelegramError) return err;
  const code = err?.errorMessage ?? "";
  if (code === "PHONE_NUMBER_INVALID") return new TelegramError("Telegram doesn't recognise that phone number. Include the country code, like +961 70 123 456.");
  if (code === "PHONE_NUMBER_BANNED") return new TelegramError("Telegram has blocked this phone number.");
  if (code === "PHONE_CODE_INVALID" || code === "PHONE_CODE_EMPTY") return new TelegramError("That code isn't right. Check the latest code in your Telegram app and try again.");
  if (code === "PHONE_CODE_EXPIRED") return new TelegramError("That code has expired. Ask for a new code.");
  if (code === "PASSWORD_HASH_INVALID") return new TelegramError("That password isn't right. It's your Telegram two-step verification password.");
  if (code === "AUTH_KEY_UNREGISTERED" || code === "SESSION_REVOKED" || code === "USER_DEACTIVATED") return new TelegramError("Telegram signed this app out. Connect Telegram again.");
  if (/^FLOOD_WAIT/.test(code) || err?.seconds) {
    const minutes = Math.max(1, Math.ceil(Number(err.seconds || 60) / 60));
    return new TelegramError(`Telegram asks to wait ${minutes} minute${minutes === 1 ? "" : "s"} before trying again.`);
  }
  return new TelegramError("Telegram didn't answer as expected. Try again in a moment.");
}

/** "+961 71 728 871" or "00961…" → "+96171728871". Without a country code it refuses rather than guess one. */
const normalisePhone = (raw) => {
  const compact = String(raw ?? "").replace(/[\s().-]/g, "").replace(/^00/, "+");
  if (!/^\+?\d{7,15}$/.test(compact)) fail("Enter your phone number with the country code, like +961 70 123 456.");
  if (!compact.startsWith("+")) fail("Add your country code at the start, like +961 71 728 871 (Lebanon is +961).");
  return compact;
};
const words = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Whether a chat belongs to the people the user follows: every word of a chosen name starts a word of the chat's name
 * ("Karim" and "karim h" both match "Karim Haddad"; accents and case don't matter). No names chosen: every chat.
 */
export function matchesPeople(title, people) {
  if (!people?.length) return true;
  const titleWords = words(title);
  return people.some((name) => {
    const wanted = words(name);
    return wanted.length > 0 && wanted.every((w) => titleWords.some((tw) => tw.startsWith(w)));
  });
}

const maskPhone = (phone) => (phone ? `•••• ${String(phone).slice(-4)}` : null);
const fullName = (u) => [u?.firstName, u?.lastName].filter(Boolean).join(" ") || u?.username || "Telegram account";

/**
 * The Telegram integration. `connect(session)` returns a connected client adapter (see gramConnect); `store` keeps
 * the connection, chats and messages (mongoTelegramStore in the app, memoryTelegramStore in tests).
 */
export function createTelegram({ store, connect: open, encrypt, decrypt, config = telegramConfig(), now = () => new Date(), timeoutMs = TIMEOUT_MS, analyze = null }) {
  /** Every call to Telegram gets a time limit, so a blocked or slow network ends with a message, not a spinner. */
  const within = (promise) => {
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new TelegramError("Couldn't reach Telegram. Check this computer's internet connection and try again.")), timeoutMs);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  };
  /** A connection that arrives after its time limit is closed straight away. */
  const connect = (session) => {
    const opening = Promise.resolve(open(session));
    return within(opening).catch((err) => {
      opening.then((client) => client?.disconnect?.().catch(() => {}), () => {});
      throw err;
    });
  };

  /** A sign-in in progress (one at a time; this is a single-user workspace). */
  let pending = null;
  let syncing = null;

  const dropPending = async () => {
    const p = pending;
    pending = null;
    await p?.client.disconnect().catch(() => {});
  };
  const livePending = async () => {
    if (pending && pending.expiresAt < now().getTime()) await dropPending();
    return pending;
  };

  async function status() {
    const conn = await store.getConnection();
    const p = await livePending();
    return {
      configured: Boolean(config),
      connected: Boolean(conn?.sessionEnc),
      account: conn?.account ?? null,
      status: syncing ? "syncing" : conn?.status ?? null,
      error: conn?.error ?? null,
      lastSyncAt: conn?.lastSyncAt ?? null,
      lastSyncCount: conn?.lastSyncCount ?? null,
      chatCount: conn?.sessionEnc ? await store.countChats() : 0,
      pending: p?.step ?? null,
      people: conn?.people ?? [],
      insightsAvailable: Boolean(analyze),
    };
  }

  async function requestCode(phoneRaw) {
    if (!config) fail("Telegram isn't set up on the server. Add TELEGRAM_API_ID and TELEGRAM_API_HASH (from my.telegram.org) and restart it.");
    const phone = normalisePhone(phoneRaw);
    await dropPending();
    const client = await connect("");
    try {
      const { phoneCodeHash, viaApp } = await within(client.sendCode(phone));
      pending = { client, phone, phoneCodeHash, step: "code", expiresAt: now().getTime() + LOGIN_TTL_MS };
      return { sent: true, viaApp: Boolean(viaApp) };
    } catch (err) {
      await client.disconnect().catch(() => {});
      throw friendly(err);
    }
  }

  async function finish() {
    const { client } = pending;
    const me = await within(client.me());
    await store.saveConnection({
      sessionEnc: encrypt(client.save()),
      account: { id: String(me?.id ?? ""), name: fullName(me), username: me?.username ?? null, phone: maskPhone(me?.phone) },
      status: "connected",
      error: null,
      connectedAt: now(),
    });
    await dropPending();
    return { connected: true };
  }

  async function verifyCode(codeRaw) {
    const p = await livePending();
    if (!p || p.step !== "code") fail("Start again: ask for a new code.");
    const code = String(codeRaw ?? "").replace(/\s/g, "");
    if (!/^\d{4,8}$/.test(code)) fail("Enter the code from your Telegram app (numbers only).");
    try {
      await within(p.client.signIn(p.phone, p.phoneCodeHash, code));
    } catch (err) {
      if (err?.errorMessage === "SESSION_PASSWORD_NEEDED") {
        p.step = "password";
        return { needsPassword: true };
      }
      if (err?.errorMessage === "PHONE_CODE_EXPIRED") await dropPending();
      throw friendly(err);
    }
    return finish();
  }

  async function verifyPassword(password) {
    const p = await livePending();
    if (!p || p.step !== "password") fail("Start again: ask for a new code.");
    if (typeof password !== "string" || !password) fail("Enter your two-step verification password.");
    try {
      await within(p.client.checkPassword(password));
    } catch (err) {
      throw friendly(err);
    }
    return finish();
  }

  async function cancelLogin() {
    await dropPending();
    return { cancelled: true };
  }

  async function withSession(fn) {
    const conn = await store.getConnection();
    if (!conn?.sessionEnc) fail("Connect Telegram first.");
    const client = await connect(decrypt(conn.sessionEnc));
    try { return await fn(client); } finally { await client.disconnect().catch(() => {}); }
  }

  async function runSync() {
    const since = Math.floor(now().getTime() / 1000) - LOOKBACK_DAYS * 86_400;
    const people = (await store.getConnection())?.people ?? [];
    await store.saveConnection({ status: "syncing", error: null });
    try {
      const counts = await withSession(async (client) => {
        // With people chosen, look further down the chat list (names only) to find them; read only their messages.
        const listed = await client.dialogs(people.length ? SEARCH_DIALOGS : MAX_CHATS);
        const dialogs = listed.filter((d) => d.date >= since && matchesPeople(d.title, people)).slice(0, MAX_CHATS);
        let total = 0;
        const chats = [];
        // One chat at a time: Telegram rate-limits bursts.
        for (const d of dialogs) {
          const recent = (await client.messages(d.entity, MAX_MESSAGES)).filter((m) => m.date >= since);
          await store.upsertMessages(String(d.id), recent.map((m) => ({
            id: m.id,
            date: new Date(m.date * 1000),
            out: Boolean(m.out),
            from: m.out ? null : (m.from ?? d.title),
            hasMedia: Boolean(m.media),
            textEnc: m.text ? encrypt(m.text) : null,
          })));
          total += recent.length;
          chats.push({ id: String(d.id), title: d.title || "Untitled chat", kind: d.kind, unread: d.unread ?? 0, lastMessageAt: new Date(d.date * 1000), messageCount: recent.length });
        }
        await store.replaceChats(chats);
        return { chats: chats.length, messages: total };
      });
      await store.saveConnection({ status: "connected", error: null, lastSyncAt: now(), lastSyncCount: counts.messages });
      return counts;
    } catch (err) {
      const e = friendly(err);
      await store.saveConnection({ status: "error", error: e.message });
      throw e;
    }
  }

  /** Reads recent chats. A second call while one runs waits for the same run. */
  function sync() {
    syncing ??= runSync().finally(() => { syncing = null; });
    return syncing;
  }

  async function disconnect() {
    await dropPending();
    const conn = await store.getConnection();
    if (conn?.sessionEnc) await withSession((client) => client.logOut()).catch(() => {}); // already signed out is fine
    await store.deleteAll();
    return { disconnected: true };
  }

  const chats = () => store.listChats();
  async function messages(chatId) {
    const rows = await store.listMessages(String(chatId));
    return rows.map(({ textEnc, ...m }) => ({ ...m, text: textEnc ? decrypt(textEnc) : "" }));
  }

  /** The people the user follows, by name. Saved as typed (trimmed, no duplicates); the next read applies it. */
  async function setPeople(list) {
    if (!Array.isArray(list)) fail("Send the people as a list of names.");
    const people = [];
    for (const raw of list) {
      const name = String(raw ?? "").trim().replace(/\s+/g, " ");
      if (!name) continue;
      if (name.length > NAME_MAX) fail(`That name is too long (${NAME_MAX} characters at most).`);
      if (!people.some((p) => p.toLowerCase() === name.toLowerCase())) people.push(name);
    }
    if (people.length > MAX_PEOPLE) fail(`Choose up to ${MAX_PEOPLE} people.`);
    await store.saveConnection({ people });
    return { people };
  }

  /** Only chats this app has read (the followed people) can be analysed or written to. */
  async function followedChat(chatId) {
    const chat = await store.getChat(String(chatId ?? ""));
    if (!chat) fail("That chat isn't one of your followed chats. Read new messages, or add the person under Choose people.");
    return chat;
  }

  /**
   * What the chat is about, who is waiting on whom, promises and follow-ups (each pointing at the message it comes
   * from), the next step and a suggested message. An AI guess: made by `analyze` (Gemini), saved encrypted, and made
   * again only when the chat has a newer message or the user asks.
   */
  async function insight(chatId, { refresh = false } = {}) {
    const chat = await followedChat(chatId);
    const list = await messages(chat.id);
    if (!list.length) fail("There are no messages from the last 30 days in this chat to look at.");
    const basedOn = list.at(-1).id;
    const saved = chat.insight;
    if (!refresh && saved?.enc && saved.basedOn === basedOn && saved.version === INSIGHT_VERSION) {
      return { ...JSON.parse(decrypt(saved.enc)), basedOn, generatedAt: saved.at, model: saved.model };
    }
    if (!analyze) fail("AI insights need Gemini. Add GEMINI_API_KEY on the server and restart it.");
    const { insight: raw, model } = await analyze({
      chat: { title: chat.title, kind: chat.kind },
      now: now(),
      messages: list.map((m) => ({ id: m.id, date: m.date, from: m.out ? "You" : (m.from || chat.title), text: m.text, hasMedia: Boolean(m.hasMedia) })),
    });
    // Evidence before confidence (rule 3): a promise or follow-up must point at a message that is in this chat.
    const ids = new Set(list.map((m) => m.id));
    const clean = {
      ...raw,
      promises: (raw.promises ?? []).filter((p) => ids.has(p.messageId)),
      followUps: (raw.followUps ?? []).filter((f) => ids.has(f.messageId)),
    };
    const at = now();
    await store.saveInsight(chat.id, { enc: encrypt(JSON.stringify(clean)), basedOn, at, model: model ?? null, version: INSIGHT_VERSION });
    return { ...clean, basedOn, generatedAt: at, model: model ?? null };
  }

  /**
   * Sends one text message the user wrote and confirmed in the app (decision #65) to a followed chat. Never called by
   * the AI; nothing is sent on a schedule or from message content.
   */
  async function send(chatId, textRaw) {
    const text = String(textRaw ?? "").trim();
    if (!text) fail("Write a message first.");
    if (text.length > MAX_SEND_CHARS) fail(`That message is too long for Telegram (${MAX_SEND_CHARS} characters at most).`);
    const chat = await followedChat(chatId);
    let sent;
    try {
      sent = await withSession(async (client) => {
        const dialog = (await within(client.dialogs(SEARCH_DIALOGS))).find((d) => String(d.id) === chat.id);
        if (!dialog) fail("Telegram couldn't find this chat any more. Read new messages and try again.");
        return within(client.send(dialog.entity, text));
      });
    } catch (err) {
      throw friendly(err);
    }
    const row = { id: sent.id, date: sent.date ? new Date(sent.date * 1000) : now(), out: true, from: null, hasMedia: false };
    await store.upsertMessages(chat.id, [{ ...row, textEnc: encrypt(text) }]);
    await store.updateChat(chat.id, { lastMessageAt: row.date });
    return { ...row, chatId: chat.id, text };
  }

  return { status, requestCode, verifyCode, verifyPassword, cancelLogin, sync, disconnect, chats, messages, setPeople, insight, send };
}

/** In-memory store for tests. */
export function memoryTelegramStore() {
  let conn = null;
  let chats = [];
  const msgs = new Map();
  return {
    async getConnection() { return conn ? structuredClone(conn) : null; },
    async saveConnection(patch) { conn = { ...(conn ?? {}), ...patch }; },
    async countChats() { return chats.length; },
    async replaceChats(list) {
      const before = new Map(chats.map((c) => [c.id, c]));
      chats = structuredClone(list).map((c) => (before.get(c.id)?.insight ? { ...c, insight: before.get(c.id).insight } : c));
      for (const id of msgs.keys()) if (!chats.some((c) => c.id === id)) msgs.delete(id);
    },
    async getChat(id) { const c = chats.find((x) => x.id === id); return c ? structuredClone(c) : null; },
    async saveInsight(id, insight) { const c = chats.find((x) => x.id === id); if (c) c.insight = insight; },
    async updateChat(id, patch) { const c = chats.find((x) => x.id === id); if (c) Object.assign(c, patch); },
    async upsertMessages(chatId, list) {
      const byId = new Map((msgs.get(chatId) ?? []).map((m) => [m.id, m]));
      for (const m of list) byId.set(m.id, { chatId, ...m });
      msgs.set(chatId, [...byId.values()]);
    },
    async listChats() { return chats.toSorted((a, b) => b.lastMessageAt - a.lastMessageAt).map(({ insight: _insight, ...c }) => ({ ...c })); },
    async listMessages(chatId) { return (msgs.get(chatId) ?? []).toSorted((a, b) => a.date - b.date).map((m) => ({ ...m })); },
    async deleteAll() { conn = null; chats = []; msgs.clear(); },
    dump() { return { conn, chats, msgs: [...msgs.values()] }; },
  };
}

/** MongoDB store: `connections` (provider "telegram"), `telegram_chats`, `telegram_messages` (text encrypted). */
export function mongoTelegramStore(getDb) {
  const c = (name) => getDb().collection(name);
  return {
    async ensureIndexes() {
      await Promise.all([
        c("telegram_messages").createIndex({ chatId: 1, id: 1 }, { unique: true }),
        c("telegram_messages").createIndex({ chatId: 1, date: 1 }),
        c("telegram_chats").createIndex({ lastMessageAt: -1 }),
      ]);
    },
    getConnection: () => c("connections").findOne({ provider: "telegram" }, { projection: { _id: 0 } }),
    async saveConnection(patch) {
      await c("connections").updateOne({ provider: "telegram" }, { $set: { ...patch, updatedAt: new Date() }, $setOnInsert: { provider: "telegram", createdAt: new Date() } }, { upsert: true });
    },
    countChats: () => c("telegram_chats").countDocuments(),
    async replaceChats(list) {
      const ids = list.map((x) => x.id);
      await c("telegram_chats").deleteMany({ _id: { $nin: ids } });
      // $set, not replace: a chat keeps its saved insight between reads.
      if (list.length) await c("telegram_chats").bulkWrite(list.map((x) => ({ updateOne: { filter: { _id: x.id }, update: { $set: x }, upsert: true } })));
      await c("telegram_messages").deleteMany({ chatId: { $nin: ids } });
    },
    getChat: (id) => c("telegram_chats").findOne({ _id: id }, { projection: { _id: 0 } }),
    async saveInsight(id, insight) { await c("telegram_chats").updateOne({ _id: id }, { $set: { insight } }); },
    async updateChat(id, patch) { await c("telegram_chats").updateOne({ _id: id }, { $set: patch }); },
    async upsertMessages(chatId, list) {
      if (!list.length) return;
      await c("telegram_messages").bulkWrite(list.map((m) => ({ replaceOne: { filter: { chatId, id: m.id }, replacement: { chatId, ...m }, upsert: true } })), { ordered: false });
    },
    listChats: () => c("telegram_chats").find({}, { projection: { _id: 0, insight: 0 } }).sort({ lastMessageAt: -1 }).limit(MAX_CHATS).toArray(),
    listMessages: (chatId) => c("telegram_messages").find({ chatId }, { projection: { _id: 0 } }).sort({ date: 1 }).limit(MAX_MESSAGES * 3).toArray(),
    async deleteAll() {
      await Promise.all([c("connections").deleteOne({ provider: "telegram" }), c("telegram_chats").deleteMany({}), c("telegram_messages").deleteMany({})]);
    },
  };
}

/**
 * The real client: GramJS (MTProto) wrapped in the small adapter createTelegram uses. Loaded only when Telegram is
 * used, and silent: GramJS logging is off so no message text or phone number reaches the server log.
 */
export function gramConnect(config = telegramConfig()) {
  return async (session) => {
    if (!config) fail("Telegram isn't set up on the server.");
    const [{ TelegramClient, Api }, { StringSession }, { computeCheck }] = await Promise.all([
      import("telegram"), import("telegram/sessions/index.js"), import("telegram/Password.js"),
    ]);
    // useWSS: Telegram's web connection (WebSocket over https, port 443). Some networks drop Telegram's own protocol
    // (MTProto over TCP) and let this through, as on the machine this was built on.
    const client = new TelegramClient(new StringSession(session || ""), config.apiId, config.apiHash, { connectionRetries: 3, useWSS: true });
    client.setLogLevel("none");
    await client.connect();
    const kindOf = (d) => (d.isChannel && !d.isGroup ? "channel" : d.isGroup ? "group" : "user");
    return {
      async sendCode(phone) {
        const r = await client.sendCode({ apiId: config.apiId, apiHash: config.apiHash }, phone);
        return { phoneCodeHash: r.phoneCodeHash, viaApp: r.isCodeViaApp };
      },
      async signIn(phoneNumber, phoneCodeHash, phoneCode) {
        const r = await client.invoke(new Api.auth.SignIn({ phoneNumber, phoneCodeHash, phoneCode }));
        if (r instanceof Api.auth.AuthorizationSignUpRequired) fail("There's no Telegram account for this number. Sign up in the Telegram app first.");
      },
      async checkPassword(password) {
        const info = await client.invoke(new Api.account.GetPassword());
        await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(info, password) }));
      },
      me: () => client.getMe(),
      async dialogs(limit) {
        const list = await client.getDialogs({ limit });
        return list.map((d) => ({ id: String(d.id), title: d.title, kind: kindOf(d), unread: d.unreadCount, date: d.date, entity: d.entity }));
      },
      async messages(entity, limit) {
        const list = await client.getMessages(entity, { limit });
        return list.map((m) => ({
          id: m.id, date: m.date, text: m.message || "", out: Boolean(m.out), media: Boolean(m.media),
          from: m.sender ? fullName(m.sender) || m.sender.title : m.postAuthor || null,
        }));
      },
      /** One plain-text message (no formatting parsed), only ever called by createTelegram's send(). */
      async send(entity, text) {
        const m = await client.sendMessage(entity, { message: text, parseMode: false, linkPreview: false });
        return { id: m.id, date: m.date };
      },
      logOut: () => client.invoke(new Api.auth.LogOut()),
      save: () => client.session.save(),
      disconnect: () => client.disconnect(),
    };
  };
}
