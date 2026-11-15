// Telegram (server/telegram.js, decision #64): the user signs in with their phone number and the code Telegram sends
// (plus their two-step password if they set one). The app keeps only an encrypted session, reads recent chats
// (bounded), stores message text encrypted, and signs out of Telegram on disconnect. Read-only: nothing is sent.
import assert from "node:assert/strict";
import test from "node:test";
import { createTelegram, memoryTelegramStore } from "../../server/telegram.js";

const day = 86_400_000;
const NOW = new Date("2026-11-15T12:00:00Z");
const secs = (d) => Math.floor(d.getTime() / 1000);

/** A fake Telegram account behind the client adapter the module expects. */
function fakeTelegram({ password = null, code = "12345", dialogs = [], messages = {} } = {}) {
  const calls = [];
  let signedIn = false;
  const make = async (session) => {
    calls.push(["connect", session ? "saved" : "new"]);
    if (session === "saved-session") signedIn = true;
    return {
      async sendCode(phone) { calls.push(["sendCode", phone]); return { phoneCodeHash: "hash-1", viaApp: true }; },
      async signIn(phone, hash, c) {
        calls.push(["signIn", phone, hash]);
        if (c !== code) throw Object.assign(new Error("bad"), { errorMessage: "PHONE_CODE_INVALID" });
        if (password) throw Object.assign(new Error("2fa"), { errorMessage: "SESSION_PASSWORD_NEEDED" });
        signedIn = true;
      },
      async checkPassword(p) {
        if (p !== password) throw Object.assign(new Error("bad"), { errorMessage: "PASSWORD_HASH_INVALID" });
        signedIn = true;
      },
      async me() { return { id: "42", firstName: "Rami", lastName: "Haddad", username: "rami", phone: "96170123456" }; },
      async dialogs(limit) { calls.push(["dialogs", limit]); return dialogs.slice(0, limit); },
      async messages(entity, limit) { calls.push(["messages", entity, limit]); return (messages[entity] ?? []).slice(0, limit); },
      async send(entity, text) { calls.push(["send", entity, text]); return { id: 500 + calls.length, date: Math.floor(Date.now() / 1000) }; },
      async logOut() { calls.push(["logOut"]); signedIn = false; },
      save() { return signedIn ? "saved-session" : ""; },
      async disconnect() { calls.push(["disconnect"]); },
    };
  };
  return { make, calls };
}

// Stands in for AES-GCM: reversible, and the stored text is no longer readable.
const crypt = { encrypt: (v) => `enc:${Buffer.from(JSON.stringify(v)).toString("base64")}`, decrypt: (s) => JSON.parse(Buffer.from(s.slice(4), "base64").toString()) };
const setup = (account, extra = {}) => {
  const store = memoryTelegramStore();
  const tg = createTelegram({ store, connect: account.make, ...crypt, config: { apiId: 1, apiHash: "h" }, now: () => NOW, ...extra });
  return { store, tg };
};

test("not configured: it says so and refuses to start a sign-in", async () => {
  const { tg } = setup(fakeTelegram(), { config: null });
  assert.equal((await tg.status()).configured, false);
  await assert.rejects(tg.requestCode("+961 70 123 456"), /TELEGRAM_API_ID/);
});

