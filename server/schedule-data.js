// Loads what the schedule needs from MongoDB and Gmail, and runs the Google Calendar sync.
// The rules themselves live in schedule.js (pure, tested); the sync logic in gcal.js (tested against a fake API).
import { getDb } from "./db.js";
import { buildSchedule, collectRequests } from "./schedule.js";
import { DEFAULT_AVAILABILITY, requestKey } from "./meetings.js";
import { getMeetingSettings, listMeetingRequests, meetingDesk, meetingEmailsDryRun, publicRequest, saveAvailability } from "./meeting-data.js";
import { canSyncCalendar, fetchAttachment, googleAccessToken } from "./gmail.js";
import { parseIcsEvents } from "./agent/files.js";
import { CALENDAR_NAME, createCalendarSync, googleRequest } from "./gcal.js";

const DAY = 864e5;
const LOOKBACK_DAYS = 30;
export const DEFAULT_TIME_ZONE = process.env.TIME_ZONE || "Asia/Beirut";

/** A time zone the server can use (the browser's), or the default. */
export function safeTimeZone(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return DEFAULT_TIME_ZONE; }
}

/** Calendar invites attached to recent emails, parsed once and cached in `calendar_invites`. */
async function loadInvites(messages, tz) {
  const db = getDb();
  const withInvite = messages.filter((m) => m.hasCalendarInvite);
  if (!withInvite.length) return [];
  const cached = new Map((await db.collection("calendar_invites").find({ _id: { $in: withInvite.map((m) => m.gmailId) } }).toArray()).map((c) => [c._id, c]));
  const invites = [];
  for (const m of withInvite) {
    let entry = cached.get(m.gmailId);
    if (!entry) {
      const ics = (m.attachments ?? []).find((a) => a.attachmentId && (a.mimeType === "text/calendar" || /\.ics$/i.test(a.filename || "")));
      let events = [];
      let error = null;
      if (ics && m.source === "gmail") {
        try { events = parseIcsEvents((await fetchAttachment(m.gmailId, ics.attachmentId)).data, tz); }
        catch (err) { error = String(err?.message ?? err).slice(0, 200); }
      }
      entry = { _id: m.gmailId, threadId: m.threadId, events, error, parsedAt: new Date() };
      await db.collection("calendar_invites").updateOne({ _id: m.gmailId }, { $set: entry }, { upsert: true });
    }
    for (const e of entry.events ?? []) invites.push({ ...e, gmailId: m.gmailId, threadId: m.threadId });
  }
  return invites;
}

/** Decisions by request key, plus the latest per conversation (for a time the AI re-read slightly differently). */
function requestMap(records) {
  const map = new Map();
  for (const r of [...records].sort((a, b) => new Date(a.decidedAt) - new Date(b.decidedAt))) {
    if (r.status === "superseded") continue;
    map.set(r.key, r);
    map.set(`thread|${r.threadId}`, r);
  }
  return map;
}
/** The user's name as it appears on their own sent mail, to sign automatic replies ("" if only an address is known). */
function ownName(messages) {
  const name = [...messages].sort((a, b) => b.date - a.date).find((m) => m.direction === "out" && m.from?.name && !m.from.name.includes("@"))?.from.name;
  return name?.trim() ?? "";
}

/** Everything the meeting rules need, read once. */
async function loadContext({ tz = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const db = getDb();
  const conn = await db.collection("connections").findOne({ provider: "gmail" });
  if (!conn) return { conn: null };
  const messages = await db.collection("messages")
    .find({ date: { $gte: new Date(now.getTime() - LOOKBACK_DAYS * DAY) } }, {
      projection: { gmailId: 1, threadId: 1, source: 1, direction: 1, subject: 1, from: 1, to: 1, date: 1, isAutomated: 1, isBulk: 1, hasCalendarInvite: 1, attachments: 1 },
    })
    .toArray();
  const labels = await db.collection("extractions")
    .find({}, { projection: { threadId: 1, category: 1, priority: 1, needsReply: 1, summary: 1, suggestedAction: 1, when: 1 } })
    .toArray();
  const invites = await loadInvites(messages, tz);
  const settings = await getMeetingSettings();
  return { conn, messages, labels, invites, settings, now, tz };
}

/** Meetings already on the calendar that aren't requests (so a request that overlaps one is a clash). */
function busyMeetings(ctx, records, candidates) {
  const keys = new Set(candidates.map((c) => c.key));
  const { items } = buildSchedule({ ...ctx, availability: ctx.settings?.availability, requests: requestMap(records) });
  return items.filter((i) => i.kind === "meeting" && !i.allDay && !i.request && !keys.has(requestKey(i.threadId, i.start)))
    .map((i) => ({ start: i.start, end: i.end, title: i.title, threadId: i.threadId }));
}
const meetingTz = (ctx) => ctx.settings?.timeZone || ctx.tz;
const dryRunFor = (conn) => meetingEmailsDryRun() || conn?.mode !== "live"; // sample data can't send

/** Judges new meeting requests and sends the automatic replies (decision #55). Safe to run often and in parallel. */
export async function processMeetingRequests({ tz, now = new Date(), ctx: loaded = null } = {}) {
  const settings = loaded ? loaded.settings : await getMeetingSettings();
  if (!settings?.activatedAt) return { decided: 0, emailed: 0 };
  const ctx = loaded ?? await loadContext({ tz: tz || settings.timeZone || DEFAULT_TIME_ZONE, now });
  if (!ctx.conn) return { decided: 0, emailed: 0 };
  const candidates = collectRequests({ ...ctx, tz: meetingTz(ctx) });
  const records = await listMeetingRequests();
  const out = await meetingDesk().process({ candidates, settings: ctx.settings, busy: busyMeetings(ctx, records, candidates), signature: ownName(ctx.messages), dryRun: dryRunFor(ctx.conn) });
  if (out.emailed) await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "agent", action: "meeting_autoreplies", count: out.emailed, ok: true }).catch(() => {});
  return out;
}

