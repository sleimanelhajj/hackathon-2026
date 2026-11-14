// Meeting requests around the rules in meetings.js (decision #55): stores each decision once, sends the emails, and
// keeps the user's availability. createMeetingDesk() is the tested core (tests/server/meeting-desk.test.mjs); the
// rest wires it to MongoDB and Gmail.
//
// Automatic emails (past or clashing requests) are the one exception to "a human approves every send" (AGENTS.md
// rule 4), decided by the user (decision #55). They go only after the user has saved their availability, only for
// requests that arrived after that, at most 3 per conversation, and every one is recorded and shown on the Schedule
// page. MEETING_EMAILS=dry-run (and sample data) records them without sending.
import { getDb } from "./db.js";
import { Availability, ON_CALENDAR, freeSlots, meetingEmail, planRequests } from "./meetings.js";
import { loadThread, replyTarget } from "./agent/reply.js";
import { sendReply } from "./gmail.js";

const clash = (busy, start, end) => busy.find((b) => +start < +b.end && +b.start < +end);

/**
 * @param store { insert(rec) → false if the id exists, update(id, set), get(id), list() }
 * @param send  (threadId, body) → { id, to } — sends a reply in the conversation
 */
export function createMeetingDesk({ store, send, now = () => new Date(), dryRun = false }) {
  const onCalendar = (records, busy, exceptThread = null) => [
    ...busy.filter((b) => !exceptThread || b.threadId !== exceptThread),
    ...records.filter((r) => ON_CALENDAR.has(r.status) && r.threadId !== exceptThread).map((r) => ({ start: r.start, end: r.end, title: r.title, threadId: r.threadId })),
  ];
  const deliver = async (threadId, body, isDryRun) => {
    if (isDryRun) return { dryRun: true, sentAt: null };
    const out = await send(threadId, body);
    return { sentAt: now(), gmailId: out?.id ?? null };
  };

  return {
    /** Decides the new requests and sends the automatic replies. Does nothing until availability is saved. */
    async process({ candidates, settings, busy = [], signature = "", dryRun: forceDry = false }) {
      if (!settings?.availability || !settings?.activatedAt) return { decided: 0, emailed: 0 };
      const tz = settings.timeZone;
      const at = now();
      const records = await store.list();
      const { decisions, superseded } = planRequests({ candidates, records, activatedAt: new Date(settings.activatedAt), now: at, avail: settings.availability, tz, busy });
      for (const id of superseded) await store.update(id, { status: "superseded", supersededAt: at });
      let decided = 0, emailed = 0;
      const taken = onCalendar(records, busy);
      for (const d of decisions) {
        if (ON_CALENDAR.has(d.status)) taken.push({ start: d.start, end: d.end, title: d.title, threadId: d.threadId });
        const rec = { ...d, decidedAt: at, decidedBy: "rules", email: null };
        if (!(await store.insert(rec))) continue; // another run got here first
        decided++;
        if (!d.autoReply) continue;
        const slots = freeSlots(settings.availability, taken, { from: at, duration: d.end - d.start, tz });
        const body = meetingEmail({ kind: d.reason, name: d.contact, start: d.start, end: d.end, slots, tz, signature });
        try {
          const out = await deliver(d.threadId, body, dryRun || forceDry);
          await store.update(d._id, { email: { kind: d.reason, body, ...out } });
          emailed++;
        } catch (err) {
          await store.update(d._id, { email: { kind: d.reason, body, error: String(err?.message ?? err).slice(0, 300) } });
        }
      }
      return { decided, emailed };
    },

    /** The user's answer to a request waiting for them: accept ("works for me") or decline (with free times). */
    async answer(id, accept, { settings, busy = [], signature = "", dryRun: forceDry = false }) {
      const rec = await store.get(id);
      if (!rec) throw new Error("That meeting request is no longer here. Reload the page.");
      if (rec.status !== "pending") throw new Error("This request was already answered.");
      const tz = settings?.timeZone;
      const avail = settings?.availability;
      if (!avail) throw new Error("Set your availability first.");
      const taken = onCalendar(await store.list(), busy, rec.threadId);
      const start = new Date(rec.start), end = new Date(rec.end);
      let kind, body;
      if (accept) {
        const hit = clash(taken, start, end);
        if (hit) throw new Error(`This now clashes with ${hit.title || "another meeting"}. Decline it, or move the other meeting first.`);
        kind = "accepted";
        body = meetingEmail({ kind, name: rec.contact, start, end, tz, signature });
      } else {
        kind = "declined";
        const slots = freeSlots(avail, taken, { from: now(), duration: end - start, tz });
        body = meetingEmail({ kind, name: rec.contact, start, end, slots, tz, signature });
      }
      const out = await deliver(rec.threadId, body, dryRun || forceDry); // throws on failure: nothing changes
      const set = { status: accept ? "confirmed" : "declined", decidedBy: "user", answeredAt: now(), email: { kind, body, ...out } };
      await store.update(id, set);
      return { ...rec, ...set };
    },

    /**
     * Sends a stored email that didn't go out: one that failed (Retry) or one written in test mode (Send now).
     * The user clicked for it. Never sends the same email twice.
     */
    async retry(id, { dryRun: forceDry = false } = {}) {
      const rec = await store.get(id);
      if (!rec?.email?.body || !(rec.email.error || rec.email.dryRun)) throw new Error("There's nothing to send for this request: its email already went out.");
      if (dryRun || forceDry) throw new Error("Test mode is on, so nothing can be sent. Turn off MEETING_EMAILS=dry-run (or connect real Gmail) first.");
      const out = await deliver(rec.threadId, rec.email.body, false);
      const email = { ...rec.email, ...out, error: null, dryRun: false };
      await store.update(id, { email });
      return { ...rec, email };
    },
  };
}

