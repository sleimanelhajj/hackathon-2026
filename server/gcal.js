// Google Calendar sync for the email schedule (decision #51).
//
// Least privilege: the scope is calendar.app.created, which only lets the app see and change calendars it created
// itself. The app creates one calendar, "AI Workspace OS", and writes the schedule there; the user's own calendars
// are never read or touched. A sync runs only when the user clicks Sync and confirms (AGENTS.md rule 4).
//
// Event ids come from the schedule item ids, so syncing again updates events instead of duplicating them. Unchanged
// events aren't rewritten, and items that left the schedule are removed from the app's calendar.
import crypto from "node:crypto";
import { zonedParts } from "./schedule.js";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export const CALENDAR_NAME = "AI Workspace OS";
const API = "https://www.googleapis.com/calendar/v3";
// Google colour ids: 11 tomato, 6 tangerine, 5 banana, 9 blueberry, 8 graphite, 4 flamingo.
const COLOURS = { meeting: "9", deadline: "4", "follow-up": "8", reply: { high: "11", medium: "6", low: "5" } };

/** A Google event id for a schedule item: lowercase hex (a subset of base32hex), stable for the same item. */
export const eventIdFor = (itemId) => crypto.createHash("sha256").update(`aiwos:${itemId}`).digest("hex").slice(0, 40);

const localDate = (date, tz) => {
  const p = zonedParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
};

/** The Google Calendar event for one schedule item. */
export function toGoogleEvent(item, tz) {
  const lines = [item.why, item.summary && `About: ${item.summary}`, item.suggestedAction && `Next step: ${item.suggestedAction}`,
    item.link && `Open the email: ${item.link}`, "", "Made by AI Workspace OS from your Gmail. Check details before acting."].filter((l) => l !== null && l !== undefined && l !== false);
  const colour = item.kind === "reply" ? COLOURS.reply[item.priority] ?? "6" : COLOURS[item.kind] ?? "8";
  const event = {
    id: eventIdFor(item.id),
    summary: `${item.overdue ? "Overdue: " : ""}${item.title}`.slice(0, 200),
    description: lines.join("\n").slice(0, 4000),
    colorId: colour,
    start: item.allDay ? { date: localDate(item.start, tz) } : { dateTime: item.start.toISOString(), timeZone: tz },
    end: item.allDay ? { date: localDate(new Date(item.start.getTime() + 864e5), tz) } : { dateTime: item.end.toISOString(), timeZone: tz },
    extendedProperties: { private: { aiwosItem: String(item.id) } },
    reminders: { useDefault: true },
  };
  if (item.location) event.location = item.location;
  if (item.link) event.source = { title: "Open in Gmail", url: item.link };
  return event;
}

const fingerprint = (event) => crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex").slice(0, 16);

/**
 * @param deps.request (method, path, body) => { status, body }   Google Calendar API calls, path relative to /calendar/v3
 * @param deps.load    () => saved sync state or null              { calendarId, events: { [itemId]: { eventId, hash } }, lastSyncAt }
 * @param deps.save    (state) => void
 */
export function createCalendarSync({ request, load, save }) {
  const enc = encodeURIComponent;
  async function ensureCalendar(state, tz) {
    if (state?.calendarId) {
      const found = await request("GET", `calendars/${enc(state.calendarId)}`);
      if (found.status === 200) return { calendarId: state.calendarId, events: state.events ?? {} };
    }
    // First sync, or the user deleted the calendar in Google: make a fresh one (its old events went with it).
    const made = await request("POST", "calendars", { summary: CALENDAR_NAME, timeZone: tz, description: "Your email schedule from AI Workspace OS: reply tasks, follow-ups, meetings and deadlines from Gmail." });
    if (made.status >= 300) throw new Error(`Google Calendar refused to create the "${CALENDAR_NAME}" calendar (${made.status}).`);
    return { calendarId: made.body.id, events: {} };
  }

  async function upsert(cal, event) {
    const path = `calendars/${enc(cal)}/events/${event.id}`;
    let res = await request("PUT", path, { ...event, status: "confirmed" });
    if (res.status === 404) {
      res = await request("POST", `calendars/${enc(cal)}/events`, event);
      // Google keeps the ids of deleted events: re-inserting one conflicts, but updating it brings it back.
      if (res.status === 409) res = await request("PUT", path, { ...event, status: "confirmed" });
    }
    return res.status < 300;
  }

  return {
    async run(items, tz) {
      const prev = await load();
      const { calendarId, events: known } = await ensureCalendar(prev, tz);
      const next = {};
      const out = { calendarId, created: 0, updated: 0, unchanged: 0, removed: 0, failed: 0 };
      for (const item of items) {
        const event = toGoogleEvent(item, tz);
        const hash = fingerprint(event);
        const before = known[item.id];
        if (before && before.hash === hash) { next[item.id] = before; out.unchanged++; continue; }
        if (await upsert(calendarId, event)) { next[item.id] = { eventId: event.id, hash }; out[before ? "updated" : "created"]++; }
        else out.failed++;
      }
      for (const [itemId, { eventId }] of Object.entries(known)) {
        if (next[itemId]) continue;
        const res = await request("DELETE", `calendars/${enc(calendarId)}/events/${eventId}`);
        if (res.status < 300 || res.status === 404 || res.status === 410) out.removed++;
        else { next[itemId] = known[itemId]; out.failed++; }
      }
      await save({ calendarId, events: next, lastSyncAt: new Date(), count: Object.keys(next).length });
      return out;
    },
  };
}

/** The real Google Calendar API, with the user's access token. */
export function googleRequest(token) {
  return async (method, path, body) => {
    const res = await fetch(`${API}/${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch { /* empty or non-JSON body (DELETE) */ }
    if (res.status === 401 || res.status === 403) {
      const reason = json?.error?.message ?? "";
      throw new Error(`Google Calendar refused access${reason ? `: ${reason}` : ""}. Click "Allow calendar access" and try again.`);
    }
    return { status: res.status, body: json };
  };
}
