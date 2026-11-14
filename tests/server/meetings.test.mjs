// Meeting requests (server/meetings.js): the user's availability, and what happens to a meeting someone asks for.
//   past     the requested time has already passed       → not on the calendar, automatic reply with free times
//   clash    it overlaps a meeting already on the calendar → not on the calendar, automatic reply with free times
//   outside  it's outside the user's availability          → waits for the user: accept ("I'm available") or decline
//   ok       otherwise                                     → on the calendar, no email
// Pure functions, fixed clock: "now" is Wednesday 11 Nov 2026, 10:00 Beirut (UTC+2).
import assert from "node:assert/strict";
import test from "node:test";
import { fromZoned, zonedParts } from "../../server/schedule.js";
import {
  Availability, DEFAULT_AVAILABILITY, evaluateRequest, freeSlots, meetingEmail, nextAvailableTime, planRequests, requestKey, slotsOn, withinAvailability,
} from "../../server/meetings.js";

const TZ = "Asia/Beirut";
const at = (y, m, d, h, min = 0) => fromZoned({ y, m, d, h, min }, TZ);
const nov = (d, h, min = 0) => at(2026, 11, d, h, min);
const now = nov(11, 10);
const local = (date) => { const p = zonedParts(date, TZ); return `${p.dow} ${p.d} ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`; };
const HOUR = 36e5;

const week = (ranges, extra = {}) => ({ weekly: { Mon: ranges, Tue: ranges, Wed: ranges, Thu: ranges, Fri: ranges, Sat: [], Sun: [] }, dates: {}, ...extra });
const avail = week([["09:00", "12:00"], ["14:00", "17:00"]], { dates: { "2026-11-12": [["10:00", "13:00"]], "2026-11-13": [] } });

test("availability: weekly hours per day plus changes for a date; bad slots are refused with a clear message", () => {
  assert.equal(Availability.safeParse(DEFAULT_AVAILABILITY).success, true);
  assert.equal(Availability.safeParse(avail).success, true);
  const bad = (a) => Availability.safeParse(a).error?.issues[0]?.message ?? "";
  assert.match(bad(week([["12:00", "09:00"]])), /end after it starts/);
  assert.match(bad(week([["09:00", "12:00"], ["11:00", "13:00"]])), /overlap/);
  assert.match(bad(week([])), /at least one/i);
  assert.match(bad(week([["9:00", "12:00"]])), /HH:mm|time/i);
});

test("a date change replaces that day's weekly hours; an empty date is a day off", () => {
  assert.deepEqual(slotsOn(avail, nov(11, 8), TZ).map(([s, e]) => [local(s), local(e)]), [["Wed 11 09:00", "Wed 11 12:00"], ["Wed 11 14:00", "Wed 11 17:00"]]);
  assert.deepEqual(slotsOn(avail, nov(12, 8), TZ).map(([s, e]) => [local(s), local(e)]), [["Thu 12 10:00", "Thu 12 13:00"]]);
  assert.deepEqual(slotsOn(avail, nov(13, 8), TZ), []);
  assert.deepEqual(slotsOn(avail, nov(14, 8), TZ), [], "Saturday: no weekly hours");
});

test("a meeting fits only if it's inside one available stretch; touching slots join up", () => {
  assert.equal(withinAvailability(avail, nov(11, 10), nov(11, 11), TZ), true);
  assert.equal(withinAvailability(avail, nov(11, 11, 30), nov(11, 14, 30), TZ), false, "spans the lunch gap");
  assert.equal(withinAvailability(avail, nov(13, 10), nov(13, 11), TZ), false, "day off");
  assert.equal(withinAvailability(avail, nov(11, 20), nov(11, 21), TZ), false, "evening");
  const joined = week([["09:00", "12:00"], ["12:00", "18:00"]]);
  assert.equal(withinAvailability(joined, nov(11, 11), nov(11, 13), TZ), true);
});

test("the next available time: the same moment if it fits, else the start of the next stretch that fits", () => {
  assert.equal(local(nextAvailableTime(avail, nov(11, 10, 15), 30 * 6e4, TZ)), "Wed 11 10:15");
  assert.equal(local(nextAvailableTime(avail, nov(11, 11, 45), 30 * 6e4, TZ)), "Wed 11 14:00");
  assert.equal(local(nextAvailableTime(avail, nov(12, 18), 30 * 6e4, TZ)), "Mon 16 09:00", "Fri 13 is off, then the weekend");
});

