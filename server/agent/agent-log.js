// The agents' log (decision #67). Every piece of AI work runs as a "run" of one agent (team.js): the Gemini calls it
// makes (model, tokens, cost), the tools it uses (name, a short note on what came back) and the agents it hands work
// to (their own runs, linked as children). The Logs page shows costs from it and replays how the agents worked.
//
// Attribution needs no plumbing: run() keeps the current run in AsyncLocalStorage, so llm.js records each call under
// whichever agent is working when it happens, including a sub-agent called from inside another agent's run.
//
// Privacy: nothing an email, chat or file says is stored here. A run keeps a short task label (at most 140
// characters: the user's own question for Layla, "Sort 12 email threads" for Nadia), tool names with their arguments
// shortened, and counts. Recording never fails the work it records: a store error is dropped.
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { costOf, priceList, tokensOf } from "./pricing.js";

const TASK_MAX = 140;
const STEPS_MAX = 300;
const DAY = 86_400_000;
const short = (value, max) => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};
const round = (usd) => Math.round(usd * 1e9) / 1e9;
const singular = (word, n) => (n === 1 && word.endsWith("s") ? word.slice(0, -1) : word);

/** A tool result in a few words: "4 products", "done", or its error. Never the content itself. */
function summarize(result) {
  if (result == null) return "done";
  if (typeof result === "object" && result.error) return short(result.error, 120);
  if (Array.isArray(result)) return `${result.length} ${singular("results", result.length)}`;
  if (typeof result === "object") {
    for (const [key, value] of Object.entries(result)) {
      if (Array.isArray(value)) return `${value.length} ${singular(key.replace(/([A-Z])/g, " $1").toLowerCase(), value.length)}`;
    }
  }
  return "done";
}

export function createAgentLog({ store, now = () => new Date(), id = randomUUID } = {}) {
  const als = new AsyncLocalStorage();
  const pending = new Set();
  const save = (run) => {
    const { parent: _parent, ...doc } = run;
    const p = Promise.resolve().then(() => store.saveRun(doc)).catch(() => {}).finally(() => pending.delete(p));
    pending.add(p);
  };

  function open({ agent, task, trigger }) {
    const parent = als.getStore() ?? null;
    const run = {
      id: id(), agent, task: short(task, TASK_MAX), trigger: parent ? "agent" : trigger ?? "app",
      parentRunId: parent?.id ?? null, parentAgent: parent?.agent ?? null, rootRunId: parent?.rootRunId ?? null,
      startedAt: now(), endedAt: null, durationMs: null, ok: true, error: null,
      calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0, steps: [], truncated: false, parent,
    };
    run.rootRunId ??= run.id;
    if (parent) add(parent, { kind: "agent", name: agent, task: run.task, childRunId: run.id, ok: true });
    return run;
  }

  function add(run, step) {
    if (step.kind === "model") {
      run.calls += 1;
      run.inputTokens += step.inputTokens;
      run.outputTokens += step.outputTokens;
      run.thinkingTokens += step.thinkingTokens;
      run.costUsd = round(run.costUsd + step.costUsd);
    }
    if (run.steps.length >= STEPS_MAX) { run.truncated = true; return; }
    run.steps.push({ seq: run.steps.length + 1, at: now(), ...step });
  }

  function close(run, err) {
    run.endedAt = now();
    run.durationMs = run.endedAt - run.startedAt;
    if (err) {
      run.ok = false;
      run.error = short(err?.message ?? err, 200);
    }
    const handOff = run.parent?.steps.find((s) => s.childRunId === run.id);
    if (handOff) Object.assign(handOff, { ok: run.ok, durationMs: run.durationMs, ...(run.ok ? {} : { error: run.error }) });
    save(run);
  }

  /** Runs `fn` as `agent`'s task. Nested inside another run, it becomes that run's sub-agent run. */
  async function run(opts, fn) {
    const r = open(opts);
    try {
      const out = await als.run(r, fn);
      close(r);
      return out;
    } catch (err) {
      close(r, err);
      throw err;
    }
  }

  /** One Gemini call (called by llm.js). Outside any run it is kept as a one-step run of "app". */
  function modelCall({ model, usage = null, durationMs = 0, ok = true, error = null, fellBack = false }) {
    const at = now();
    const tokens = ok ? tokensOf(usage) : { inputTokens: 0, outputTokens: 0, thinkingTokens: 0 };
    const { costUsd, priced } = costOf({ model, ...tokens, at });
    const step = { kind: "model", name: model, model, ...tokens, costUsd, priced, durationMs, ok, ...(error ? { error: short(error, 200) } : {}), ...(fellBack ? { fellBack: true } : {}) };
    const current = als.getStore();
    if (current) return add(current, step);
    const lone = open({ agent: "app", task: "AI call outside an agent's task", trigger: "app" });
    add(lone, step);
    close(lone, ok ? null : error);
  }

  /** One tool an agent used, with its arguments shortened and a note on what came back. */
  function tool({ name, args, result, durationMs = 0, ok = true, error = null }) {
    const current = als.getStore();
    if (!current) return;
    add(current, {
      kind: "tool", name, args: args && Object.keys(args).length ? short(JSON.stringify(args), 160) : "",
      detail: ok ? summarize(result) : short(error, 120), durationMs, ok,
    });
  }

  const current = () => als.getStore()?.agent ?? null;
  const flush = () => Promise.all([...pending]);

  /** Costs and tokens for the last `days` days: totals, by agent, by model, by day (every day), latest calls. */
  async function usage({ days = 30 } = {}) {
    const today = new Date(Date.UTC(now().getUTCFullYear(), now().getUTCMonth(), now().getUTCDate()));
    const since = new Date(today.getTime() - (days - 1) * DAY);
    const steps = await store.listModelSteps(since);
    const blank = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0, failed: 0, unpriced: 0 });
    const plus = (acc, s) => {
      acc.calls += 1;
      acc.inputTokens += s.inputTokens ?? 0;
      acc.outputTokens += s.outputTokens ?? 0;
      acc.thinkingTokens += s.thinkingTokens ?? 0;
      acc.costUsd = round(acc.costUsd + (s.costUsd ?? 0));
      if (s.ok === false) acc.failed += 1;
      if (s.ok !== false && s.priced === false) acc.unpriced += 1;
      return acc;
    };
    const totals = blank();
    const agents = new Map(), models = new Map(), byDay = new Map();
    for (let d = 0; d < days; d++) byDay.set(new Date(since.getTime() + d * DAY).toISOString().slice(0, 10), { ...blank() });
    for (const s of steps) {
      plus(totals, s);
      plus(agents.get(s.agent) ?? agents.set(s.agent, blank()).get(s.agent), s);
      plus(models.get(s.model) ?? models.set(s.model, blank()).get(s.model), s);
      const day = byDay.get(new Date(s.at).toISOString().slice(0, 10));
      if (day) plus(day, s);
    }
    const ranked = (map, key) => [...map].map(([k, v]) => ({ [key]: k, ...v })).sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
    return {
      period: { days, from: since, to: now() },
      totals,
      byAgent: ranked(agents, "agent"),
      byModel: ranked(models, "model"),
      byDay: [...byDay].map(([day, v]) => ({ day, ...v })),
      calls: steps.toSorted((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100)
        .map(({ at, agent, model, inputTokens, outputTokens, thinkingTokens, costUsd, priced, ok, error, fellBack, durationMs, runId, task }) =>
          ({ at, agent, model, inputTokens, outputTokens, thinkingTokens, costUsd, priced, ok, error: error ?? null, fellBack: Boolean(fellBack), durationMs, runId, task })),
      prices: priceList(),
    };
  }

  /** The latest top-level runs, each with its sub-agents' runs nested and totals for the whole tree. */
  async function runs({ limit = 30, days = 30 } = {}) {
    const since = new Date(now().getTime() - days * DAY);
    const all = await store.listRuns({ since, limit });
    const byParent = new Map();
    for (const r of all) if (r.parentRunId) (byParent.get(r.parentRunId) ?? byParent.set(r.parentRunId, []).get(r.parentRunId)).push(r);
    const build = (r) => {
      const children = (byParent.get(r.id) ?? []).toSorted((a, b) => new Date(a.startedAt) - new Date(b.startedAt)).map(build);
      const tree = children.reduce((t, c) => ({
        calls: t.calls + c.tree.calls, inputTokens: t.inputTokens + c.tree.inputTokens, outputTokens: t.outputTokens + c.tree.outputTokens,
        costUsd: round(t.costUsd + c.tree.costUsd), steps: t.steps + c.tree.steps,
      }), { calls: r.calls, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd, steps: r.steps.length });
      return { ...r, children, tree };
    };
    const roots = all.filter((r) => !r.parentRunId).toSorted((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit);
    return { runs: roots.map(build) };
  }

  return { run, modelCall, tool, current, flush, usage, runs };
}

