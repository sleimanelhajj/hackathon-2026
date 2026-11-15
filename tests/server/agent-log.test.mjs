// Logs (decision #67): every Gemini call is recorded with its tokens and cost, under the agent that made it, and every
// step an agent takes (a model call, a tool, handing work to another agent) is kept as a run so the Logs page can show
// how the agents worked. Nothing an email, chat or file says is ever stored here.
import assert from "node:assert/strict";
import test from "node:test";
import { costOf, tokensOf, PRICE_SOURCE } from "../../server/agent/pricing.js";
import { TEAM, agentById } from "../../server/agent/team.js";
import { createAgentLog, memoryAgentLogStore } from "../../server/agent/agent-log.js";

// ---------- prices (Google's list prices, per 1M tokens) ----------
test("costs use Google's list price for the model on the day of the call", () => {
  const million = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  assert.deepEqual(costOf({ model: "gemini-3.8-flash", ...million, at: new Date("2026-11-15") }), { costUsd: 4.5, priced: true });
  assert.deepEqual(costOf({ model: "gemini-3.8-flash", ...million, at: new Date("2027-01-02") }), { costUsd: 9, priced: true }, "introductory price ends with 2026");
  assert.deepEqual(costOf({ model: "gemini-3.5-flash-lite", ...million, at: new Date("2026-11-15") }), { costUsd: 2.8, priced: true });
  assert.deepEqual(costOf({ model: "models/gemini-3.5-flash-lite-001", inputTokens: 2000, outputTokens: 400, at: new Date("2026-11-15") }), { costUsd: 0.0016, priced: true });
  assert.deepEqual(costOf({ model: "some-new-model", ...million, at: new Date() }), { costUsd: 0, priced: false }, "an unknown model is never guessed");
  assert.match(PRICE_SOURCE.url, /ai\.google\.dev/);
});

test("output tokens include the model's thinking, as Google bills them", () => {
  assert.deepEqual(tokensOf({ promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 200 }), { inputTokens: 1200, outputTokens: 500, thinkingTokens: 200 });
  assert.deepEqual(tokensOf(null), { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 });
});

// ---------- the team ----------
test("every agent has a name, a role, what it does, and who is above it", () => {
  const ids = new Set(TEAM.map((a) => a.id));
  const leads = TEAM.filter((a) => !a.parent);
  assert.equal(leads.length, 1, "one lead");
  for (const a of TEAM) {
    assert.ok(a.name && a.role && a.does.length > 30, a.id);
    if (a.parent) assert.ok(ids.has(a.parent), `${a.id} reports to a real agent`);
    if (a.parent) assert.ok(["sub-agent", "team"].includes(a.relation), a.id);
  }
  assert.equal(agentById("sami").parent, "layla");
  assert.equal(agentById("sami").relation, "sub-agent");
  assert.equal(agentById("lina").parent, "nadia");
});

// ---------- recording ----------
const clock = () => { let t = Date.parse("2026-11-15T10:00:00Z"); return () => new Date((t += 1000)); };
const setup = () => {
  const store = memoryAgentLogStore();
  let n = 0;
  const log = createAgentLog({ store, now: clock(), id: () => `run-${++n}` });
  return { store, log };
};

test("a run records its model calls, tools and the agent it hands work to, with tokens and costs adding up", async () => {
  const { store, log } = setup();
  const answer = await log.run({ agent: "layla", task: "Show me monthly sales of the 5 kWh battery", trigger: "you" }, async () => {
    log.modelCall({ model: "gemini-3.8-flash", usage: { promptTokenCount: 2000, candidatesTokenCount: 100, thoughtsTokenCount: 50 }, durationMs: 900 });
    log.tool({ name: "find_products", args: { query: "5 kWh battery" }, result: { products: [{}, {}] }, durationMs: 40 });
    await log.run({ agent: "sami", task: "monthly sales of the 5 kWh battery" }, async () => {
      log.modelCall({ model: "gemini-3.8-flash", usage: { promptTokenCount: 1000, candidatesTokenCount: 200 }, durationMs: 700 });
    });
    log.modelCall({ model: "gemini-3.5-flash-lite", usage: { promptTokenCount: 3000, candidatesTokenCount: 80 }, durationMs: 300, fellBack: true });
    return "done";
  });
  assert.equal(answer, "done");
  await log.flush();

  const { runs } = store.dump();
  const layla = runs.find((r) => r.agent === "layla"), sami = runs.find((r) => r.agent === "sami");
  assert.equal(sami.parentRunId, layla.id);
  assert.equal(sami.rootRunId, layla.id);
  assert.equal(layla.trigger, "you");
  assert.equal(sami.trigger, "agent");
  assert.deepEqual(layla.steps.map((s) => `${s.kind}:${s.name}`), ["model:gemini-3.8-flash", "tool:find_products", "agent:sami", "model:gemini-3.5-flash-lite"]);
  assert.equal(layla.steps[1].detail, "2 products");
  assert.equal(layla.steps[2].childRunId, sami.id);
  assert.equal(layla.steps[3].fellBack, true);
  assert.equal(layla.inputTokens, 5000);
  assert.equal(layla.outputTokens, 230);
  assert.equal(sami.inputTokens, 1000);
  const expected = (2000 * 0.75 + 150 * 3.75) / 1e6 + (3000 * 0.3 + 80 * 2.5) / 1e6;
  assert.ok(Math.abs(layla.costUsd - expected) < 1e-9, `${layla.costUsd} vs ${expected}`);
  assert.equal(layla.ok, true);
});

