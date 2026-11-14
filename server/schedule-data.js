// Loads what the schedule needs from MongoDB and Gmail, and runs the Google Calendar sync.
// The rules themselves live in schedule.js (pure, tested); the sync logic in gcal.js (tested against a fake API).
import { getDb } from "./db.js";
import { buildSchedule } from "./schedule.js";
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

/** The schedule for the connected mailbox, plus what the page needs to know about Google Calendar. */
export async function loadSchedule({ tz = DEFAULT_TIME_ZONE, now = new Date() } = {}) {
  const db = getDb();
  const conn = await db.collection("connections").findOne({ provider: "gmail" });
  if (!conn) return { connected: false, items: [], timeZone: tz };
  const messages = await db.collection("messages")
    .find({ date: { $gte: new Date(now.getTime() - LOOKBACK_DAYS * DAY) } }, {
      projection: { gmailId: 1, threadId: 1, source: 1, direction: 1, subject: 1, from: 1, to: 1, date: 1, isAutomated: 1, isBulk: 1, hasCalendarInvite: 1, attachments: 1 },
    })
    .toArray();
  const labels = await db.collection("extractions")
    .find({}, { projection: { threadId: 1, category: 1, priority: 1, needsReply: 1, summary: 1, suggestedAction: 1, when: 1 } })
    .toArray();
  const invites = await loadInvites(messages, tz);
  const schedule = buildSchedule({ messages, labels, invites, now, tz, account: conn.email });
  const sync = await db.collection("calendar_sync").findOne({ _id: "gmail" });
  return {
    connected: true,
    sample: conn.mode === "sample",
    ...schedule,
    analysis: { status: conn.analysis?.status ?? null, analysed: labels.length },
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