test("a request is judged in order: past, then clash, then outside availability", () => {
  const busy = [{ start: nov(11, 14), end: nov(11, 15), title: "Site visit in Jounieh" }];
  const judge = (start, hours = 1) => evaluateRequest({ start, end: new Date(start.getTime() + hours * HOUR), now, avail, busy, tz: TZ });
  assert.deepEqual(judge(nov(10, 15)), { status: "past" });
  assert.deepEqual(judge(nov(11, 9)), { status: "past" }, "earlier today counts as passed");
  assert.deepEqual(judge(nov(11, 14, 30)), { status: "clash", clashWith: "Site visit in Jounieh" });
  assert.deepEqual(judge(nov(14, 11)), { status: "outside" }, "Saturday");
  assert.deepEqual(judge(nov(11, 18)), { status: "outside" }, "evening");
  assert.deepEqual(judge(nov(11, 15)), { status: "ok" }, "right after the other meeting");
});

test("free times to offer: on the half hour, inside availability, clear of meetings, from now on, at most two a day", () => {
  const busy = [{ start: nov(11, 14), end: nov(11, 16) }];
  const slots = freeSlots(avail, busy, { from: nov(11, 10, 10), duration: HOUR, tz: TZ, count: 6 });
  assert.equal(slots.length, 6);
  for (const s of slots) {
    assert.equal(zonedParts(s.start, TZ).min % 30, 0);
    assert.equal(s.end - s.start, HOUR);
    assert.ok(s.start >= nov(11, 10, 10));
    assert.equal(withinAvailability(avail, s.start, s.end, TZ), true, local(s.start));
    assert.ok(!busy.some((b) => s.start < b.end && b.start < s.end), `${local(s.start)} clashes`);
  }
  const perDay = Object.values(Object.groupBy(slots, (s) => zonedParts(s.start, TZ).d));
  assert.ok(perDay.every((list) => list.length <= 2));
  assert.equal(local(slots[0].start), "Wed 11 10:30");
  assert.ok(slots.every((s, i) => i === 0 || s.start > slots[i - 1].start));
  assert.ok(!slots.some((s) => zonedParts(s.start, TZ).d === 13), "never on a day off");
});

const candidate = (threadId, start, extra = {}) => ({
  key: requestKey(threadId, start), threadId, gmailId: `g-${threadId}`, title: `Meeting ${threadId}`, contact: "Rania Khoury",
  start, end: new Date(start.getTime() + HOUR), receivedAt: nov(11, 9), source: "email-text", ...extra,
});
const plan = (candidates, records = [], extra = {}) => planRequests({ candidates, records, activatedAt: nov(1, 0), now, avail, tz: TZ, busy: [], ...extra });

test("first come, first served: the earlier email gets the time, the later one is declined automatically for the clash", () => {
  const { decisions } = plan([
    candidate("late", nov(16, 10), { receivedAt: nov(11, 9, 30) }),
    candidate("early", nov(16, 10, 30), { receivedAt: nov(11, 8) }),
  ]);
  const byThread = Object.fromEntries(decisions.map((d) => [d.threadId, d]));
  assert.equal(byThread.early.status, "accepted");
  assert.equal(byThread.early.autoReply, false);
  assert.equal(byThread.late.status, "auto-declined");
  assert.equal(byThread.late.reason, "clash");
  assert.equal(byThread.late.clashWith, "Meeting early");
  assert.equal(byThread.late.autoReply, true);
});

test("a time that has passed is declined automatically; outside availability waits for you; nothing is decided twice", () => {
  const records = [{ _id: "x", key: requestKey("seen", nov(16, 9)), threadId: "seen", status: "pending", start: nov(16, 9), end: nov(16, 10) }];
  const { decisions } = plan([candidate("past", nov(10, 15)), candidate("sat", nov(14, 11)), candidate("seen", nov(16, 9))], records);
  const byThread = Object.fromEntries(decisions.map((d) => [d.threadId, d]));
  assert.deepEqual([byThread.past.status, byThread.past.reason, byThread.past.autoReply], ["auto-declined", "past", true]);
  assert.deepEqual([byThread.sat.status, byThread.sat.reason, byThread.sat.autoReply], ["pending", "outside", false]);
  assert.equal(byThread.seen, undefined, "already on record: left alone");
});

test("requests from before you set your availability are kept as they were, with no email", () => {
  const { decisions } = plan([candidate("old", nov(10, 15), { receivedAt: nov(5, 9) })], [], { activatedAt: nov(11, 8) });
  assert.equal(decisions[0].status, "accepted");
  assert.equal(decisions[0].autoReply, false);
  assert.equal(decisions[0].reason, "before-setup");
});

