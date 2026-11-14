// The email schedule: a plan for the user's week built only from their Gmail data. Every item says why it's there
// (`why`) and links back to its email (AGENTS.md rule 3). Rules:
//
//   meeting    a calendar invite (.ics) at its real time, or a meeting the email text mentions (AI-read `when`)
//   deadline   a deadline the email text mentions, shown as a marker at that time
//   reply      a thread waiting on the user's reply: urgent (high) 2 hours after it arrived, normal (medium) the next
//              working morning, low within 3 working days; never after a deadline the email mentions
//   follow-up  a thread where the user wrote last: 3 working days later, if they haven't heard back
//
// Tasks are 30-minute blocks in the user's available hours (default Mon–Fri 9:00–18:00, their time zone). They never overlap a
// meeting or each other: each takes the first free slot at or after its target time. A target that has already passed
// moves to the next free slot from now and is marked overdue. Automated mail and newsletters are left out.
// A meeting someone asks for follows the request rules in meetings.js (decision #55): declined ones stay off.
// Everything here is pure; loadSchedule() at the bottom reads the data from MongoDB.

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SLOT = 30 * MIN;
const START_HOUR = 9;
const WINDOW_BACK = 14 * DAY;
const WINDOW_AHEAD = 60 * DAY;

// ---------- time zones (server/time.js) ----------
import { fromZoned, zonedParts } from "./time.js";
import { DEFAULT_AVAILABILITY, nextAvailableTime, requestKey, slotsOn } from "./meetings.js";
export { fromZoned, zonedParts };
/** "2026-11-12T15:00" (wall clock in tz) → Date; null if it isn't a valid local date-time. */
function parseLocal(value, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(value ?? ""));
  if (!m) return null;
  const date = fromZoned({ y: +m[1], m: +m[2], d: +m[3], h: m[4] ? +m[4] : START_HOUR, min: m[5] ? +m[5] : 0 }, tz);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** `n` available days after `date` (days with any available hours), at `hour` local time. */