// ---------- MongoDB and Gmail ----------
const col = (name) => getDb().collection(name);
const KEEP_DAYS = 60;

function mongoStore() {
  return {
    async insert(rec) {
      try { await col("meeting_requests").insertOne(rec); return true; }
      catch (err) { if (err?.code === 11000) return false; throw err; }
    },
    update: (id, set) => col("meeting_requests").updateOne({ _id: id }, { $set: set }),
    get: (id) => col("meeting_requests").findOne({ _id: id }),
    list: () => col("meeting_requests").find({ start: { $gte: new Date(Date.now() - KEEP_DAYS * 864e5) } }).toArray(),
  };
}

/** Sends `body` as a reply in the conversation, to whoever wrote last, with the right threading headers. */
async function sendInThread(threadId, body) {
  const conn = await col("connections").findOne({ provider: "gmail" });
  const list = await loadThread(threadId);
  const { to, replyingTo } = replyTarget(list, String(conn?.email ?? "").toLowerCase());
  if (!to.length) throw new Error("No one to reply to in this conversation.");
  const subject = /^re:/i.test(replyingTo.subject || "") ? replyingTo.subject : `Re: ${replyingTo.subject || "Meeting request"}`;
  const last = list.at(-1);
  const references = [...(last.references || []), last.messageId].filter(Boolean).slice(-20);
  const sent = await sendReply({ threadId, to, subject, body, inReplyTo: last.messageId || null, references });
  await col("sent_replies").insertOne({ threadId, gmailId: sent.id, to: to.map((a) => a.email), subject, sentAt: new Date(), auto: "meeting" });
  return { id: sent.id, to: to.map((a) => a.email) };
}

let desk = null;
export const meetingEmailsDryRun = () => process.env.MEETING_EMAILS === "dry-run";
export function meetingDesk() {
  desk ??= createMeetingDesk({ store: mongoStore(), send: sendInThread, dryRun: meetingEmailsDryRun() });
  return desk;
}
export const listMeetingRequests = () => mongoStore().list();

export const getMeetingSettings = () => col("meeting_settings").findOne({ _id: "gmail" });

/** Saves the user's availability. The first save switches meeting requests on (`activatedAt`). */
export async function saveAvailability(input, timeZone) {
  const parsed = Availability.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "That availability isn't valid.");
  const current = await getMeetingSettings();
  const set = { availability: parsed.data, timeZone, updatedAt: new Date() };
  if (!current?.activatedAt) set.activatedAt = new Date();
  await col("meeting_settings").updateOne({ _id: "gmail" }, { $set: set }, { upsert: true });
  await col("audit_events").insertOne({ at: new Date(), actor: "user", action: "availability_saved", ok: true }).catch(() => {});
  return { ...current, ...set };
}

/** What the Schedule page shows about a request (no addresses; the email text is the user's own reply). */
export function publicRequest(r) {
  return {
    id: r._id, threadId: r.threadId, title: r.title, contact: r.contact ?? null, source: r.source, start: r.start, end: r.end, receivedAt: r.receivedAt,
    status: r.status, reason: r.reason ?? null, clashWith: r.clashWith ?? null, decidedAt: r.decidedAt, decidedBy: r.decidedBy,
    email: r.email ? { kind: r.email.kind, body: r.email.body, sentAt: r.email.sentAt ?? null, error: r.email.error ?? null, dryRun: Boolean(r.email.dryRun) } : null,
  };
}
