import { type CSSProperties } from "react";
import { AlertTriangle, CheckCircle2, Database, MousePointerClick, RefreshCw, Sparkles, Timer } from "lucide-react";
import type { Agent, AgentRun } from "../lib/api";
import { AgentAvatar, useAgents } from "../agents/agents";
import { duration, tokens, toolName, usd, when } from "./format";

// Replays one task step by step (decision #67) as a sequence diagram: a lane for whoever started it, one per agent
// involved, one for Gemini and one for the tools; each step is an arrow between two lanes, in the order it happened.

type Lane = { id: string; label: string; sub: string; agent?: Agent; kind: "trigger" | "agent" | "model" | "tools" };
export type ReplayEvent = { from: string; to: string; kind: "start" | "model" | "tool" | "handoff" | "return" | "end"; label: string; sub?: string; ok: boolean; back?: boolean; tool?: string; detail?: string };

/** The lanes and arrows of a run tree, in the order things happened. */
export function replay(root: AgentRun): { lanes: { id: string; kind: Lane["kind"] }[]; events: ReplayEvent[] } {
  const trigger = root.trigger === "you" ? "you" : "app";
  const agents: string[] = [];
  const events: ReplayEvent[] = [{ from: trigger, to: root.agent, kind: "start", label: root.task || "Start", ok: true }];
  const walk = (run: AgentRun) => {
    if (!agents.includes(run.agent)) agents.push(run.agent);
    for (const step of run.steps) {
      if (step.kind === "model") {
        events.push({
          from: run.agent, to: "gemini", kind: "model", ok: step.ok,
          label: step.ok ? `Asks Gemini · ${tokens(step.inputTokens ?? 0)} in, ${tokens(step.outputTokens ?? 0)} out · ${step.priced === false ? "price unknown" : usd(step.costUsd ?? 0)}` : `Gemini failed: ${step.error ?? "no answer"}`,
          sub: `${step.model}${step.fellBack ? " (backup model, the main one was busy)" : ""} · ${duration(step.durationMs)}`,
        });
      } else if (step.kind === "tool") {
        events.push({ from: run.agent, to: "tools", kind: "tool", ok: step.ok, tool: step.name, detail: step.detail, label: `${toolName(step.name)} → ${step.detail ?? "done"}`, sub: step.args ? `${step.args} · ${duration(step.durationMs)}` : duration(step.durationMs) });
      } else if (step.kind === "agent") {
        const child = run.children.find((c) => c.id === step.childRunId);
        events.push({ from: run.agent, to: step.name, kind: "handoff", ok: true, label: `Hands over: ${step.task ?? ""}` });
        if (child) {
          walk(child);
          events.push({ from: child.agent, to: run.agent, kind: "return", back: true, ok: child.ok,
            label: child.ok ? `Done · ${usd(child.tree.costUsd)}` : `Couldn't finish: ${child.error ?? ""}`, sub: duration(child.durationMs) });
        } else if (!agents.includes(step.name)) agents.push(step.name);
      }
    }
  };
  walk(root);
  events.push({ from: root.agent, to: trigger, kind: "end", back: true, ok: root.ok,
    label: root.ok ? `Finished in ${duration(root.durationMs)}` : `Failed: ${root.error ?? ""}`, sub: `${root.tree.calls} Gemini call${root.tree.calls === 1 ? "" : "s"} · ${usd(root.tree.costUsd)}` });
  const used = new Set(events.flatMap((e) => [e.from, e.to]));
  const lanes = [
    { id: trigger, kind: "trigger" as const },
    ...agents.map((id) => ({ id, kind: "agent" as const })),
    ...(used.has("gemini") ? [{ id: "gemini", kind: "model" as const }] : []),
    ...(used.has("tools") ? [{ id: "tools", kind: "tools" as const }] : []),
  ];
  return { lanes, events };
}

export function RunReplay({ run }: { run: AgentRun }) {
  const team = useAgents();
  const { lanes: laneIds, events } = replay(run);
  const lanes: Lane[] = laneIds.map(({ id, kind }) => (
    kind === "agent" ? { id, kind, agent: team.get(id), label: team.get(id).name, sub: team.get(id).role }
      : kind === "trigger" ? { id, kind, label: id === "you" ? "You" : "Automatic", sub: id === "you" ? "asked or clicked" : "the app started it" }
      : kind === "model" ? { id, kind, label: "Gemini", sub: "AI model" }
      : { id, kind, label: "Tools & data", sub: "database, dashboards, files" }
  ));
  const at = (id: string) => lanes.findIndex((l) => l.id === id);
  const center = (i: number) => `${((i + 0.5) / lanes.length) * 100}%`;

  return (
    <div className="replay" style={{ "--lanes": lanes.length } as CSSProperties}>
      <div className="replay-head">
        {lanes.map((l) => (
          <div key={l.id} className="replay-lane-head">
            {l.agent ? <AgentAvatar agent={l.agent} size={34} /> : (
              <span className="replay-lane-icon" data-kind={l.kind} aria-hidden>
                {l.kind === "trigger" ? (l.id === "you" ? <MousePointerClick size={16} /> : <Timer size={16} />) : l.kind === "model" ? <Sparkles size={16} /> : <Database size={16} />}
              </span>
            )}
            <strong>{l.label}</strong>
            <span>{l.sub}</span>
          </div>
        ))}
      </div>
      <ol className="replay-body" aria-label={`Step by step: ${run.task}`}>
        {lanes.map((l, i) => <li key={`line-${l.id}`} className="replay-lifeline" aria-hidden style={{ left: center(i) }} />)}
        {events.map((e, i) => {
          const a = at(e.from), b = at(e.to);
          const left = Math.min(a, b), right = Math.max(a, b);
          return (
            <li key={i} className="replay-event" data-kind={e.kind} data-failed={!e.ok || undefined}>
              <span className="replay-arrow" data-back={b < a || undefined}
                style={{ left: center(left), width: `${((right - left) / lanes.length) * 100}%` }} aria-hidden />
              <span className="replay-label" style={{ left: `${((left + right + 1) / 2 / lanes.length) * 100}%` }} title={e.sub ? `${e.label}\n${e.sub}` : e.label}>
                <span className="replay-text">
                  {!e.ok ? <AlertTriangle size={12} aria-hidden /> : e.kind === "end" ? <CheckCircle2 size={12} aria-hidden /> : e.sub?.includes("backup") ? <RefreshCw size={12} aria-hidden /> : null}
                  <span className="sr-only">{lanes[a]?.label} to {lanes[b]?.label}: </span>{e.label}
                </span>
                {e.sub ? <span className="replay-sub">{e.sub}</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="replay-foot muted small">Started {when(run.startedAt)} · {run.tree.steps} step{run.tree.steps === 1 ? "" : "s"} · {tokens(run.tree.inputTokens)} tokens in, {tokens(run.tree.outputTokens)} out · {usd(run.tree.costUsd)}{run.truncated ? " · long run, the first 300 steps are shown" : ""}</p>
    </div>
  );
}
