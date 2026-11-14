// Automatic Gmail sync (decision #52): a cheap check on a timer, and a full sync only when the mailbox changed.
//
// Gmail push notifications need a Google Cloud Pub/Sub topic and a public HTTPS address, which a local server doesn't
// have. So instead the server asks Gmail for the mailbox's current history id every minute (1 quota unit of 6,000 per
// minute). When it moved, new mail or a change arrived: run the normal incremental sync, then sort the new threads.
// The app still shows "last checked" / "last synced" and never claims to be real-time (AGENTS.md rule 7).

/**
 * @param deps.check  () => { changed: boolean, reason?: string }   the cheap "anything new?" question
 * @param deps.sync   () => void                                       the normal incremental Gmail sync
 * @param deps.after  () => void                                       what runs after a sync (AI sorting)
 */
export function createAutoSync({ check, sync, after = async () => {}, intervalMs = 60_000, setTimer = setTimeout, clearTimer = clearTimeout, log = console }) {
  let timer = null;
  let running = false;
  let stopped = true;
  let failures = 0;

  function schedule() {
    if (stopped) return;
    // After failures, wait longer (2x, 4x, up to 8x) so a network or Google outage isn't hammered.
    const delay = intervalMs * Math.min(8, 2 ** failures);
    timer = setTimer(tick, delay);
    timer?.unref?.(); // never keep the process alive just for this
  }

  async function tick() {
    if (running) return; // a slow sync is still going: skip this round
    running = true;
    try {
      const result = await check();
      if (result?.changed) {
        await sync();
        await after();
      }
      failures = 0;
    } catch (err) {
      failures++;
      log.warn?.(`Auto-sync check failed (${failures}): ${String(err?.message ?? err).slice(0, 200)}`);
    } finally {
      running = false;
      if (!stopped) schedule();
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
    /** One check now (also used by tests). */
    tick: async () => {
      const wasStopped = stopped;
      stopped = true; // a manual tick doesn't reschedule
      try { await tick(); } finally { stopped = wasStopped; }
    },
  };
}