test("a failing run is kept with a short error, and the error still reaches the caller", async () => {
  const { store, log } = setup();
  await assert.rejects(log.run({ agent: "nadia", task: "Sort 3 email threads", trigger: "app" }, async () => {
    log.modelCall({ model: "gemini-3.8-flash", ok: false, error: "Gemini is overloaded right now. Try again in a few minutes.", durationMs: 4000 });
    throw new Error("Gemini is overloaded right now. Try again in a few minutes.");
  }), /overloaded/);
  await log.flush();
  const [run] = store.dump().runs;
  assert.equal(run.ok, false);
  assert.match(run.error, /overloaded/);
  assert.equal(run.steps[0].ok, false);
  assert.equal(run.costUsd, 0, "a failed call costs nothing");
});

test("a call outside any agent's run is still counted (as the app), and the task is kept short", async () => {
  const { store, log } = setup();
  log.modelCall({ model: "gemini-3.8-flash", usage: { promptTokenCount: 10, candidatesTokenCount: 5 }, durationMs: 100 });
  await log.run({ agent: "tala", task: "x".repeat(500), trigger: "you" }, async () => {});
  await log.flush();
  const runs = store.dump().runs;
  assert.equal(runs.find((r) => r.agent === "app").inputTokens, 10);
  assert.ok(runs.find((r) => r.agent === "tala").task.length <= 140);
});

test("usage adds up by agent, by model and by day, with the latest calls listed", async () => {
  const { log } = setup();
  await log.run({ agent: "layla", task: "q1", trigger: "you" }, async () => {
    log.modelCall({ model: "gemini-3.8-flash", usage: { promptTokenCount: 1000, candidatesTokenCount: 100 }, durationMs: 500 });
    await log.run({ agent: "sami", task: "w" }, async () => log.modelCall({ model: "gemini-3.8-flash", usage: { promptTokenCount: 500, candidatesTokenCount: 50 }, durationMs: 400 }));
  });
  await log.run({ agent: "nadia", task: "Sort 2 email threads", trigger: "app" }, async () => {
    log.modelCall({ model: "gemini-3.5-flash-lite", usage: { promptTokenCount: 4000, candidatesTokenCount: 600 }, durationMs: 800 });
  });
  await log.flush();
  const u = await log.usage({ days: 30 });
  assert.equal(u.totals.calls, 3);
  assert.equal(u.totals.inputTokens, 5500);
  assert.equal(u.totals.outputTokens, 750);
  assert.deepEqual(u.byAgent.map((a) => a.agent), ["nadia", "layla", "sami"], "most expensive first");
  assert.equal(u.byModel.length, 2);
  assert.equal(u.byDay.length, 30, "every day of the period, empty ones included");
  assert.ok(Math.abs(u.byDay.reduce((s, d) => s + d.costUsd, 0) - u.totals.costUsd) < 1e-9);
  assert.equal(u.calls.length, 3);
  assert.equal(u.calls[0].agent, "nadia", "newest first");
  assert.match(u.prices.source, /ai\.google\.dev/);
});

test("runs come back as trees: the top-level run with its sub-agents' runs and totals for the whole tree", async () => {
  const { log } = setup();
  await log.run({ agent: "layla", task: "Show battery sales", trigger: "you" }, async () => {
    log.modelCall({ model: "gemini-3.8-flash", usage: { promptTokenCount: 100, candidatesTokenCount: 10 }, durationMs: 100 });
    await log.run({ agent: "sami", task: "battery sales" }, async () => log.modelCall({ model: "gemini-3.8-flash", usage: { promptTokenCount: 200, candidatesTokenCount: 20 }, durationMs: 100 }));
  });
  await log.flush();
  const { runs } = await log.runs({ limit: 10 });
  assert.equal(runs.length, 1, "only top-level runs");
  assert.equal(runs[0].agent, "layla");
  assert.equal(runs[0].children.length, 1);
  assert.equal(runs[0].children[0].agent, "sami");
  assert.equal(runs[0].tree.inputTokens, 300);
  assert.equal(runs[0].tree.calls, 2);
});
