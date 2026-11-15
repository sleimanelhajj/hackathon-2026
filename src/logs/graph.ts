import type { Agent, AgentRun } from "../lib/api";
import { toolName, toolSource } from "./format";

// The agent map (decision #67), built from recorded runs: who starts the agents (you, or the app on its own), which
// agent hands work to which, how often each asks Gemini, which tools they use and where that data lives. Lines that
// only show how the team is wired (a sub-agent link, what an agent is given to read) are kept with a count of 0.

export type MapNode = { id: string; col: 0 | 1 | 2 | 3; kind: "trigger" | "agent" | "model" | "tool" | "data"; label: string; sub?: string; agentId?: string; count: number };
export type MapEdge = { id: string; from: string; to: string; kind: "starts" | "delegates" | "asks" | "uses" | "from" | "reads"; count: number; tokens: number; costUsd: number };
export type AgentMap = { nodes: MapNode[]; edges: MapEdge[] };

/** Every run in the trees, depth first. */
export function flattenRuns(runs: AgentRun[]): AgentRun[] {
  const out: AgentRun[] = [];
  const walk = (r: AgentRun) => { out.push(r); r.children.forEach(walk); };
  runs.forEach(walk);
  return out;
}

export function buildAgentMap(runs: AgentRun[], team: Agent[]): AgentMap {
  const nodes = new Map<string, MapNode>();
  const edges = new Map<string, MapEdge>();
  const node = (n: Omit<MapNode, "count">) => nodes.get(n.id) ?? nodes.set(n.id, { ...n, count: 0 }).get(n.id)!;
  const edge = (from: string, to: string, kind: MapEdge["kind"], count = 1, tokens = 0, costUsd = 0) => {
    const id = `${from}>${to}`;
    const e = edges.get(id) ?? edges.set(id, { id, from, to, kind, count: 0, tokens: 0, costUsd: 0 }).get(id)!;
    e.count += count;
    e.tokens += tokens;
    e.costUsd += costUsd;
  };

  node({ id: "trigger:you", col: 0, kind: "trigger", label: "You", sub: "ask or click" });
  node({ id: "trigger:app", col: 0, kind: "trigger", label: "Automatic", sub: "sync, new files" });
  for (const a of team) node({ id: `agent:${a.id}`, col: 1, kind: "agent", label: a.name, sub: a.role, agentId: a.id });
  node({ id: "model:gemini", col: 2, kind: "model", label: "Gemini", sub: "Google's AI model" });

  const agentNode = (id: string) => node({ id: `agent:${id}`, col: 1, kind: "agent", label: team.find((a) => a.id === id)?.name ?? "Workspace", sub: team.find((a) => a.id === id)?.role ?? "Other AI work", agentId: id });
  const dataNode = (name: string) => node({ id: `data:${name}`, col: 3, kind: "data", label: name });

  for (const run of flattenRuns(runs)) {
    agentNode(run.agent).count += 1;
    if (!run.parentRunId) {
      const trigger = run.trigger === "you" ? "trigger:you" : "trigger:app";
      nodes.get(trigger)!.count += 1;
      edge(trigger, `agent:${run.agent}`, "starts");
    }
    for (const step of run.steps) {
      if (step.kind === "model") {
        nodes.get("model:gemini")!.count += 1;
        edge(`agent:${run.agent}`, "model:gemini", "asks", 1, (step.inputTokens ?? 0) + (step.outputTokens ?? 0), step.costUsd ?? 0);
      } else if (step.kind === "tool") {
        const tool = node({ id: `tool:${step.name}`, col: 2, kind: "tool", label: toolName(step.name) });
        tool.count += 1;
        edge(`agent:${run.agent}`, tool.id, "uses");
        const source = dataNode(toolSource(step.name));
        source.count += 1;
        edge(tool.id, source.id, "from");
      } else if (step.kind === "agent") {
        edge(`agent:${run.agent}`, `agent:${step.name}`, "delegates");
      }
    }
  }

  // How the team is wired, even when it wasn't used in the period.
  for (const a of team) {
    if (a.parent && a.relation === "sub-agent") edge(`agent:${a.parent}`, `agent:${a.id}`, "delegates", 0);
    for (const helped of a.alsoFor ?? []) edge(`agent:${helped}`, `agent:${a.id}`, "delegates", 0);
    for (const source of a.reads) edge(`agent:${a.id}`, dataNode(source).id, "reads", nodes.get(`agent:${a.id}`)?.count ?? 0);
  }

  const order = (n: MapNode) => (n.kind === "model" ? -1 : n.kind === "agent" ? team.findIndex((a) => a.id === n.agentId) : -n.count);
  return {
    nodes: [...nodes.values()].sort((a, b) => a.col - b.col || order(a) - order(b) || a.label.localeCompare(b.label)),
    edges: [...edges.values()],
  };
}
