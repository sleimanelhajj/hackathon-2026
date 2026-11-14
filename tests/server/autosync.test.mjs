// Automatic Gmail sync (server/autosync.js): a cheap check on a timer, a full sync only when the mailbox changed,
// never two at once, backing off when Google or the network fails, and off when the user turns it off.
import assert from "node:assert/strict";
import test from "node:test";
import { createAutoSync } from "../../server/autosync.js";

process.env.TOKEN_SECRET ||= "a".repeat(64);
const { shouldSync } = await import("../../server/gmail.js");

/** Manual timers: tests run the next tick themselves. */
function fakeTimers() {
  const queue = [];
  return {
    setTimer: (fn, ms) => { const t = { fn, ms }; queue.push(t); return t; },
    clearTimer: (t) => { const i = queue.indexOf(t); if (i >= 0) queue.splice(i, 1); },
    async next() { const t = queue.shift(); if (!t) throw new Error("nothing scheduled"); await t.fn(); return t.ms; },
    get pending() { return queue.length; },
  };
}
const quiet = { warn() {}, log() {} };

test("checks on a timer and syncs only when the mailbox changed, then sorts the new mail", async () => {
  const timers = fakeTimers();
  const answers = [{ changed: false }, { changed: true }, { changed: false }];
  const calls = [];
  const auto = createAutoSync({
    intervalMs: 60_000, ...timers, log: quiet,
    check: async () => { calls.push("check"); return answers.shift(); },
    sync: async () => calls.push("sync"),
    after: async () => calls.push("analyse"),
  });
  auto.start();
  assert.equal(await timers.next(), 60_000);
  await timers.next();
  await timers.next();
  assert.deepEqual(calls, ["check", "check", "sync", "analyse", "check"]);
  auto.stop();
  assert.equal(timers.pending, 0, "stop cancels the next check");
});

test("never runs two syncs at once", async () => {
  const timers = fakeTimers();
  let release;
  let syncs = 0;
  const auto = createAutoSync({
    ...timers, log: quiet, check: async () => ({ changed: true }),
    sync: () => { syncs++; return new Promise((r) => { release = r; }); },
  });
  const first = auto.tick();
  await new Promise((r) => setImmediate(r));
  await auto.tick(); // a second tick while the first sync is still running
  release();
  await first;
  assert.equal(syncs, 1);
});

test("backs off after failures (up to 8x the interval) and recovers after a success", async () => {
  const timers = fakeTimers();
  let fail = 3;
  const auto = createAutoSync({
    intervalMs: 1000, ...timers, log: quiet,
    check: async () => { if (fail-- > 0) throw new Error("network down"); return { changed: false }; },
    sync: async () => {},
  });
  auto.start();
  const delays = [];
  for (let i = 0; i < 5; i++) delays.push(await timers.next());
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 1000]);
  auto.stop();
});

test("the cheap check: sync when the mailbox history moved; skip when off, syncing, or not a live Gmail", () => {
  const live = { mode: "live", status: "connected", historyId: "100", autoSync: true };
  assert.deepEqual(shouldSync(live, "100"), { changed: false, reason: "no new mail" });
  assert.deepEqual(shouldSync(live, "105"), { changed: true, reason: "mailbox changed" });
  assert.deepEqual(shouldSync({ ...live, historyId: null }, "105"), { changed: true, reason: "never synced" });
  assert.equal(shouldSync({ ...live, autoSync: false }, "105").changed, false);
  assert.equal(shouldSync({ ...live, status: "syncing" }, "105").changed, false);
  assert.equal(shouldSync({ ...live, mode: "sample" }, "105").changed, false);
  assert.equal(shouldSync(null, "105").changed, false);
  assert.equal(shouldSync({ ...live, autoSync: undefined }, "105").changed, true, "on unless turned off");
});
