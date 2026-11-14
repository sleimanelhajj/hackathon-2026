// The email schedule (server/schedule.js): every item comes from the user's Gmail data and says why it's there.
// Pure functions, fixed clock: Saturday 14 Nov 2026 is avoided on purpose; "now" is Wednesday 11 Nov 2026, 10:00 Beirut.
import assert from "node:assert/strict";
import test from "node:test";
import { buildSchedule, fromZoned, zonedParts } from "../../server/schedule.js";

const TZ = "Asia/Beirut"; // UTC+2 in November
const at = (y, m, d, h, min = 0) => fromZoned({ y, m, d, h, min }, TZ);
const now = at(2026, 11, 11, 10);
const local = (date) => { const p = zonedParts(date, TZ); return `${p.dow} ${p.d} ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`; };

let n = 0;
const msg = (threadId, extra = {}) => ({
  gmailId: `g${++n}`, threadId, source: "gmail", direction: "in", subject: `Subject ${threadId}`,
  from: { name: "Kevin Elmurr", email: "kevin@client.example" }, to: [{ name: "Me", email: "me@shop.example" }], cc: [],
  date: at(2026, 11, 11, 9), isAutomated: false, isBulk: false, hasCalendarInvite: false, attachments: [], ...extra,
});
const label = (threadId, extra = {}) => ({ threadId, category: "request", priority: "medium", needsReply: true, summary: `Summary ${threadId}`, suggestedAction: "Reply with the price", when: null, ...extra });
const build = (messages, labels = [], invites = []) => buildSchedule({ messages, labels, invites, now, tz: TZ, account: "me@shop.example" });

test("time helpers convert Beirut wall-clock time both ways", () => {
  const d = at(2026, 11, 11, 10, 30);
  assert.equal(d.toISOString(), "2026-11-11T08:30:00.000Z");
  assert.deepEqual({ ...zonedParts(d, TZ) }, { y: 2026, m: 11, d: 11, h: 10, min: 30, dow: "Wed" });
});

test("urgent: a reply task 2 hours after the email arrived", () => {
  const { items } = build([msg("t1", { date: at(2026, 11, 11, 9, 40) })], [label("t1", { priority: "high" })]);
  const task = items.find((i) => i.threadId === "t1");
  assert.equal(task.kind, "reply");
  assert.equal(task.priority, "high");
  assert.equal(local(task.start), "Wed 11 11:40");
  assert.equal(task.end - task.start, 30 * 60e3);
  assert.match(task.why, /Urgent/);
  assert.match(task.why, /2 hours after/);
  assert.equal(task.title, "Reply to Kevin Elmurr");
  assert.equal(task.link, "https://mail.google.com/mail/u/0/#all/t1");
});

test("medium: the next working morning; low: within 3 working days", () => {
  const { items } = build(
    [msg("t2"), msg("t3")],
    [label("t2", { priority: "medium" }), label("t3", { priority: "low" })]
  );
  assert.equal(local(items.find((i) => i.threadId === "t2").start), "Thu 12 10:00");
  assert.equal(local(items.find((i) => i.threadId === "t3").start), "Mon 16 10:00", "Wed + 3 working days skips the weekend");
});

test("tasks stay in working hours: an urgent email at 21:00 is handled at 9:00 next working day", () => {
  const { items } = build([msg("t4", { date: at(2026, 11, 13, 21) })], [label("t4", { priority: "high" })]); // Friday night
  const task = items.find((i) => i.threadId === "t4");
  assert.equal(local(task.start), "Mon 16 09:00");
  assert.match(task.why, /working hours/);
});

test("tasks never overlap each other or a meeting: they queue in 30-minute slots", () => {
  const { items } = build(
    [msg("a", { date: at(2026, 11, 11, 9, 40) }), msg("b", { date: at(2026, 11, 11, 9, 40) }), msg("c", { date: at(2026, 11, 11, 9, 40) })],
    [label("a", { priority: "high" }), label("b", { priority: "high" }), label("c", { priority: "high", when: { kind: "meeting", at: "2026-11-11T12:10", allDay: false, what: "Call about the order" } })]
  );
  const busy = items.filter((i) => i.kind !== "deadline").sort((x, y) => x.start - y.start);
  for (let i = 1; i < busy.length; i++) assert.ok(busy[i].start >= busy[i - 1].end, `${busy[i - 1].title} overlaps ${busy[i].title}`);
});

test("a time missed already moves to the next free slot and is marked overdue", () => {
  const { items } = build([msg("t5", { date: at(2026, 11, 9, 9) })], [label("t5", { priority: "high" })]);
  const task = items.find((i) => i.threadId === "t5");
  assert.equal(task.overdue, true);
  assert.equal(local(task.start), "Wed 11 10:00");
  assert.equal(local(task.dueAt), "Mon 9 11:00");
  assert.match(task.why, /Overdue/);
});

