import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Network, Plug, RefreshCw, Workflow } from "lucide-react";
import { api, timeAgo, type AgentRun } from "../lib/api";
import { Callout } from "../components/ui";
import { Select } from "../components/Select";
import { TableSkeleton } from "../components/Skeletons";
import { errorMessage } from "../lib/errors";
import { AgentAvatar, useAgents } from "../agents/agents";
import { CostsView } from "../logs/CostsView";
import { AgentTeam } from "../logs/AgentTeam";
import { AgentMap } from "../logs/AgentMap";
import { RunReplay } from "../logs/RunReplay";
import { usd } from "../logs/format";

// Logs (decision #67): what the AI agents did and what it cost. Two views: Costs (tokens and dollars for every Gemini
// call) and How the agents work (the team, a map of who calls what, and a step-by-step replay of each task).

const PERIODS = [
  { value: "1", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];
type View = "costs" | "work";

export default function LogsPage() {
  const [days, setDays] = useState(30);
  const [view, setView] = useState<View>("costs");
  const team = useAgents();
  const usage = useQuery({ queryKey: ["log-usage", days], queryFn: () => api.logUsage(days), refetchInterval: 30_000 });
  const runs = useQuery({ queryKey: ["log-runs", days], queryFn: () => api.logRuns(days, 40), refetchInterval: 30_000 });
  const top = usage.data?.byAgent[0];
  const share = top && usage.data?.totals.costUsd ? Math.round((top.costUsd / usage.data.totals.costUsd) * 100) : 0;
  const refreshing = usage.isFetching || runs.isFetching;

  return (
    <div className="page page-wide">
      <header className="page-head">
        <div>
          <h1 className="page-title">Logs</h1>
          <p className="page-sub">What the AI agents did and what it cost{usage.dataUpdatedAt ? ` · updated ${timeAgo(new Date(usage.dataUpdatedAt).toISOString())}` : ""}</p>
        </div>
        <div className="page-actions">
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "costs"} onClick={() => setView("costs")}><Activity size={14} aria-hidden /> Costs</button>
            <button type="button" aria-pressed={view === "work"} onClick={() => setView("work")}><Network size={14} aria-hidden /> How the agents work</button>
          </div>
          <Select label="Period" value={String(days)} onChange={(v) => setDays(Number(v))} options={PERIODS} />
          <button type="button" className="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => { void usage.refetch(); void runs.refetch(); }} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? "spin" : undefined} aria-hidden />
          </button>
        </div>
      </header>

      {usage.error ? <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load the logs" text={errorMessage(usage.error)} /> : null}
      {usage.isLoading ? <TableSkeleton rows={6} label="Loading the logs" /> : null}

      {usage.data && usage.data.totals.calls === 0 ? (
        <Callout icon={<Workflow size={18} />} title={`No AI work in the ${days === 1 ? "last day" : `last ${days} days`}`}
          text="Costs and steps show here as soon as an agent uses Gemini: after a Gmail sync, when you ask Layla, or when you open a Telegram chat."
          action={<a className="btn btn-primary" href="#/integrations"><Plug size={15} aria-hidden /> Sync Gmail</a>} />
      ) : top && usage.data ? (
        <Callout icon={<AgentAvatar agent={team.get(top.agent)} size={30} badge={false} decorative />}
          title={`${team.get(top.agent).name} accounts for ${share}% of the AI cost`}
          text={`${usd(usage.data.totals.costUsd)} in total over ${days === 1 ? "the last day" : `the last ${days} days`}, ${usage.data.totals.calls} Gemini calls. ${team.get(top.agent).name} (${team.get(top.agent).role.toLowerCase()}) ${team.get(top.agent).runs.toLowerCase()}.`}
          action={view === "costs"
            ? <button type="button" className="btn btn-primary" onClick={() => setView("work")}><Network size={15} aria-hidden /> See how the agents work</button>
            : <button type="button" className="btn btn-primary" onClick={() => setView("costs")}><Activity size={15} aria-hidden /> See the costs</button>} />
      ) : null}

      {usage.data && view === "costs" ? <CostsView usage={usage.data} /> : null}
      {view === "work" ? <WorkView runs={runs.data?.runs} loading={runs.isLoading} error={runs.error} days={days} usage={usage.data} /> : null}
    </div>
  );
}

function WorkView({ runs, loading, error, days, usage }: { runs?: AgentRun[]; loading: boolean; error: unknown; days: number; usage: Parameters<typeof AgentTeam>[0]["usage"] }) {
  const team = useAgents();
  const [picked, setPicked] = useState<string | null>(null);
  const selected = useMemo(() => runs?.find((r) => r.id === picked) ?? runs?.[0] ?? null, [runs, picked]);

  return (
    <div className="logs-stack">
      <section className="surface logs-card" aria-labelledby="team-title">
        <header className="logs-card-head">
          <h2 id="team-title">The AI team</h2>
          <span className="muted small">Layla leads. A sub-agent is called by the agent above it; the others work on their own when the app needs them.</span>
        </header>
        <AgentTeam usage={usage} />
      </section>

      <section className="surface logs-card" aria-labelledby="map-title">
        <header className="logs-card-head">
          <h2 id="map-title">Agent map</h2>
          <span className="muted small">Gemini is the sun, the agents orbit it, tools are moons and the data lives on the ringed planets. Press Play demo to follow a task across the map.</span>
        </header>
        {error ? <p className="field-error" role="alert">{errorMessage(error)}</p> : null}
        {loading ? <TableSkeleton rows={4} label="Loading the map" /> : null}
        {runs ? <AgentMap runs={runs} team={team.list} days={days} /> : null}
      </section>

      <section className="surface logs-card" aria-labelledby="runs-title">
        <header className="logs-card-head">
          <h2 id="runs-title">Step by step</h2>
          <span className="muted small">Pick a task to replay how the agents went back and forth.</span>
        </header>
        {runs && runs.length === 0 ? <p className="muted">No tasks in this period yet.</p> : null}
        {runs && runs.length > 0 ? (
          <div className="logs-runs">
            <ul className="logs-run-list" aria-label="Recent tasks">
              {runs.map((r) => {
                const agent = team.get(r.agent);
                return (
                  <li key={r.id}>
                    <button type="button" className="logs-run" aria-current={selected?.id === r.id || undefined} onClick={() => setPicked(r.id)}>
                      <AgentAvatar agent={agent} size={30} badge={false} decorative />
                      <span className="logs-run-text">
                        <span className="logs-run-task">{r.task || agent.role}</span>
                        <span className="logs-run-meta">
                          {agent.name}{r.children.length ? ` + ${[...new Set(r.children.map((c) => team.get(c.agent).name))].join(", ")}` : ""} · {timeAgo(r.startedAt)} · {usd(r.tree.costUsd)}
                        </span>
                      </span>
                      {!r.ok ? <AlertTriangle size={14} className="logs-run-failed" aria-label="Failed" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            {selected ? <RunReplay run={selected} /> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