/** In-memory store, for tests. */
export function memoryAgentLogStore() {
  const runs = [];
  return {
    async saveRun(run) { runs.push(structuredClone(run)); },
    async listModelSteps(since) {
      return runs.filter((r) => new Date(r.startedAt) >= since || r.steps.some((s) => new Date(s.at) >= since))
        .flatMap((r) => r.steps.filter((s) => s.kind === "model" && new Date(s.at) >= since).map((s) => ({ ...s, agent: r.agent, runId: r.id, task: r.task })));
    },
    async listRuns({ since, limit }) {
      const roots = runs.filter((r) => !r.parentRunId && new Date(r.startedAt) >= since).toSorted((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit);
      const ids = new Set(roots.map((r) => r.id));
      return runs.filter((r) => ids.has(r.rootRunId)).map((r) => structuredClone(r));
    },
    dump: () => ({ runs: structuredClone(runs) }),
  };
}

/** MongoDB store: `agent_runs`, one document per run with its steps; kept 90 days. */
export function mongoAgentLogStore(getDb) {
  const c = () => getDb().collection("agent_runs");
  return {
    async ensureIndexes() {
      await Promise.all([
        c().createIndex({ startedAt: 1 }, { expireAfterSeconds: 90 * 86_400 }),
        c().createIndex({ rootRunId: 1 }),
        c().createIndex({ parentRunId: 1, startedAt: -1 }),
      ]);
    },
    async saveRun(run) { await c().insertOne({ _id: run.id, ...run }); },
    async listModelSteps(since) {
      const docs = await c().find({ startedAt: { $gte: new Date(since.getTime() - DAY) } }, { projection: { agent: 1, task: 1, steps: 1 } }).limit(5000).toArray();
      return docs.flatMap((r) => (r.steps ?? []).filter((s) => s.kind === "model" && new Date(s.at) >= since).map((s) => ({ ...s, agent: r.agent, runId: r._id, task: r.task })));
    },
    async listRuns({ since, limit }) {
      const roots = await c().find({ parentRunId: null, startedAt: { $gte: since } }, { projection: { _id: 1 } }).sort({ startedAt: -1 }).limit(limit).toArray();
      if (!roots.length) return [];
      return (await c().find({ rootRunId: { $in: roots.map((r) => r._id) } }).limit(limit * 40).toArray()).map(({ _id, ...r }) => ({ id: _id, ...r }));
    },
  };
}
