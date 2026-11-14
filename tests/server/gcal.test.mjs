// Google Calendar sync (server/gcal.js), against a fake Google API: the app writes only to its own calendar, events
// have stable ids (syncing twice updates, never duplicates), unchanged events aren't rewritten, and items that left
// the schedule are removed from that calendar.
import assert from "node:assert/strict";
import test from "node:test";
import { CALENDAR_SCOPE, createCalendarSync, eventIdFor, toGoogleEvent } from "../../server/gcal.js";

const TZ = "Asia/Beirut";
const item = (id, extra = {}) => ({
  id, kind: "reply", priority: "high", title: "Reply to Kevin Elmurr", start: new Date("2026-11-11T09:40:00Z"), end: new Date("2026-11-11T10:10:00Z"),
  why: "Urgent: 2 hours after Kevin Elmurr's email arrived.", summary: "Kevin asks for the revised quote.", suggestedAction: "Send the quote",
  link: "https://mail.google.com/mail/u/0/#all/t1", location: null, overdue: false, allDay: false, ...extra,
});

/** A tiny in-memory Google Calendar API. */
function fakeGoogle() {
  const calendars = new Map();
  const events = new Map(); // `${cal}/${id}` -> event
  const deleted = new Set();
  const calls = [];
  let made = 0;
  async function request(method, path, body) {
    calls.push(`${method} ${path}`);
    let m;
    if (method === "POST" && path === "calendars") { const id = `cal${++made}@group.calendar.google.com`; calendars.set(id, body); return { status: 200, body: { id, ...body } }; }
    if (method === "GET" && (m = path.match(/^calendars\/([^/]+)$/))) return calendars.has(decodeURIComponent(m[1])) ? { status: 200, body: {} } : { status: 404, body: {} };
    if ((m = path.match(/^calendars\/([^/]+)\/events(?:\/([^/?]+))?/))) {
      const cal = decodeURIComponent(m[1]);
      if (!calendars.has(cal)) return { status: 404, body: {} };
      const key = `${cal}/${m[2] ?? body?.id}`;
      // Like Google: a deleted event is kept as cancelled, and updating it brings it back.
      if (method === "PUT") return events.has(key) || deleted.has(key) ? (deleted.delete(key), events.set(key, body), { status: 200, body }) : { status: 404, body: {} };
      if (method === "POST") { if (events.has(key) || deleted.has(key)) return { status: 409, body: {} }; events.set(key, body); return { status: 200, body }; }
      if (method === "DELETE") { if (!events.has(key)) return { status: 410, body: {} }; events.delete(key); deleted.add(key); return { status: 204, body: {} }; }
    }
    throw new Error(`unexpected ${method} ${path}`);
  }
  return { request, calendars, events, calls };
}
function store() {
  let state = null;
  return { load: async () => state, save: async (s) => { state = structuredClone(s); }, get: () => state };
}

test("the scope is the narrow one: only calendars the app creates", () => {
  assert.equal(CALENDAR_SCOPE, "https://www.googleapis.com/auth/calendar.app.created");
});

test("event ids are stable and valid for Google (base32hex, 5-1024 chars)", () => {
  assert.equal(eventIdFor("reply-t1"), eventIdFor("reply-t1"));
  assert.notEqual(eventIdFor("reply-t1"), eventIdFor("reply-t2"));
  assert.match(eventIdFor("reply-t1"), /^[a-v0-9]{5,1024}$/);
});

test("an event carries the reason, the email summary and a link back to Gmail", () => {
  const e = toGoogleEvent(item("reply-t1"), TZ);
  assert.equal(e.id, eventIdFor("reply-t1"));
  assert.equal(e.summary, "Reply to Kevin Elmurr");
  assert.match(e.description, /Urgent: 2 hours after/);
  assert.match(e.description, /Kevin asks for the revised quote/);
  assert.match(e.description, /https:\/\/mail\.google\.com/);
  assert.deepEqual(e.start, { dateTime: "2026-11-11T09:40:00.000Z", timeZone: TZ });
  assert.deepEqual(e.source, { title: "Open in Gmail", url: "https://mail.google.com/mail/u/0/#all/t1" });
  const allDay = toGoogleEvent(item("deadline-t2", { kind: "deadline", allDay: true, start: new Date("2026-11-12T22:00:00Z"), end: new Date("2026-11-13T22:00:00Z") }), TZ);
  assert.deepEqual(allDay.start, { date: "2026-11-13" });
});

test("first sync creates the app's own calendar and every event; nothing else is touched", async () => {
  const g = fakeGoogle(), s = store();
  const sync = createCalendarSync({ request: g.request, load: s.load, save: s.save });
  const out = await sync.run([item("reply-t1"), item("follow-up-t2", { kind: "follow-up", title: "Follow up with Rania" })], TZ);
  assert.equal(g.calendars.size, 1);
  assert.equal([...g.calendars.values()][0].summary, "AI Workspace OS");
  assert.equal(g.events.size, 2);
  assert.deepEqual({ created: out.created, updated: out.updated, unchanged: out.unchanged, removed: out.removed }, { created: 2, updated: 0, unchanged: 0, removed: 0 });
  assert.ok(g.calls.every((c) => !/primary/.test(c)), "never writes to the user's own calendar");
  assert.equal(s.get().calendarId, out.calendarId);
});

test("syncing again updates what changed, skips what didn't, removes what left, and never duplicates", async () => {
  const g = fakeGoogle(), s = store();
  const sync = createCalendarSync({ request: g.request, load: s.load, save: s.save });
  await sync.run([item("reply-t1"), item("reply-t2"), item("reply-t3")], TZ);
  const out = await sync.run([item("reply-t1"), item("reply-t2", { start: new Date("2026-11-12T08:00:00Z"), end: new Date("2026-11-12T08:30:00Z") })], TZ);
  assert.deepEqual({ created: out.created, updated: out.updated, unchanged: out.unchanged, removed: out.removed }, { created: 0, updated: 1, unchanged: 1, removed: 1 });
  assert.equal(g.events.size, 2);
  // An item that comes back after being removed reuses its id (Google keeps deleted ids): handled, not an error.
  const back = await sync.run([item("reply-t1"), item("reply-t2"), item("reply-t3")], TZ);
  assert.equal(g.events.size, 3);
  assert.equal(back.failed, 0);
});

test("if the user deleted the app's calendar in Google, the next sync makes a new one", async () => {
  const g = fakeGoogle(), s = store();
  const sync = createCalendarSync({ request: g.request, load: s.load, save: s.save });
  const first = await sync.run([item("reply-t1")], TZ);
  g.calendars.delete(first.calendarId);
  const second = await sync.run([item("reply-t1")], TZ);
  assert.notEqual(second.calendarId, first.calendarId);
  assert.equal(second.created, 1);
});