/** The user's answer to a meeting request waiting for them. Sends the email; throws (changing nothing) if it can't. */
export async function answerMeetingRequest(id, accept) {
  const ctx = await loadContext({ tz: (await getMeetingSettings())?.timeZone || DEFAULT_TIME_ZONE });
  if (!ctx.conn) throw new Error("Connect Gmail first.");
  const records = await listMeetingRequests();
  const out = await meetingDesk().answer(id, accept, { settings: ctx.settings, busy: busyMeetings(ctx, records, []), signature: ownName(ctx.messages), dryRun: dryRunFor(ctx.conn) });
  await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "user", action: accept ? "meeting_accepted" : "meeting_declined", requestId: id, approved: true, ok: true }).catch(() => {});
  return publicRequest(out);
}

export async function retryMeetingEmail(id) {
  const conn = await getDb().collection("connections").findOne({ provider: "gmail" });
  const out = await meetingDesk().retry(id, { dryRun: dryRunFor(conn) });
  await getDb().collection("audit_events").insertOne({ at: new Date(), actor: "user", action: "meeting_email_retried", requestId: id, approved: true, ok: true }).catch(() => {});
  return publicRequest(out);
}

export { saveAvailability };

/** The schedule for the connected mailbox, plus what the page needs to know about Google Calendar and meetings. */
export async function loadSchedule({ tz = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const db = getDb();
  const ctx = await loadContext({ tz, now });
  const { conn, messages, labels, invites, settings } = ctx;
  if (!conn) return { connected: false, items: [], timeZone: tz };
  // New meeting requests are judged before the page is built, with the data already loaded (decision #55).
  await processMeetingRequests({ now, ctx }).catch((err) => console.error("Meeting requests:", err.message));
  const records = await listMeetingRequests();
  const schedule = buildSchedule({ messages, labels, invites, now, tz, account: conn.email, availability: settings?.availability ?? DEFAULT_AVAILABILITY, requests: requestMap(records) });
  const sync = await db.collection("calendar_sync").findOne({ _id: "gmail" });
  return {
    connected: true,
    sample: conn.mode === "sample",
    ...schedule,
    analysis: { status: conn.analysis?.status ?? null, analysed: labels.length },
    meetings: {
      availability: settings?.availability ?? null, // null until the user saves it; then requests are answered
      defaultAvailability: DEFAULT_AVAILABILITY,
      timeZone: settings?.timeZone ?? tz,
      activatedAt: settings?.activatedAt ?? null,
      dryRun: dryRunFor(conn),
      requests: records
        .filter((r) => r.status === "pending" || r.autoReply || r.decidedBy === "user")
        .sort((a, b) => new Date(b.decidedAt) - new Date(a.decidedAt))
        .slice(0, 40)
        .map(publicRequest),
    },
    calendar: {
      canSync: canSyncCalendar(conn),
      name: CALENDAR_NAME,
      lastSyncAt: sync?.lastSyncAt ?? null,
      syncedCount: sync?.count ?? 0,
    },
  };
}

/** Writes the current schedule to the app's own Google calendar. Call only after the user confirmed. */
export async function syncSchedule({ tz = DEFAULT_TIME_ZONE } = {}) {
  const db = getDb();
  const conn = await db.collection("connections").findOne({ provider: "gmail" });
  if (!canSyncCalendar(conn)) throw new Error("Allow calendar access first: click \"Allow calendar access\" on the Schedule page.");
  const { items } = await loadSchedule({ tz });
  const sync = createCalendarSync({
    request: googleRequest(await googleAccessToken()),
    load: () => db.collection("calendar_sync").findOne({ _id: "gmail" }),
    save: (state) => db.collection("calendar_sync").updateOne({ _id: "gmail" }, { $set: state }, { upsert: true }),
  });
  const out = await sync.run(items, tz);
  await db.collection("audit_events").insertOne({ at: new Date(), actor: "user", action: "calendar_synced", approved: true, ...out, ok: out.failed === 0 }).catch(() => {});
  return { ...out, total: items.length, calendarName: CALENDAR_NAME };
}
