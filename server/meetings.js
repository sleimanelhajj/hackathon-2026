// Meeting requests and the user's availability (decision #55). Pure and tested (tests/server/meetings.test.mjs);
// server/meeting-data.js loads the data, stores decisions and sends the emails.
//
// Someone asks to meet at a time (an AI-read request in the email text, or a calendar invite). Each request is judged
// once, the first time it is seen, in the order the emails arrived (first come, first served):
//   past     the time has already passed              → not on the calendar; automatic reply with free times
//   clash    it overlaps a meeting already accepted    → not on the calendar; automatic reply with free times
//   outside  it's outside the user's availability      → waits for the user: accept ("I'm available") or decline
//   ok       otherwise                                → on the calendar, no email
// Requests from before the user first saved their availability are kept as they were, with no email. At most
// MAX_AUTO_PER_THREAD automatic replies go to one conversation; after that a request waits for the user.
import { z } from "zod";
import { dayKey, fromZoned, zonedParts } from "./time.js";

export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MIN = 6e4;
const HOUR = 60 * MIN;
const STEP = 30 * MIN;
export const MAX_AUTO_PER_THREAD = 3;

// ---------- availability ----------
const Time = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/, "Use times like 09:00 (HH:mm).");
const Range = z.tuple([Time, Time]).refine(([a, b]) => a < b, "A time slot must end after it starts.");
const DayRanges = z.array(Range).max(8, "At most 8 time slots in a day.").superRefine((list, ctx) => {
  const sorted = [...list].sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][0] < sorted[i - 1][1]) return void ctx.addIssue({ code: "custom", message: "Time slots in one day can't overlap." });
  }
});
/** Weekly hours per day, plus changes for specific dates (an empty list is a day off). Times are wall clock in the user's zone. */
export const Availability = z.object({
  weekly: z.object(Object.fromEntries(DAYS.map((d) => [d, DayRanges.default([])])))
    .refine((w) => DAYS.some((d) => w[d].length), "Add at least one time you're available in the week."),
  dates: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dates look like 2026-11-20."), DayRanges)
    .refine((r) => Object.keys(r).length <= 90, "At most 90 date changes.")
    .default({}),
});

const OFFICE = [["09:00", "18:00"]];
/** Mon–Fri 9:00–18:00: what the schedule used before availability existed. */
export const DEFAULT_AVAILABILITY = { weekly: { Mon: OFFICE, Tue: OFFICE, Wed: OFFICE, Thu: OFFICE, Fri: OFFICE, Sat: [], Sun: [] }, dates: {} };

/** The available stretches on the day `date` falls on, as [start, end] instants; touching slots are joined. */
export function slotsOn(avail, date, tz) {
  const p = zonedParts(date, tz);
  const key = dayKey(date, tz);
  const ranges = Object.hasOwn(avail?.dates ?? {}, key) ? avail.dates[key] : (avail?.weekly?.[p.dow] ?? []);
  const at = (hhmm) => { const [h, min] = hhmm.split(":").map(Number); return fromZoned({ y: p.y, m: p.m, d: p.d, h, min }, tz); };
  const out = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0].localeCompare(y[0]))) {
    const s = at(a), e = at(b);
    if (out.length && s <= out.at(-1)[1]) { if (e > out.at(-1)[1]) out.at(-1)[1] = e; }
    else out.push([s, e]);
  }
  return out;
}

const nextDay = (date, tz) => { const p = zonedParts(date, tz); return fromZoned({ y: p.y, m: p.m, d: p.d + 1, h: 12 }, tz); };

/** True if [start, end) lies inside one available stretch. */
export function withinAvailability(avail, start, end, tz) {
  return slotsOn(avail, start, tz).some(([s, e]) => s <= start && end <= e);
}

/** `date` if [date, date + duration) fits in an available stretch, else the start of the next one it fits in. */
export function nextAvailableTime(avail, date, duration, tz, maxDays = 21) {
  let day = date;
  for (let i = 0; i <= maxDays; i++) {
    for (const [s, e] of slotsOn(avail, day, tz)) {
      const t = Math.max(s.getTime(), date.getTime());
      if (t + duration <= e.getTime()) return new Date(t);
    }
    day = nextDay(day, tz);
  }
  return date;
}

const clashes = (busy, s, e) => busy.find((b) => s < +b.end && +b.start < e);

/**
 * Free times to offer someone: on the half hour, inside availability, clear of `busy`, from `from` on; at most
 * `perDay` a day, `gap` apart, so the choice is spread out.
 */
export function freeSlots(avail, busy, { from, duration = HOUR, tz, count = 6, perDay = 2, gap = 2 * HOUR, days = 14 }) {
  const out = [];
  const earliest = Math.ceil(from.getTime() / STEP) * STEP;
  let day = from;
  for (let i = 0; i < days && out.length < count; i++) {
    const picked = [];
    for (const [s, e] of slotsOn(avail, day, tz)) {
      for (let t = Math.max(Math.ceil(s.getTime() / STEP) * STEP, earliest); t + duration <= e.getTime() && picked.length < perDay; t += STEP) {
        if (clashes(busy, t, t + duration)) continue;
        if (picked.length && t - picked.at(-1).start.getTime() < gap) continue;
        picked.push({ start: new Date(t), end: new Date(t + duration) });
      }
    }
    out.push(...picked.slice(0, count - out.length));
    day = nextDay(day, tz);
  }
  return out;
}

// ---------- judging requests ----------
/** Past, then clash, then outside availability, else ok. */
export function evaluateRequest({ start, end, now, avail, busy = [], tz }) {
  if (start.getTime() < now.getTime()) return { status: "past" };
  const hit = clashes(busy, start.getTime(), end.getTime());
  if (hit) return { status: "clash", clashWith: hit.title || "another meeting" };
  if (!withinAvailability(avail, start, end, tz)) return { status: "outside" };
  return { status: "ok" };
}