test("phone, then code: connected, and only an encrypted session is kept", async () => {
  const account = fakeTelegram();
  const { tg, store } = setup(account);
  await assert.rejects(tg.requestCode("call me"), /phone number/i);
  const sent = await tg.requestCode("+961 70 123 456");
  assert.equal(sent.sent, true);
  assert.deepEqual(account.calls.find((c) => c[0] === "sendCode"), ["sendCode", "+96170123456"]);
  assert.equal((await tg.status()).pending, "code");
  await assert.rejects(tg.verifyCode("00000"), /code isn't right/i);
  const done = await tg.verifyCode("12345");
  assert.equal(done.connected, true);
  const conn = await store.getConnection();
  assert.equal(conn.sessionEnc, crypt.encrypt("saved-session"));
  assert.equal(JSON.stringify(conn).includes("12345"), false, "the login code is never stored");
  const s = await tg.status();
  assert.equal(s.connected, true);
  assert.equal(s.account.name, "Rami Haddad");
  assert.equal(s.account.phone, "•••• 3456");
  assert.equal(s.pending, null);
});

test("two-step password: asked after the code, wrong one is refused, never stored", async () => {
  const { tg, store } = setup(fakeTelegram({ password: "open sesame" }));
  await tg.requestCode("+96170123456");
  assert.deepEqual(await tg.verifyCode("12345"), { needsPassword: true });
  assert.equal((await tg.status()).pending, "password");
  await assert.rejects(tg.verifyPassword("nope"), /password isn't right/i);
  assert.equal((await tg.verifyPassword("open sesame")).connected, true);
  assert.equal(JSON.stringify(await store.getConnection()).includes("open sesame"), false);
});

test("a code without asking for one first says to start again", async () => {
  const { tg } = setup(fakeTelegram());
  await assert.rejects(tg.verifyCode("12345"), /ask for a new code/i);
});

test("sync reads a bounded set of recent chats, keeps text encrypted, and lists chats without text", async () => {
  const dialogs = [
    { id: "100", title: "Frem Electric", kind: "user", unread: 2, date: secs(NOW), entity: "e100" },
    { id: "200", title: "Store team", kind: "group", unread: 0, date: secs(new Date(NOW - day)), entity: "e200" },
  ];
  const messages = {
    e100: [
      { id: 1, date: secs(new Date(NOW - 2 * day)), text: "Can you send the invoice?", out: false, from: "Karim" },
      { id: 2, date: secs(new Date(NOW - 60 * day)), text: "too old", out: false, from: "Karim" },
    ],
    e200: [{ id: 7, date: secs(new Date(NOW - day)), text: "Stock count tomorrow", out: true, from: null, media: true }],
  };
  const account = fakeTelegram({ dialogs, messages });
  const { tg, store } = setup(account);
  await tg.requestCode("+96170123456");
  await tg.verifyCode("12345");
  const result = await tg.sync();
  assert.deepEqual(result, { chats: 2, messages: 2 });
  assert.ok(account.calls.some((c) => c[0] === "dialogs" && c[1] <= 50), "chats are capped");
  assert.ok(account.calls.filter((c) => c[0] === "messages").every((c) => c[2] <= 50), "messages per chat are capped");
  const chats = await tg.chats();
  assert.deepEqual(chats.map((c) => c.title), ["Frem Electric", "Store team"]);
  assert.equal(JSON.stringify(chats).includes("invoice"), false, "the chat list carries no message text");
  assert.equal(JSON.stringify(store.dump()).includes("Can you send the invoice?"), false, "text is stored encrypted");
  const thread = await tg.messages("100");
  assert.deepEqual(thread.map((m) => m.text), ["Can you send the invoice?"]);
  assert.equal(thread[0].from, "Karim");
  const team = await tg.messages("200");
  assert.equal(team[0].out, true);
  assert.equal(team[0].hasMedia, true);
  const s = await tg.status();
  assert.equal(s.lastSyncCount, 2);
  assert.equal(s.chatCount, 2);
});

test("a session Telegram revoked becomes a clear error to reconnect", async () => {
  const account = fakeTelegram();
  const { tg } = setup(account, {
    connect: async (session) => ({ ...(await account.make(session)), dialogs: async () => { throw Object.assign(new Error("x"), { errorMessage: "AUTH_KEY_UNREGISTERED" }); } }),
  });
  await tg.requestCode("+96170123456");
  await tg.verifyCode("12345");
  await assert.rejects(tg.sync(), /signed this app out/i);
  const s = await tg.status();
  assert.equal(s.status, "error");
  assert.match(s.error, /Connect Telegram again/);
});

test("disconnect signs out of Telegram and deletes the chats from this app", async () => {
  const account = fakeTelegram({ dialogs: [{ id: "1", title: "A", kind: "user", unread: 0, date: secs(NOW), entity: "e1" }], messages: { e1: [{ id: 1, date: secs(NOW), text: "hi", out: false, from: "A" }] } });
  const { tg, store } = setup(account);
  await tg.requestCode("+96170123456");
  await tg.verifyCode("12345");
  await tg.sync();
  await tg.disconnect();
  assert.ok(account.calls.some((c) => c[0] === "logOut"));
  assert.equal(await store.getConnection(), null);
  assert.deepEqual(await tg.chats(), []);
  assert.equal((await tg.status()).connected, false);
});

test("a number without its country code is refused, not guessed (71728871 would otherwise become +7…)", async () => {
  const account = fakeTelegram();
  const { tg } = setup(account);
  await assert.rejects(tg.requestCode("71 728 871"), /country code/i);
  await tg.requestCode("00961 71 728 871");
  assert.deepEqual(account.calls.find((c) => c[0] === "sendCode"), ["sendCode", "+96171728871"]);
});

test("Telegram that never answers ends with a clear message instead of waiting forever", async () => {
  const silent = { make: () => new Promise(() => {}) };
  const { tg } = setup(silent, { timeoutMs: 30 });
  await assert.rejects(tg.requestCode("+961 71 728 871"), /couldn't reach Telegram/i);
  assert.equal((await tg.status()).pending, null);
});

// ---------- Who to follow (the user names people) and AI insights per chat ----------
import { matchesPeople } from "../../server/telegram.js";

test("a name matches a chat when each word starts a word of the chat's name (any case, accents ignored)", () => {
  assert.equal(matchesPeople("Karim Haddad", []), true, "no names chosen: everyone");
  assert.equal(matchesPeople("Karim Haddad", ["karim"]), true);
  assert.equal(matchesPeople("Karim Haddad", ["Karim H"]), true);
  assert.equal(matchesPeople("Rémi Khoury", ["remi"]), true);
  assert.equal(matchesPeople("Frem Electric", ["karim", "frem"]), true);
  assert.equal(matchesPeople("Abdelkarim", ["karim"]), false, "the start of a word, not anywhere inside it");
  assert.equal(matchesPeople("Store team", ["karim"]), false);
});

const threeChats = () => {
  const dialogs = [
    { id: "100", title: "Karim Haddad", kind: "user", unread: 1, date: secs(NOW), entity: "e100" },
    { id: "200", title: "Store team", kind: "group", unread: 0, date: secs(new Date(NOW - day)), entity: "e200" },
    { id: "300", title: "Maya Gemayel", kind: "user", unread: 0, date: secs(new Date(NOW - 2 * day)), entity: "e300" },
  ];
  const messages = {
    e100: [
      { id: 1, date: secs(new Date(NOW - 2 * day)), text: "Can you send the invoice by Friday?", out: false, from: "Karim" },
      { id: 2, date: secs(new Date(NOW - day)), text: "Yes, I'll send it tomorrow", out: true, from: null },
    ],
    e200: [{ id: 7, date: secs(new Date(NOW - day)), text: "Stock count tomorrow", out: false, from: "Rami" }],
    e300: [{ id: 9, date: secs(new Date(NOW - 2 * day)), text: "Thanks!", out: false, from: "Maya" }],
  };
  return Object.assign(fakeTelegram({ dialogs, messages }), { dialogs, messages });
};
const signedIn = async (account, extra) => {
  const ctx = setup(account, extra);
  await ctx.tg.requestCode("+96170123456");
  await ctx.tg.verifyCode("12345");
  return ctx;
};

test("choosing people: only their chats are read and kept; removing someone deletes their chat here", async () => {
  const account = threeChats();
  const { tg, store } = await signedIn(account);
  assert.deepEqual((await tg.setPeople(["  karim ", "Maya", "karim", ""])).people, ["karim", "Maya"]);
  assert.deepEqual((await tg.status()).people, ["karim", "Maya"]);
  await tg.sync();
  assert.deepEqual((await tg.chats()).map((c) => c.title), ["Karim Haddad", "Maya Gemayel"]);
  const look = account.calls.find((c) => c[0] === "dialogs");
  assert.ok(look[1] > 30 && look[1] <= 200, "looks further down the chat list to find the chosen people, still bounded");
  assert.ok(!account.calls.some((c) => c[0] === "messages" && c[1] === "e200"), "other chats' messages are never read");
  await tg.setPeople(["karim"]);
  await tg.sync();
  assert.deepEqual((await tg.chats()).map((c) => c.title), ["Karim Haddad"]);
  assert.equal(store.dump().msgs.flat().some((m) => m.chatId === "300"), false, "Maya's messages are gone");
});

test("people list is bounded and each name is short", async () => {
  const { tg } = await signedIn(threeChats());
  await assert.rejects(tg.setPeople(Array.from({ length: 31 }, (_, i) => `Person ${i}`)), /30 people/);
  await assert.rejects(tg.setPeople(["x".repeat(81)]), /too long/);
  await assert.rejects(tg.setPeople("karim"), /list/);
});

const insightFrom = (overrides = {}) => ({
  summary: "Karim asked for the invoice by Friday; you said you'd send it tomorrow.",
  topics: ["Invoice"],
  waitingOn: "you",
  nextStep: "Send Karim the invoice.",
  suggestedMessage: "Hi Karim, here is the invoice as promised.",
  promises: [
    { by: "you", what: "Send the invoice tomorrow", due: "tomorrow", messageId: 2 },
    { by: "them", what: "Pay on receipt", due: null, messageId: 999 }, // not in the chat: dropped
  ],
  followUps: [{ what: "Check Karim received the invoice", messageId: 1 }],
  ...overrides,
});

test("insight: what was said, promises with their message, the next step and a suggested message; cached and encrypted", async () => {
  const seen = [];
  const analyze = async (input) => { seen.push(input); return { insight: insightFrom(), model: "test-model" }; };
  const { tg, store } = await signedIn(threeChats(), { analyze });
  await tg.sync();
  const first = await tg.insight("100");
  assert.equal(first.waitingOn, "you");
  assert.deepEqual(first.promises.map((p) => p.messageId), [2], "a promise must point at a real message in the chat");
  assert.equal(first.followUps[0].messageId, 1);
  assert.equal(first.model, "test-model");
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].messages.map((m) => [m.id, m.from, m.text]), [[1, "Karim", "Can you send the invoice by Friday?"], [2, "You", "Yes, I'll send it tomorrow"]]);
  assert.equal(seen[0].chat.title, "Karim Haddad");

  await tg.insight("100");
  assert.equal(seen.length, 1, "no new messages: the saved insight is reused");
  await tg.insight("100", { refresh: true });
  assert.equal(seen.length, 2, "refresh asks again");

  const stored = JSON.stringify(store.dump());
  assert.equal(stored.includes("as promised"), false, "the insight is stored encrypted");
  assert.equal(JSON.stringify(await tg.chats()).includes("invoice"), false, "the chat list carries no insight text");
});

test("insight: new messages make a fresh one; unknown chats and missing Gemini say so", async () => {
  let calls = 0;
  const account = threeChats();
  const { tg } = await signedIn(account, { analyze: async () => { calls++; return { insight: insightFrom(), model: "m" }; } });
  await tg.sync();
  await tg.insight("100");
  // Karim writes again; the next read brings it in, and the insight is made again.
  account.messages.e100.push({ id: 3, date: secs(NOW), text: "Any news?", out: false, from: "Karim" });
  await tg.sync();
  await tg.insight("100");
  assert.equal(calls, 2);
  await assert.rejects(tg.insight("404"), /isn't one of your followed chats/i);
  const noAi = await signedIn(threeChats(), { analyze: null });
  await noAi.tg.sync();
  await assert.rejects(noAi.tg.insight("100"), /GEMINI_API_KEY/);
  assert.equal(calls, 2);
});

test("sending: only to a followed chat, only text the user wrote, and the sent message shows in the chat (stored encrypted)", async () => {
  const account = threeChats();
  const { tg, store } = await signedIn(account);
  await tg.sync();
  await assert.rejects(tg.send("100", "   "), /Write a message/);
  await assert.rejects(tg.send("100", "x".repeat(4097)), /too long/);
  await assert.rejects(tg.send("404", "hello"), /isn't one of your followed chats/i);
  const sent = await tg.send("100", "  Hi Karim, here is the invoice.  ");
  assert.deepEqual(account.calls.filter((c) => c[0] === "send"), [["send", "e100", "Hi Karim, here is the invoice."]]);
  assert.equal(sent.out, true);
  assert.equal(sent.text, "Hi Karim, here is the invoice.");
  const thread = await tg.messages("100");
  assert.equal(thread.at(-1).text, "Hi Karim, here is the invoice.");
  assert.equal(JSON.stringify(store.dump()).includes("here is the invoice"), false, "stored encrypted");
});