function addWorkingDays(date, n, hour, tz, avail) {
  let p = zonedParts(date, tz, avail);
  let day = fromZoned({ y: p.y, m: p.m, d: p.d, h: 12 }, tz);
  let left = n;
  for (let guard = 0; left > 0 && guard < 60; guard++) {
    p = zonedParts(day, tz);
    day = fromZoned({ y: p.y, m: p.m, d: p.d + 1, h: 12 }, tz);
    if (slotsOn(avail, day, tz).length) left--;
  }
  p = zonedParts(day, tz);
  return fromZoned({ y: p.y, m: p.m, d: p.d, h: hour }, tz);
}
const clock = (date, tz) => {
  const p = zonedParts(date, tz);
  return `${p.dow} ${p.d} ${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][p.m]}, ${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
};

// ---------- the schedule ----------
const gmailLink = (m) => (m.source === "gmail" ? `https://mail.google.com/mail/u/0/#all/${m.threadId}` : null);
const nameOf = (person) => person?.name || person?.email || "someone";
const safeId = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * @param messages synced messages (any order)        @param labels AI labels per thread (`extractions`)
 * @param invites  parsed calendar invites: { gmailId, threadId, summary, start, end, location }
 * @returns {{ items: object[], timeZone: string, generatedAt: Date }}
 */
export function buildSchedule({ messages, labels = [], invites = [], now = new Date(), tz = "Asia/Beirut", account = "", availability = DEFAULT_AVAILABILITY, requests = new Map() }) {
  const nowMs = now.getTime();
  const avail = availability ?? DEFAULT_AVAILABILITY;
  const nextWorkingTime = (date) => nextAvailableTime(avail, date, SLOT, tz);
  // A meeting someone asked for has a decision (server/meeting-data.js): declined ones stay off the calendar, one
  // waiting for the user shows as a request and doesn't block tasks. `null` = show it as an ordinary meeting.
  const REASON = { outside: "it's outside your availability", past: "its time has passed", clash: "it clashes with another meeting" };
  const decide = (threadId, start, item) => {
    const rec = requests.get(requestKey(threadId, start)) ?? requests.get(`thread|${threadId}`);
    if (!rec) return item;
    const request = { id: rec._id, status: rec.status, reason: rec.reason ?? null };
    if (rec.status === "accepted" || rec.status === "confirmed") {
      const how = rec.status === "confirmed" ? " You accepted it and told them you're available." : "";
      return { ...item, request, why: `${item.why}${how}` };
    }
    if (rec.status === "pending") {
      return { ...item, request, blocking: false, why: `A meeting request from ${item.contact ?? "someone"}, waiting for you to accept or decline: ${REASON[rec.reason] ?? "it needs your answer"}.` };
    }
    return null; // auto-declined, declined or replaced by a newer time
  };
  const byThread = new Map();
  for (const m of [...messages].sort((a, b) => a.date - b.date)) {
    if (!byThread.has(m.threadId)) byThread.set(m.threadId, []);
    byThread.get(m.threadId).push(m);
  }
  const labelOf = new Map(labels.map((l) => [l.threadId, l]));
  const fixed = [];    // meetings and deadlines: at their own time
  const tasks = [];    // reply and follow-up tasks: placed into free slots below
  const human = (m) => !m.isAutomated && !m.isBulk;

  for (const inv of invites) {
    if (!inv.start) continue;
    const start = new Date(inv.start);
    const end = inv.end ? new Date(inv.end) : new Date(start.getTime() + HOUR);
    const thread = byThread.get(inv.threadId) ?? [];
    const m = thread.find((x) => x.gmailId === inv.gmailId) ?? thread.at(-1);
    const invite = decide(inv.threadId, start, {
      id: safeId(`invite-${inv.gmailId}-${start.getTime()}`), kind: "meeting", source: "invite", title: inv.summary || m?.subject || "Meeting",
      start, end, blocking: true, location: inv.location ?? null, threadId: inv.threadId, link: m ? gmailLink(m) : null,
      contact: m ? nameOf(m.from) : null, why: `From the calendar invite attached to the email${m ? ` from ${nameOf(m.from)}` : ""}.`,
    });
    if (invite) fixed.push(invite);
  }

  for (const [threadId, list] of byThread) {
    const last = list.at(-1);
    const l = labelOf.get(threadId);
    if (!list.some(human) || l?.category === "automated") continue;
    const lastIn = [...list].reverse().find((m) => m.direction === "in");
    const contact = last.direction === "in" ? nameOf(last.from) : nameOf(last.to?.[0]);
    const base = { threadId, link: gmailLink(last), contact, subject: last.subject || "(no subject)", summary: l?.summary ?? null, suggestedAction: l?.suggestedAction ?? null, category: l?.category ?? null };

    // A date the email text mentions (read by the AI when it sorted the thread).
    let deadline = null;
    const when = l?.when;
    // A day without a time is an all-day item; for planning, an all-day deadline means "by 17:00 that day".
    const allDay = Boolean(when && (when.allDay || !/T\d{2}:\d{2}$/.test(when.at)));
    const whenAt = when ? parseLocal(allDay ? String(when.at).slice(0, 10) + "T00:00" : when.at, tz) : null;
    if (whenAt && !list.some((m) => m.hasCalendarInvite && invites.some((i) => i.threadId === threadId))) {
      const span = allDay ? DAY : when.kind === "meeting" ? HOUR : SLOT;
      if (when.kind === "meeting") {
        const meeting = { ...base, id: safeId(`meeting-${threadId}`), kind: "meeting", source: "email-text", title: when.what || `Meeting with ${contact}`,
          start: whenAt, end: new Date(whenAt.getTime() + span), allDay, blocking: !allDay,
          why: `A meeting mentioned in the email from ${contact}: "${when.what}". The time was read by AI from the text, so check it.` };
        const decided = when.request && !allDay ? decide(threadId, whenAt, meeting) : meeting;
        if (decided) fixed.push(decided);
      } else {
        deadline = allDay ? new Date(whenAt.getTime() + 17 * HOUR) : whenAt;
        fixed.push({ ...base, id: safeId(`deadline-${threadId}`), kind: "deadline", source: "email-text", title: `Due: ${when.what || base.subject}`,
          start: whenAt, end: new Date(whenAt.getTime() + span), allDay, blocking: false,
          why: `A deadline mentioned in the email from ${contact}${allDay ? " (a day, no time)" : ""}. The date was read by AI from the text, so check it.` });
      }
    }

    if (last.direction === "in" && human(last) && l?.needsReply) {
      const received = last.date;
      const priority = l.priority ?? "medium";
      let target, rule;
      if (priority === "high") { target = new Date(received.getTime() + 2 * HOUR); rule = `Urgent: 2 hours after ${contact}'s email arrived (${clock(received, tz)})`; }
      else if (priority === "medium") { target = addWorkingDays(received, 1, 10, tz, avail); rule = `Normal priority: the working morning after ${contact}'s email arrived`; }
      else { target = addWorkingDays(received, 3, 10, tz, avail); rule = `Low priority: within 3 working days of ${contact}'s email`; }
      if (deadline && target.getTime() + SLOT > deadline.getTime()) {
        target = new Date(Math.max(received.getTime(), deadline.getTime() - 2 * HOUR));
        rule = `${rule.split(":")[0]}: 2 hours before the deadline the email mentions`;
      }
      tasks.push({ ...base, id: safeId(`reply-${threadId}`), kind: "reply", priority, title: `Reply to ${contact}`, target, rule, deadline });
    } else if (last.direction === "out" && human(last) && (!lastIn || human(lastIn))) {
      tasks.push({ ...base, id: safeId(`follow-up-${threadId}`), kind: "follow-up", priority: "low", title: `Follow up with ${contact}`,
        target: addWorkingDays(last.date, 3, START_HOUR, tz, avail), rule: `You wrote last (${clock(last.date, tz)}); follow up after 3 working days without a reply`, duration: SLOT });
    }
  }

  // The same meeting or deadline mentioned in several emails shows once (same kind, title and time).
  const seenFixed = new Set();
  for (let i = fixed.length - 1; i >= 0; i--) {
    const key = `${fixed[i].kind}|${fixed[i].title.trim().toLowerCase()}|${fixed[i].start.getTime()}`;
    if (seenFixed.has(key)) fixed.splice(i, 1);
    else seenFixed.add(key);
  }

  // Place tasks: most urgent target first; each takes the first free working slot at or after its target.
  const busy = fixed.filter((f) => f.blocking).map((f) => [f.start.getTime(), f.end.getTime()]);
  const overlaps = (s, e) => busy.some(([a, b]) => s < b && a < e);
  const rank = { high: 0, medium: 1, low: 2 };
  tasks.sort((a, b) => a.target - b.target || rank[a.priority] - rank[b.priority]);
  const placed = [];
  for (const t of tasks) {
    const overdue = t.target.getTime() < nowMs;
    let start = nextWorkingTime(overdue ? now : t.target);
    const moved = start.getTime() !== t.target.getTime() && !overdue;
    for (let i = 0; i < 400 && overlaps(start.getTime(), start.getTime() + SLOT); i++) start = nextWorkingTime(new Date(start.getTime() + SLOT));
    const end = new Date(start.getTime() + SLOT);
    busy.push([start.getTime(), end.getTime()]);
    const why = overdue
      ? `Overdue: was due ${clock(t.target, tz)} (${t.rule.charAt(0).toLowerCase()}${t.rule.slice(1)}). Moved to the next free slot.`
      : `${t.rule}${moved ? ", moved into working hours" : ""}.`;
    const { target, rule, deadline, duration, ...rest } = t;
    placed.push({ ...rest, start, end, dueAt: overdue ? target : null, overdue, why });
  }

  const items = [...fixed.map(({ blocking, ...f }) => f), ...placed]
    .filter((i) => i.start.getTime() >= nowMs - WINDOW_BACK && i.start.getTime() <= nowMs + WINDOW_AHEAD)
    .sort((a, b) => a.start - b.start);
  return { items, timeZone: tz, generatedAt: now, account };
}

/**
 * The meetings someone else asked the user for (decision #55): a timed meeting the AI marked as a request in the
 * latest email from another person, or a calendar invite in an email from another person. Automated mail never counts.
 * Each has a `key` (requestKey) so its decision can be found again.
 */
export function collectRequests({ messages, labels = [], invites = [], tz = "Asia/Beirut" }) {
  const human = (m) => !m.isAutomated && !m.isBulk;
  const byThread = new Map();
  for (const m of [...messages].sort((a, b) => a.date - b.date)) {
    if (!byThread.has(m.threadId)) byThread.set(m.threadId, []);
    byThread.get(m.threadId).push(m);
  }
  const out = [];
  for (const l of labels) {
    const when = l.when;
    if (!when || when.kind !== "meeting" || !when.request || when.allDay || !/T\d{2}:\d{2}$/.test(String(when.at)) || l.category === "automated") continue;
    const lastIn = [...(byThread.get(l.threadId) ?? [])].reverse().find((m) => m.direction === "in");
    if (!lastIn || !human(lastIn)) continue;
    const start = parseLocal(when.at, tz);
    if (!start) continue;
    out.push({ key: requestKey(l.threadId, start), threadId: l.threadId, gmailId: lastIn.gmailId, source: "email-text", title: when.what || `Meeting with ${nameOf(lastIn.from)}`,
      contact: nameOf(lastIn.from), start, end: new Date(start.getTime() + HOUR), receivedAt: lastIn.date });
  }
  for (const inv of invites) {
    const m = (byThread.get(inv.threadId) ?? []).find((x) => x.gmailId === inv.gmailId);
    if (!m || m.direction !== "in" || !human(m) || !inv.start) continue;
    const start = new Date(inv.start);
    out.push({ key: requestKey(inv.threadId, start), threadId: inv.threadId, gmailId: inv.gmailId, source: "invite", title: inv.summary || m.subject || "Meeting",
      contact: nameOf(m.from), start, end: inv.end ? new Date(inv.end) : new Date(start.getTime() + HOUR), receivedAt: m.date });
  }
  return out;
}