/** Stable identity of a request: the conversation and the time asked for. */
export const requestKey = (threadId, start) => `${threadId}|${new Date(start).toISOString()}`;
const requestId = (c) => `mr-${String(c.threadId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 40)}-${new Date(c.start).getTime()}`;

/** Statuses that put a request on the calendar (and make it count as busy). */
export const ON_CALENDAR = new Set(["accepted", "confirmed"]);

/**
 * Decides the requests not seen before. `records` are the decisions already stored; `busy` the meetings that aren't
 * requests (e.g. ones the user proposed). Returns new decisions (with `autoReply` for the ones that get an email now)
 * and the ids of records a newer time in the same conversation replaces.
 */
export function planRequests({ candidates, records = [], activatedAt, now, avail, tz, busy = [], maxAutoPerThread = MAX_AUTO_PER_THREAD }) {
  const knownKeys = new Set(records.map((r) => r.key));
  // The AI may re-read the same email with a slightly different time: one decision per email, never a second reply.
  const knownEmails = new Set(records.filter((r) => r.source === "email-text" && r.gmailId).map((r) => r.gmailId));
  const taken = [...busy, ...records.filter((r) => ON_CALENDAR.has(r.status)).map((r) => ({ start: r.start, end: r.end, title: r.title, threadId: r.threadId }))];
  const autoCount = new Map();
  for (const r of records) if (r.autoReply) autoCount.set(r.threadId, (autoCount.get(r.threadId) ?? 0) + 1);

  const seen = new Set();
  const fresh = candidates
    .filter((c) => !knownKeys.has(c.key) && !(c.source === "email-text" && knownEmails.has(c.gmailId)) && !seen.has(c.key) && seen.add(c.key))
    .sort((a, b) => a.receivedAt - b.receivedAt);

  const decisions = [];
  const superseded = new Set();
  for (const c of fresh) {
    let status, reason = null, clashWith = null, autoReply = false;
    if (!activatedAt || c.receivedAt < activatedAt) {
      status = "accepted";
      reason = "before-setup";
    } else {
      // A new time in a conversation replaces its earlier one, so that one doesn't count as a clash.
      const verdict = evaluateRequest({ start: c.start, end: c.end, now, avail, busy: taken.filter((b) => !b.threadId || b.threadId !== c.threadId), tz });
      reason = verdict.status === "ok" ? null : verdict.status;
      clashWith = verdict.clashWith ?? null;
      if (verdict.status === "ok") status = "accepted";
      else if (verdict.status === "outside") status = "pending";
      else if ((autoCount.get(c.threadId) ?? 0) >= maxAutoPerThread) status = "pending";
      else {
        status = "auto-declined";
        autoReply = true;
        autoCount.set(c.threadId, (autoCount.get(c.threadId) ?? 0) + 1);
      }
    }
    for (const r of records) if (r.threadId === c.threadId && r.key !== c.key && (r.status === "pending" || ON_CALENDAR.has(r.status))) superseded.add(r._id);
    if (ON_CALENDAR.has(status)) taken.push({ start: c.start, end: c.end, title: c.title, threadId: c.threadId });
    decisions.push({ ...c, _id: requestId(c), status, reason, clashWith, autoReply });
  }
  return { decisions, superseded: [...superseded] };
}

// ---------- the emails ----------
const dayFmt = new Map();
function formatRange(start, end, tz) {
  if (!dayFmt.has(tz)) dayFmt.set(tz, new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }));
  const hm = (d) => { const p = zonedParts(d, tz); return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`; };
  return `${dayFmt.get(tz).format(start)}, ${hm(start)}–${hm(end)}`;
}
export const zoneLabel = (tz) => `${String(tz).split("/").pop().replace(/_/g, " ")} time`;

/**
 * "Hi Rania," from a real name; just "Hi," when all we have is an address or a username ("elmurrkevin"): a name we
 * use has a space or starts with a capital letter.
 */
function greeting(name) {
  const n = String(name ?? "").trim();
  if (!n || n.includes("@") || !(/\s/.test(n) || /^\p{Lu}/u.test(n))) return "Hi,";
  return `Hi ${n.split(/\s+/)[0]},`;
}

/**
 * The text of a reply about a meeting request: short and plain, "Thanks for your email", why in a few words, then the
 * free times. It never repeats the meeting title the AI read from the email. kind: "past" | "clash" (automatic),
 * "declined" (the user said no), "accepted" (the user said yes). The caller sends it as a reply in the conversation.
 */
export function meetingEmail({ kind, name, start, end, slots = [], tz, signature = "" }) {
  const sign = `Best regards,${signature ? `\n${signature}` : ""}`;
  const hi = `${greeting(name)}\n\nThanks for your email.`;
  if (kind === "accepted") return `${hi} ${formatRange(start, end, tz)} works for me (${zoneLabel(tz)}). See you then.\n\n${sign}`;
  const why = { past: "That time has already passed", clash: "I'm already booked at that time", declined: "I'm not available at that time" }[kind];
  if (!why) throw new Error(`Unknown meeting email "${kind}".`);
  const options = slots.length
    ? `${why}, but these times work for me (${zoneLabel(tz)}):\n${slots.map((s) => `- ${formatRange(s.start, s.end, tz)}`).join("\n")}\n\nCould you reply with the one that suits you?`
    : `${why}, and I have no free time in the next two weeks, so I'll get back to you with a new time.`;
  const auto = kind === "declined" ? "" : "\n\n(This is an automatic reply from my scheduling assistant.)";
  return `${hi} ${options}\n\n${sign}${auto}`;
}