test("dates in the email text: a meeting at its time, a deadline as a marker, and the reply task before the deadline", () => {
  const { items } = build(
    [msg("m1"), msg("d1")],
    [
      label("m1", { category: "scheduling", priority: "medium", when: { kind: "meeting", at: "2026-11-12T15:00", allDay: false, what: "Site visit in Jounieh" } }),
      label("d1", { category: "proposal", priority: "low", when: { kind: "deadline", at: "2026-11-13T17:00", allDay: false, what: "Send the quote" } }),
    ]
  );
  const meeting = items.find((i) => i.threadId === "m1" && i.kind === "meeting");
  assert.equal(local(meeting.start), "Thu 12 15:00");
  assert.equal(meeting.title, "Site visit in Jounieh");
  assert.match(meeting.why, /mentioned in the email/i);
  const deadline = items.find((i) => i.threadId === "d1" && i.kind === "deadline");
  assert.equal(local(deadline.start), "Fri 13 17:00");
  const task = items.find((i) => i.threadId === "d1" && i.kind === "reply");
  assert.ok(task.end <= deadline.start, `task at ${local(task.start)} is before the deadline`);
  assert.match(task.why, /before the deadline/);
});

test("calendar invites are placed at their real time and block the slot", () => {
  const { items } = build([msg("i1", { hasCalendarInvite: true })], [label("i1", { category: "scheduling", needsReply: false })],
    [{ gmailId: "g-inv", threadId: "i1", summary: "Quarterly review", start: at(2026, 11, 12, 10), end: at(2026, 11, 12, 11), location: "Beirut store" }]);
  const meeting = items.find((i) => i.kind === "meeting");
  assert.equal(local(meeting.start), "Thu 12 10:00");
  assert.equal(meeting.title, "Quarterly review");
  assert.match(meeting.why, /calendar invite/i);
  assert.equal(meeting.location, "Beirut store");
});

test("follow-ups: 3 working days after you wrote last, if they haven't replied", () => {
  const { items } = build([msg("f1", { direction: "out", from: { name: "Me", email: "me@shop.example" }, to: [{ name: "Rania Khoury", email: "rania@x.example" }], date: at(2026, 11, 10, 14) })],
    [label("f1", { needsReply: false })]);
  const f = items.find((i) => i.kind === "follow-up");
  assert.equal(f.title, "Follow up with Rania Khoury");
  assert.equal(local(f.start), "Fri 13 09:00");
});

test("automated mail, newsletters and threads that need nothing are left out", () => {
  const { items } = build(
    [msg("n1", { isAutomated: true }), msg("n2", { isBulk: true }), msg("n3")],
    [label("n1"), label("n2"), label("n3", { needsReply: false, category: "other" })]
  );
  assert.deepEqual(items, []);
});

test("ids are stable, so syncing again updates events instead of duplicating them", () => {
  const a = build([msg("s1")], [label("s1")]).items[0];
  const b = build([msg("s1")], [label("s1")]).items[0];
  assert.equal(a.id, b.id);
  assert.match(a.id, /^[a-z0-9-]+$/);
});

// ---- calendar invites: real times from the .ics file ----
const { parseIcsEvents } = await import("../../server/agent/files.js");

