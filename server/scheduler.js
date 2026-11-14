// Background Gmail monitoring (roadmap #7): every SYNC_INTERVAL_MINUTES the API re-syncs a *live* Gmail connection
// and then runs the AI analysis on whatever is new. This is scheduled polling, not push: the UI says
// "checks every N min" and shows the real last-synced time. Never call it real-time.
//
// - Only live Gmail (never sample data), and never while a sync is already running.
// - Skips a run if someone synced recently (e.g. "Sync now", or a teammate's server sharing the database).
// - Stops trying after Google refuses access ("Reconnect Gmail") until the user reconnects.
// - Backs off on errors: 1x, 2x, 4x, then 8x the interval.
import { getDb } from "./db.js";
import { syncGmail } from "./gmail.js";
import { startAnalysis } from "./agent/classify.js";

const MINUTE = 60 * 1000;
const FIRST_RUN_DELAY_MS = 30 * 1000; // let the server finish starting first

export function syncIntervalMinutes() {
  const raw = process.env.SYNC_INTERVAL_MINUTES?.trim();
  if (raw === undefined || raw === "") return 15;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 15;
  if (n === 0) return 0; // off
  return Math.min(Math.max(n, 5), 24 * 60); // between 5 minutes and 1 day
}

let timer = null;
let running = false;
let failures = 0;
let nextRunAt = null;

/** What the UI shows: whether auto-sync is on, how often, and when the next check is due. */
export function autoSyncInfo() {
  const every = syncIntervalMinutes();
  return { enabled: every > 0, everyMinutes: every, nextRunAt: nextRunAt?.toISOString() ?? null, failures };
}

function schedule(delayMs) {
  clearTimeout(timer);
  nextRunAt = new Date(Date.now() + delayMs);
  timer = setTimeout(tick, delayMs);
  timer.unref?.(); // never keep the process alive just for this
}

/** Decides whether this run should sync, and why not if it shouldn't. Exported for tests. */
export function shouldSync(conn, now = Date.now(), everyMinutes = syncIntervalMinutes()) {
  if (!conn) return { sync: false, why: "no connection" };
  if (conn.mode !== "live") return { sync: false, why: "not a live Gmail connection" };
  if (conn.status === "syncing") return { sync: false, why: "already syncing" };
  if (conn.status === "error" && /reconnect/i.test(conn.error ?? "")) return { sync: false, why: "needs reconnect" };
  const last = conn.lastSyncAt ? new Date(conn.lastSyncAt).getTime() : 0;
  if (now - last < everyMinutes * MINUTE * 0.8) return { sync: false, why: "synced recently" };
  return { sync: true };
}

async function tick() {
  const every = syncIntervalMinutes();
  if (!every || running) return;
  running = true;
  try {
    const conn = await getDb().collection("connections").findOne({ provider: "gmail" });
    const decision = shouldSync(conn);
    if (decision.sync) {
      const { count } = await syncGmail();
      await startAnalysis(); // only new or changed threads go to Gemini
      console.log(`Auto-sync: imported ${count} messages from the last 30 days.`);
    }
    failures = 0;
  } catch (err) {
    failures += 1;
    console.error(`Auto-sync failed (${failures} in a row): ${err.message}`);
  } finally {
    running = false;
    schedule(every * MINUTE * 2 ** Math.min(failures, 3));
  }
}

export function startScheduler() {
  const every = syncIntervalMinutes();
  if (!every) {
    console.log("Auto-sync is off (SYNC_INTERVAL_MINUTES=0).");
    return;
  }
  console.log(`Auto-sync: checking Gmail every ${every} min.`);
  schedule(FIRST_RUN_DELAY_MS);
}

export function stopScheduler() {
  clearTimeout(timer);
  timer = null;
  nextRunAt = null;
}
