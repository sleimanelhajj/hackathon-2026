// What happens around a meeting decision (server/meeting-data.js createMeetingDesk): each request is stored once
// (so two runs at the same moment never email twice), automatic replies are sent and recorded, a failed send is kept
// for the user to retry, and the user's own accept/decline sends the matching email. In-memory store, fake sender.
import assert from "node:assert/strict";
import test from "node:test";
import { fromZoned } from "../../server/schedule.js";
import { createMeetingDesk } from "../../server/meeting-data.js";
import { requestKey } from "../../server/meetings.js";

const TZ = "Asia/Beirut";
const nov = (d, h, min = 0) => fromZoned({ y: 2026, m: 11, d, h, min }, TZ);
const HOUR = 36e5;
const avail = { weekly: { Mon: [["09:00", "17:00"]], Tue: [["09:00", "17:00"]], Wed: [["09:00", "17:00"]], Thu: [["09:00", "17:00"]], Fri: [["09:00", "17:00"]], Sat: [], Sun: [] }, dates: {} };
const settings = { availability: avail, activatedAt: nov(1, 0), timeZone: TZ };

function fakeStore() {
  const rows = new Map();
  return {
    rows,
    async insert(rec) { if (rows.has(rec._id)) return false; rows.set(rec._id, structuredClone(rec)); return true; },
    async update(id, set) { rows.set(id, { ...rows.get(id), ...structuredClone(set) }); },
    async get(id) { return rows.get(id) ?? null; },
    async list() { return [...rows.values()]; },
  };
}
const candidate = (threadId, start, extra = {}) => ({
  key: requestKey(threadId, start), threadId, gmailId: `g-${threadId}`, title: `Meeting ${threadId}`, contact: "Rania Khoury",
  start, end: new Date(start.getTime() + HOUR), receivedAt: nov(11, 9), source: "email-text", ...extra,
});
function desk({ fail = false, dryRun = false } = {}) {
  const store = fakeStore();
  const sent = [];
  const d = createMeetingDesk({
    store, now: () => nov(11, 10), dryRun,
    send: async (threadId, body) => { if (fail) throw new Error("Gmail couldn't send the reply (500)."); sent.push({ threadId, body }); return { id: `s${sent.length}`, to: ["rania@client.example"] }; },
  });
  return { store, sent, d };
}

test("a past request is stored, answered once with free times, and the email is recorded", async () => {
  const { store, sent, d } = desk();
  const input = { candidates: [candidate("past", nov(10, 15))], settings, busy: [], signature: "Kevin" };
  await Promise.all([d.process(input), d.process(input)]); // two runs at once: still one email
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /already passed/);
  assert.match(sent[0].body, /Kevin/);
  const [rec] = await store.list();
  assert.equal(rec.status, "auto-declined");
  assert.equal(rec.email.kind, "past");
  assert.ok(rec.email.sentAt);
  assert.equal(rec.email.error, undefined);
});

test("a failed send is kept with its error, so you can see it and retry; retry sends the same email", async () => {
  const { store, d } = desk({ fail: true });
  await d.process({ candidates: [candidate("past", nov(10, 15))], settings, busy: [] });
  const [rec] = await store.list();
  assert.equal(rec.status, "auto-declined");
  assert.match(rec.email.error, /couldn't send/);
  assert.equal(rec.email.sentAt, undefined);

  const ok = desk();
  await ok.store.insert(rec);
  const out = await ok.d.retry(rec._id);
  assert.equal(ok.sent[0].body, rec.email.body);
  assert.ok(out.email.sentAt);
  assert.equal(out.email.error, null);
});

test("dry run (MEETING_EMAILS=dry-run) decides and records the email but sends nothing", async () => {
  const { store, sent, d } = desk({ dryRun: true });
  await d.process({ candidates: [candidate("past", nov(10, 15))], settings, busy: [] });
  assert.equal(sent.length, 0);
  const [rec] = await store.list();
  assert.equal(rec.email.dryRun, true);
  assert.match(rec.email.body, /already passed/);
});

test("nothing happens before you set your availability", async () => {
  const { store, sent, d } = desk();
  await d.process({ candidates: [candidate("past", nov(10, 15))], settings: { availability: null, activatedAt: null, timeZone: TZ }, busy: [] });
  assert.equal(sent.length, 0);
  assert.equal((await store.list()).length, 0);
});

test("a request outside your availability waits; accepting sends 'works for me' and puts it on the calendar", async () => {
  const { store, sent, d } = desk();
  await d.process({ candidates: [candidate("sat", nov(14, 11))], settings, busy: [] });
  const [rec] = await store.list();
  assert.equal(rec.status, "pending");
  assert.equal(sent.length, 0);
  const out = await d.answer(rec._id, true, { settings, busy: [], signature: "Kevin" });
  assert.equal(out.status, "confirmed");
  assert.match(sent[0].body, /works for me/);
  assert.equal(out.email.kind, "accepted");
  await assert.rejects(d.answer(rec._id, true, { settings, busy: [] }), /already/i, "can't be answered twice");
});

test("declining sends 'not available' with your free times and keeps it off the calendar", async () => {
  const { store, sent, d } = desk();
  await d.process({ candidates: [candidate("sat", nov(14, 11))], settings, busy: [] });
  const [rec] = await store.list();
  const out = await d.answer(rec._id, false, { settings, busy: [] });
  assert.equal(out.status, "declined");
  assert.match(sent[0].body, /not available/);
  assert.match(sent[0].body, /these times work for me/i);
});

test("accepting is refused if it now clashes with a meeting on the calendar; a failed send changes nothing", async () => {
  const { store, d } = desk();
  await d.process({ candidates: [candidate("sat", nov(14, 11))], settings, busy: [] });
  const [rec] = await store.list();
  await assert.rejects(d.answer(rec._id, true, { settings, busy: [{ start: nov(14, 11, 30), end: nov(14, 12, 30), title: "Site visit" }] }), /clashes with Site visit/);
  const failing = desk({ fail: true });
  await failing.store.insert(rec);
  await assert.rejects(failing.d.answer(rec._id, false, { settings, busy: [] }), /couldn't send/);
  assert.equal((await failing.store.get(rec._id)).status, "pending");
});

test("an email written in test mode can be sent for real later, and not while test mode is still on", async () => {
  const dry = desk({ dryRun: true });
  await dry.d.process({ candidates: [candidate("sat", nov(14, 11))], settings, busy: [] });
  const [pending] = await dry.store.list();
  const declined = await dry.d.answer(pending._id, false, { settings, busy: [] });
  assert.equal(declined.email.dryRun, true);
  await assert.rejects(dry.d.retry(declined._id), /Test mode is on/);

  const live = desk();
  await live.store.insert(await dry.store.get(declined._id));
  const out = await live.d.retry(declined._id);
  assert.match(live.sent[0].body, /not available/);
  assert.equal(out.email.dryRun, false);
  assert.ok(out.email.sentAt);
  await assert.rejects(live.d.retry(declined._id), /nothing to send/i, "never twice");
});