test("an .ics invite gives its event with real times: UTC, a named time zone, or all day", () => {
  const ics = Buffer.from([
    "BEGIN:VCALENDAR", "BEGIN:VEVENT", "SUMMARY:Quarterly review\, Q4", "DTSTART:20261112T080000Z", "DTEND:20261112T090000Z", "LOCATION:Beirut store", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Supplier call", "DTSTART;TZID=Asia/Beirut:20261113T150000", "DTEND;TZID=Asia/Beirut:20261113T153000", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Stock count", "DTSTART;VALUE=DATE:20261116", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n"));
  const [a, b, c] = parseIcsEvents(ics, "Asia/Beirut");
  assert.equal(a.summary, "Quarterly review, Q4");
  assert.equal(a.start.toISOString(), "2026-11-12T08:00:00.000Z");
  assert.equal(a.end.toISOString(), "2026-11-12T09:00:00.000Z");
  assert.equal(a.location, "Beirut store");
  assert.equal(local(b.start), "Fri 13 15:00");
  assert.equal(c.allDay, true);
  assert.equal(local(c.start), "Mon 16 00:00");
});

test("a deadline with only a day is an all-day marker, and the reply task lands before 17:00 that day", () => {
  const { items } = build([msg("d2")], [label("d2", { priority: "low", when: { kind: "deadline", at: "2026-11-13", allDay: true, what: "Invoice due" } })]);
  const deadline = items.find((i) => i.kind === "deadline");
  assert.equal(deadline.allDay, true);
  assert.equal(local(deadline.start), "Fri 13 00:00");
  const task = items.find((i) => i.kind === "reply");
  assert.ok(local(task.start) <= "Fri 13 15:00" && task.start < fromZoned({ y: 2026, m: 11, d: 13, h: 17 }, TZ), local(task.start));
});

test("the same meeting or deadline mentioned in two emails shows once", () => {
  const when = { kind: "meeting", at: "2026-11-24T10:00", allDay: false, what: "Quarterly sales review" };
  const { items } = build([msg("q1"), msg("q2")], [label("q1", { needsReply: false, when }), label("q2", { needsReply: false, when })]);
  assert.equal(items.filter((i) => i.kind === "meeting").length, 1);
});

// ---- availability and meeting requests (decision #55) ----
const { requestKey } = await import("../../server/meetings.js");
const wk = (ranges) => ({ weekly: { Mon: ranges, Tue: ranges, Wed: ranges, Thu: ranges, Fri: ranges, Sat: [], Sun: [] }, dates: {} });

test("tasks go into your available hours, not fixed office hours", () => {
  const { items } = buildSchedule({ messages: [msg("av", { date: at(2026, 11, 11, 9, 40) })], labels: [label("av", { priority: "high" })], now, tz: TZ, availability: wk([["14:00", "16:00"]]) });
  assert.equal(local(items.find((i) => i.threadId === "av").start), "Wed 11 14:00", "11:40 is outside 14:00–16:00");
});

test("meeting requests: declined ones stay off the calendar, one waiting for you shows as a request and doesn't block tasks", () => {
  const meeting = (threadId, h) => label(threadId, { needsReply: false, category: "scheduling", when: { kind: "meeting", at: `2026-11-12T${h}:00`, allDay: false, what: `Meeting ${threadId}`, request: true } });
  const requests = new Map([
    [requestKey("no", at(2026, 11, 12, 10)), { _id: "r-no", status: "auto-declined", reason: "clash" }],
    [requestKey("wait", at(2026, 11, 12, 11)), { _id: "r-wait", status: "pending", reason: "outside" }],
    [requestKey("yes", at(2026, 11, 12, 15)), { _id: "r-yes", status: "confirmed", reason: "outside" }],
  ]);
  const { items } = buildSchedule({ messages: [msg("no"), msg("wait"), msg("yes")], labels: [meeting("no", 10), meeting("wait", 11), meeting("yes", 15)], now, tz: TZ, requests });
  assert.equal(items.some((i) => i.threadId === "no"), false);
  const wait = items.find((i) => i.threadId === "wait");
  assert.deepEqual(wait.request, { id: "r-wait", status: "pending", reason: "outside" });
  assert.match(wait.why, /waiting for you/i);
  assert.deepEqual(items.find((i) => i.threadId === "yes").request, { id: "r-yes", status: "confirmed", reason: "outside" });
});

test("which meetings are requests: a time someone else asks for, or their calendar invite; not yours, not automated, not all-day", async () => {
  const { collectRequests } = await import("../../server/schedule.js");
  const ask = (threadId, extra = {}) => label(threadId, { when: { kind: "meeting", at: "2026-11-12T15:00", allDay: false, what: `Meeting ${threadId}`, request: true, ...extra } });
  const out = collectRequests({
    messages: [
      msg("asked", { date: at(2026, 11, 11, 8) }),
      msg("mine", { direction: "out", from: { name: "Me", email: "me@shop.example" } }),
      msg("bot", { isAutomated: true }),
      msg("day"),
      msg("agreed"),
      msg("inv", { gmailId: "g-inv-1", hasCalendarInvite: true, date: at(2026, 11, 11, 7) }),
    ],
    labels: [ask("asked"), ask("mine"), ask("bot"), ask("day", { at: "2026-11-12", allDay: true }), ask("agreed", { request: false }), label("inv", { needsReply: false })],
    invites: [{ gmailId: "g-inv-1", threadId: "inv", summary: "Quarterly review", start: at(2026, 11, 12, 10), end: at(2026, 11, 12, 11) }],
    tz: TZ,
  });
  assert.deepEqual(out.map((c) => c.threadId).sort(), ["asked", "inv"]);
  const asked = out.find((c) => c.threadId === "asked");
  assert.equal(local(asked.start), "Thu 12 15:00");
  assert.equal(asked.end - asked.start, 36e5, "an hour unless the invite says otherwise");
  assert.equal(local(asked.receivedAt), "Wed 11 08:00");
  assert.equal(asked.contact, "Kevin Elmurr");
  assert.equal(asked.key, requestKey("asked", asked.start));
  const inv = out.find((c) => c.threadId === "inv");
  assert.deepEqual([inv.source, inv.title, inv.gmailId, local(inv.end)], ["invite", "Quarterly review", "g-inv-1", "Thu 12 11:00"]);
});
