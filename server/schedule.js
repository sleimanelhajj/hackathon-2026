// The email schedule: a plan for the user's week built only from their Gmail data. Every item says why it's there
// (`why`) and links back to its email (AGENTS.md rule 3). Rules:
//
//   meeting    a calendar invite (.ics) at its real time, or a meeting the email text mentions (AI-read `when`)
//   deadline   a deadline the email text mentions, shown as a marker at that time
//   reply      a thread waiting on the user's reply: urgent (high) 2 hours after it arrived, normal (medium) the next
//              working morning, low within 3 working days; never after a deadline the email mentions
//   follow-up  a thread where the user wrote last: 3 working days later, if they haven't heard back
//
// Tasks are 30-minute blocks in working hours (Mon–Fri, 9:00–18:00 in the user's time zone). They never overlap a
// meeting or each other: each takes the first free slot at or after its target time. A target that has already passed
// moves to the next free slot from now and is marked overdue. Automated mail and newsletters are left out.
// Everything here is pure; loadSchedule() at the bottom reads the data from MongoDB.

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SLOT = 30 * MIN;
const START_HOUR = 9;
const END_HOUR = 18;
const WINDOW_BACK = 14 * DAY;
const WINDOW_AHEAD = 60 * DAY;

// ---------- time zones (no library: Intl knows every zone) ----------
const fmtCache = new Map();
function formatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" }));
  }
  return fmtCache.get(tz);
}
/** Wall-clock parts of `date` in `tz`: { y, m (1-12), d, h, min, dow ("Mon".."Sun") }. */
export function zonedParts(date, tz) {
  const p = Object.fromEntries(formatter(tz).formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute, dow: p.weekday };
}
/** The instant when the wall clock in `tz` shows { y, m, d, h, min }. */
export function fromZoned({ y, m, d, h = 0, min = 0 }, tz) {
  const want = Date.UTC(y, m - 1, d, h, min);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    const diff = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - want;
    if (!diff) break;
    guess -= diff;
  }
  return new Date(guess);
}
/** "2026-11-12T15:00" (wall clock in tz) → Date; null if it isn't a valid local date-time. */
function parseLocal(value, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(value ?? ""));
  if (!m) return null;
  const date = fromZoned({ y: +m[1], m: +m[2], d: +m[3], h: m[4] ? +m[4] : START_HOUR, min: m[5] ? +m[5] : 0 }, tz);
  return Number.isNaN(date.getTime()) ? null : date;
}

const WEEKEND = new Set(["Sat", "Sun"]);
const isWorking = (date, tz) => {
  const p = zonedParts(date, tz);
  return !WEEKEND.has(p.dow) && p.h >= START_HOUR && (p.h < END_HOUR) && !(p.h === END_HOUR - 1 && p.min > 30);
};
/** The same moment if it's in working hours (with room for a 30-minute task), else the next working day at 9:00. */
function nextWorkingTime(date, tz) {
  if (isWorking(date, tz)) return date;
  let p = zonedParts(date, tz);
  let day = fromZoned({ y: p.y, m: p.m, d: p.d, h: START_HOUR }, tz);
  if (p.h >= START_HOUR) day = new Date(day.getTime() + DAY); // after hours: tomorrow
  for (let i = 0; i < 7; i++) {
    p = zonedParts(day, tz);
    if (!WEEKEND.has(p.dow)) return fromZoned({ y: p.y, m: p.m, d: p.d, h: START_HOUR }, tz);
    day = new Date(day.getTime() + DAY);
  }
  return day;
}
/** `n` working days after `date`, at `hour` local time. */
function addWorkingDays(date, n, hour, tz) {
  let p = zonedParts(date, tz);
  let day = fromZoned({ y: p.y, m: p.m, d: p.d, h: 12 }, tz);
  let left = n;
  while (left > 0) {
    day = new Date(day.getTime() + DAY);
    if (!WEEKEND.has(zonedParts(day, tz).dow)) left--;
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
export function buildSchedule({ messages, labels = [], invites = [], now = new Date(), tz = "Asia/Beirut", account = "" }) {
  const nowMs = now.getTime();
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
    fixed.push({
      id: safeId(`invite-${inv.gmailId}-${start.getTime()}`), kind: "meeting", source: "invite", title: inv.summary || m?.subject || "Meeting",
      start, end, blocking: true, location: inv.location ?? null, threadId: inv.threadId, link: m ? gmailLink(m) : null,
      contact: m ? nameOf(m.from) : null, why: `From the calendar invite attached to the email${m ? ` from ${nameOf(m.from)}` : ""}.`,
    });
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
        fixed.push({ ...base, id: safeId(`meeting-${threadId}`), kind: "meeting", source: "email-text", title: when.what || `Meeting with ${contact}`,
          start: whenAt, end: new Date(whenAt.getTime() + span), allDay, blocking: !allDay,
          why: `A meeting mentioned in the email from ${contact}: "${when.what}". The time was read by AI from the text, so check it.` });
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
      else if (priority === "medium") { target = addWorkingDays(received, 1, 10, tz); rule = `Normal priority: the working morning after ${contact}'s email arrived`; }
      else { target = addWorkingDays(received, 3, 10, tz); rule = `Low priority: within 3 working days of ${contact}'s email`; }
      if (deadline && target.getTime() + SLOT > deadline.getTime()) {
        target = new Date(Math.max(received.getTime(), deadline.getTime() - 2 * HOUR));
        rule = `${rule.split(":")[0]}: 2 hours before the deadline the email mentions`;
      }
      tasks.push({ ...base, id: safeId(`reply-${threadId}`), kind: "reply", priority, title: `Reply to ${contact}`, target, rule, deadline });
    } else if (last.direction === "out" && human(last) && (!lastIn || human(lastIn))) {
      tasks.push({ ...base, id: safeId(`follow-up-${threadId}`), kind: "follow-up", priority: "low", title: `Follow up with ${contact}`,
        target: addWorkingDays(last.date, 3, START_HOUR, tz), rule: `You wrote last (${clock(last.date, tz)}); follow up after 3 working days without a reply`, duration: SLOT });
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
    let start = nextWorkingTime(overdue ? now : t.target, tz);
    const moved = start.getTime() !== t.target.getTime() && !overdue;
    for (let i = 0; i < 400 && overlaps(start.getTime(), start.getTime() + SLOT); i++) start = nextWorkingTime(new Date(start.getTime() + SLOT), tz);
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
