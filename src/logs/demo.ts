import type { Agent, AgentRun, RunStep } from "../lib/api";
import { replay } from "./RunReplay";
import { toolName, toolSource, tokens, usd } from "./format";

// The demo tour of the space map (decision #67): a made-up test task, clearly labelled as an example, that walks
// through every kind of link. You ask Layla for a chart; she asks Gemini, looks up the product, hands the chart to
// Sami, who checks it and puts it on the dashboard. Then a Gmail sync wakes Nadia, who passes a scanned invoice to
// Lina. None of it is a real run and none of it is counted in the Logs.

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
let seq = 0;
const model = (input: number, output: number, costUsd: number, ms: number): RunStep =>
  ({ seq: ++seq, at: at(0), kind: "model", name: "gemini-3.8-flash", model: "gemini-3.8-flash", inputTokens: input, outputTokens: output, costUsd, priced: true, ok: true, durationMs: ms });
const tool = (name: string, detail: string, args: string): RunStep => ({ seq: ++seq, at: at(0), kind: "tool", name, detail, args, ok: true, durationMs: 40 });
const handOff = (name: string, task: string, childRunId: string): RunStep => ({ seq: ++seq, at: at(0), kind: "agent", name, task, childRunId, ok: true });
const run = (r: Partial<AgentRun> & Pick<AgentRun, "id" | "agent" | "task" | "trigger" | "steps">): AgentRun => {
  const children = r.children ?? [];
  const own = r.steps.filter((s) => s.kind === "model");
  const sum = (k: "inputTokens" | "outputTokens" | "costUsd") => own.reduce((s, x) => s + (x[k] ?? 0), 0) + children.reduce((s, c) => s + c.tree[k], 0);
  return {
    parentRunId: null, startedAt: at(3), endedAt: at(2), durationMs: 4200, ok: true, error: null,
    calls: own.length, inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), costUsd: sum("costUsd"), children,
    tree: { calls: own.length + children.reduce((s, c) => s + c.tree.calls, 0), inputTokens: sum("inputTokens"), outputTokens: sum("outputTokens"), costUsd: sum("costUsd"), steps: r.steps.length },
    ...r,
  };
};

const sami = run({
  id: "demo-sami", agent: "sami", task: "monthly sales of the 5 kWh battery", trigger: "agent", parentRunId: "demo-layla", durationMs: 1600,
  steps: [model(2400, 160, 0.0024, 900), tool("create_widget", "done", "{\"metric\":\"revenue\",\"groupBy\":\"month\",\"products\":[\"CH-0004\"]}")],
});
const lina = run({
  id: "demo-lina", agent: "lina", task: "Read a scanned PDF", trigger: "agent", parentRunId: "demo-nadia", durationMs: 2100,
  steps: [model(1800, 240, 0.0022, 1500)],
});

/** The example task the demo plays (two runs: one you start, one the app starts). */
export const DEMO_RUNS: AgentRun[] = [
  run({
    id: "demo-layla", agent: "layla", task: "Show me monthly sales of the 5 kWh battery", trigger: "you",
    steps: [model(6100, 40, 0.0047, 1100), tool("find_products", "1 product", "{\"query\":\"5 kWh battery\"}"), handOff("sami", "monthly sales of the 5 kWh battery", "demo-sami"), model(6600, 90, 0.0053, 1200)],
    children: [sami],
  }),
  run({
    id: "demo-nadia", agent: "nadia", task: "Sort 3 email threads", trigger: "app",
    steps: [handOff("lina", "Read a scanned PDF", "demo-lina"), model(9200, 820, 0.0100, 2600)],
    children: [lina],
  }),
];

/** One leg of the tour: a comet flies from one node of the map to another while the caption explains it. */
export type Hop = { from: string; to: string; speaker: string; title: string; detail?: string };

const nodeId = (lane: string, tool?: string) =>
  lane === "you" ? "trigger:you" : lane === "app" ? "trigger:app" : lane === "gemini" ? "model:gemini" : lane === "tools" ? `tool:${tool}` : `agent:${lane}`;

/** The tour for some runs: every step as one or two legs across the map, in the order it happened. */
export function buildTour(runs: AgentRun[], team: { get: (id: string) => Agent }): Hop[] {
  const name = (id: string) => team.get(id).name;
  const hops: Hop[] = [];
  for (const root of runs) {
    for (const e of replay(root).events) {
      const from = nodeId(e.from, e.tool), to = nodeId(e.to, e.tool);
      if (e.kind === "start") {
        hops.push({ from, to, speaker: e.to, title: e.from === "you" ? `You ask ${name(e.to)}` : `A Gmail sync wakes ${name(e.to)}`, detail: `"${root.task}"` });
      } else if (e.kind === "model") {
        const figures = e.label.split(" · ").slice(1).join(" · "); // "6.1K in, 40 out · $0.0047"
        hops.push({ from, to, speaker: e.from, title: `${name(e.from)} asks Gemini`, detail: figures || undefined });
        hops.push({ from: to, to: from, speaker: e.from, title: `Gemini answers ${name(e.from)}`, detail: e.sub });
      } else if (e.kind === "tool" && e.tool) {
        const source = toolSource(e.tool);
        hops.push({ from, to, speaker: e.from, title: `${name(e.from)} uses ${toolName(e.tool)}`, detail: e.detail ? `It comes back with ${e.detail}` : undefined });
        hops.push({ from: to, to: `data:${source}`, speaker: e.from, title: `${toolName(e.tool)} works on the ${source.toLowerCase()}` });
      } else if (e.kind === "handoff") {
        hops.push({ from, to, speaker: e.from, title: `${name(e.from)} hands the job to ${name(e.to)}`, detail: e.label.replace(/^Hands over: /, "") });
      } else if (e.kind === "return") {
        hops.push({ from, to, speaker: e.from, title: `${name(e.from)} reports back to ${name(e.to)}`, detail: e.label });
      } else if (e.kind === "end") {
        hops.push({ from, to, speaker: e.from, title: e.to === "you" ? `${name(e.from)} answers you` : `${name(e.from)} saves the results`,
          detail: `${root.tree.calls} Gemini calls · ${tokens(root.tree.inputTokens + root.tree.outputTokens)} tokens · ${usd(root.tree.costUsd)}` });
      }
    }
  }
  return hops;
}