test("meetings you already have, and confirmed requests, count as busy", () => {
  const confirmed = [{ _id: "c", key: requestKey("c", nov(16, 10)), threadId: "c", title: "Pilot review", status: "confirmed", start: nov(16, 10), end: nov(16, 11) }];
  const { decisions } = plan([candidate("a", nov(16, 10, 30)), candidate("b", nov(17, 10))], confirmed, { busy: [{ start: nov(17, 9, 30), end: nov(17, 10, 30), title: "Quarterly review" }] });
  assert.deepEqual(decisions.map((d) => [d.threadId, d.status, d.clashWith]), [["a", "auto-declined", "Pilot review"], ["b", "auto-declined", "Quarterly review"]]);
});

test("a new time on the same conversation replaces the one still waiting for you", () => {
  const records = [{ _id: "old-1", key: requestKey("t", nov(14, 11)), threadId: "t", status: "pending", start: nov(14, 11), end: nov(14, 12) }];
  const { decisions, superseded } = plan([candidate("t", nov(16, 11), { receivedAt: nov(11, 9, 45) })], records);
  assert.equal(decisions[0].status, "accepted");
  assert.deepEqual(superseded, ["old-1"]);
});

test("never more than 3 automatic replies in one conversation: after that it waits for you", () => {
  const records = [1, 2, 3].map((i) => ({ _id: `r${i}`, key: `k${i}`, threadId: "loop", status: "auto-declined", autoReply: true, start: nov(9, 9 + i), end: nov(9, 10 + i) }));
  const { decisions } = plan([candidate("loop", nov(10, 15))], records);
  assert.equal(decisions[0].status, "pending");
  assert.equal(decisions[0].reason, "past");
  assert.equal(decisions[0].autoReply, false);
});

test("the emails: say why in plain words, list the free times in your time zone, and never promise what wasn't decided", () => {
  const slots = [{ start: nov(16, 10), end: nov(16, 11) }, { start: nov(17, 14, 30), end: nov(17, 15, 30) }];
  const base = { name: "Rania Khoury", start: nov(10, 15), end: nov(10, 16), slots, tz: TZ, signature: "Kevin" };
  const past = meetingEmail({ ...base, kind: "past" });
  assert.match(past, /^Hi Rania,/);
  assert.match(past, /already passed/);
  assert.match(past, /Monday 16 November, 10:00–11:00/);
  assert.match(past, /Tuesday 17 November, 14:30–15:30/);
  assert.match(past, /Beirut time/);
  assert.match(past, /automatic reply/i);
  assert.match(past, /Kevin\s*$/m);
  assert.match(meetingEmail({ ...base, kind: "clash" }), /already booked/);
  const declined = meetingEmail({ ...base, kind: "declined" });
  assert.match(declined, /not available/);
  assert.doesNotMatch(declined, /automatic/i, "you chose this one yourself");
  const accepted = meetingEmail({ ...base, kind: "accepted" });
  assert.match(accepted, /Tuesday 10 November, 15:00–16:00 works for me/);
  assert.doesNotMatch(accepted, /10:00–11:00/, "no list of other times");
  assert.match(meetingEmail({ ...base, kind: "past", slots: [] }), /no free time in the next two weeks/i);
});

test("the emails are short: thanks for your email, then the free times; no AI-read meeting title", () => {
  const slots = [{ start: nov(16, 10), end: nov(16, 11) }];
  const base = { name: "Rania Khoury", what: "Meet Kevin Elmurr", start: nov(10, 15), end: nov(10, 16), slots, tz: TZ };
  for (const kind of ["past", "clash", "declined", "accepted"]) {
    const body = meetingEmail({ ...base, kind });
    assert.match(body, /^Hi Rania,\n\nThanks for your email\./, kind);
    assert.doesNotMatch(body, /Meet Kevin Elmurr/, `${kind}: the title the AI read isn't repeated back`);
    assert.doesNotMatch(body, /Thanks for your message about/, kind);
  }
  const declined = meetingEmail({ ...base, kind: "declined" });
  assert.match(declined, /Thanks for your email\. I'm not available at that time, but these times work for me \(Beirut time\):\n- Monday 16 November, 10:00–11:00/);
});

test("a greeting uses a real name, and just 'Hi,' when all we have is an address or a username", () => {
  const greet = (name) => meetingEmail({ kind: "declined", name, start: nov(16, 10), end: nov(16, 11), slots: [], tz: TZ }).split("\n")[0];
  assert.equal(greet("Rania Khoury"), "Hi Rania,");
  assert.equal(greet("Omar"), "Hi Omar,");
  assert.equal(greet("elmurrkevin"), "Hi,");
  assert.equal(greet("kevin@client.example"), "Hi,");
  assert.equal(greet(""), "Hi,");
  assert.equal(greet(null), "Hi,");
});
