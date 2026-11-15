import type { CSSProperties } from "react";
import { Clock3, CornerLeftUp } from "lucide-react";
import type { Agent, LogUsage } from "../lib/api";
import { AgentAvatar, useAgents } from "../agents/agents";
import { AgentFace } from "../agents/faces";
import { usd } from "./format";

// The AI team (decision #67), as layers instead of a wide tree so it fits any width: the lead on top, then the agents
// under her, then the agents under those. Each layer says whom it works for, each card says who is directly above the
// agent and how (a sub-agent is called by the agent above; a team member works on its own under the lead).

type Stats = { calls: number; costUsd: number };

export function AgentTeam({ usage }: { usage: LogUsage | undefined }) {
  const team = useAgents();
  const lead = team.list.find((a) => !a.parent);
  if (!lead) return null;
  const stats = new Map(usage?.byAgent.map((r) => [r.agent, r]) ?? []);

  // Layers by depth under the lead.
  const layers: Agent[][] = [[lead]];
  for (let depth = 0; depth < 6; depth++) {
    const above = new Set(layers[depth].map((a) => a.id));
    const next = team.list.filter((a) => a.parent && above.has(a.parent));
    if (!next.length) break;
    layers.push(next);
  }

  return (
    <ul className="team" aria-label="The AI team, lead at the top">
      {layers.map((layer, depth) => {
        const parents = [...new Set(layer.map((a) => a.parent).filter(Boolean) as string[])].map((id) => team.get(id).name);
        return (
          <li key={depth} className="team-layer" data-depth={depth}>
            {depth > 0 ? <span className="team-link" aria-hidden /> : null}
            <p className="team-layer-label">{depth === 0 ? "Lead" : `Works for ${parents.join(" and ")}`}</p>
            <ul className="team-cards" data-single={layer.length === 1 || undefined} style={{ "--count": layer.length } as CSSProperties}>
              {layer.map((agent) => (
                <li key={agent.id}>
                  <AgentCard agent={agent} stats={stats.get(agent.id)} above={agent.parent ? team.get(agent.parent) : null}
                    helps={(agent.alsoFor ?? []).map((id) => team.get(id).name)} lead={depth === 0} />
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function AgentCard({ agent, stats, above, helps, lead }: { agent: Agent; stats?: Stats; above: Agent | null; helps: string[]; lead: boolean }) {
  const relation = !above ? "Lead" : agent.relation === "sub-agent" ? `Sub-agent of ${above.name}` : `Works for ${above.name}`;
  return (
    <article className="team-card" data-lead={lead || undefined} aria-label={`${agent.name}, ${agent.role}`}>
      <header className="team-card-head">
        <AgentAvatar agent={agent} size={lead ? 60 : 48} />
        <div className="team-card-who">
          <h3>{agent.name}</h3>
          <p>{agent.role}</p>
        </div>
      </header>

      <p className="team-relation">
        <span className="tag tag-sm" data-tone={!above ? "ok" : agent.relation === "sub-agent" ? "inferred" : "accent"}>{relation}</span>
        {above ? (
          <span className="team-above" title={agent.relation === "sub-agent" ? `${above.name} calls ${agent.name} directly` : `${agent.name} works on their own, under ${above.name}`}>
            <CornerLeftUp size={12} aria-hidden />
            <AgentFace id={above.id} size={18} />
            {above.name}
          </span>
        ) : null}
      </p>

      <p className="team-does">{agent.does}</p>
      {helps.length ? <p className="team-helps">Also helps {helps.join(", ")}</p> : null}

      <footer className="team-card-foot">
        <span className="team-runs"><Clock3 size={12} aria-hidden /> {agent.runs}</span>
        <span className="team-stats num" data-idle={!stats || undefined}>{stats ? `${stats.calls} call${stats.calls === 1 ? "" : "s"} · ${usd(stats.costUsd)}` : "No work in this period"}</span>
      </footer>
    </article>
  );
}
