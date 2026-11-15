import { memo, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import type { LogUsage } from "../lib/api";
import { AgentAvatar, AgentLabel, useAgents } from "../agents/agents";
import { duration, tokens, usd, when } from "./format";

// The Costs section of Logs (decision #67): what the AI work cost, by agent, by model, by day, and every recent call,
// all from Google's token counts and list prices. Nothing an email or chat says appears here.

const AXIS_TICK = { fontSize: 11, fill: "var(--text-3)" };
const TOOLTIP_STYLE = { borderRadius: 8, border: "1px solid var(--glass-edge)", background: "var(--glass-strong)", backdropFilter: "var(--blur)", WebkitBackdropFilter: "var(--blur)", boxShadow: "var(--shadow-lift)", fontSize: 12.5 };
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const priceDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

export function CostsView({ usage }: { usage: LogUsage }) {
  const { totals, byAgent, byModel, byDay, calls, prices } = usage;
  return (
    <div className="logs-stack">
      <section className="surface stats logs-stats" aria-label="Totals">
        <div className="stat"><span className="stat-label">AI cost</span><span className="stat-value num">{usd(totals.costUsd)}</span><span className="stat-note">last {usage.period.days} days</span></div>
        <div className="stat"><span className="stat-label">Gemini calls</span><span className="stat-value num">{totals.calls.toLocaleString()}</span><span className="stat-note">{totals.failed ? `${totals.failed} failed (no cost)` : "all answered"}</span></div>
        <div className="stat"><span className="stat-label">Input tokens</span><span className="stat-value num">{tokens(totals.inputTokens)}</span><span className="stat-note">what the agents sent</span></div>
        <div className="stat"><span className="stat-label">Output tokens</span><span className="stat-value num">{tokens(totals.outputTokens)}</span><span className="stat-note">{totals.thinkingTokens ? `incl. ${tokens(totals.thinkingTokens)} thinking` : "the answers"}</span></div>
      </section>

      <section className="surface logs-card" aria-labelledby="cost-by-day">
        <header className="logs-card-head">
          <h2 id="cost-by-day">Cost per day</h2>
          <span className="muted small num">{usd(totals.costUsd)} in {usage.period.days} days</span>
        </header>
        <CostChart rows={byDay} />
      </section>

      <div className="logs-two">
        <section className="surface logs-card" aria-labelledby="cost-by-agent">
          <header className="logs-card-head"><h2 id="cost-by-agent">By agent</h2></header>
          <ByAgent rows={byAgent} total={totals.costUsd} />
        </section>
        <section className="surface logs-card" aria-labelledby="cost-by-model">
          <header className="logs-card-head"><h2 id="cost-by-model">By model</h2></header>
          <ul className="logs-models">
            {byModel.map((m) => {
              const price = prices.models.find((p) => m.model.includes(p.model) && !p.until) ?? prices.models.find((p) => m.model.includes(p.model));
              return (
                <li key={m.model}>
                  <div className="logs-model-name"><span className="code">{m.model}</span>{m.unpriced ? <span className="tag tag-sm" data-tone="warn">price unknown</span> : null}</div>
                  <div className="logs-model-figs num"><span>{m.calls} calls</span><span>{tokens(m.inputTokens)} in · {tokens(m.outputTokens)} out</span><strong>{usd(m.costUsd)}</strong></div>
                  {price ? <p className="muted small">{usd(price.inputPerMillion)} in / {usd(price.outputPerMillion)} out per 1M tokens · {price.note}</p> : null}
                </li>
              );
            })}
          </ul>
          <p className="logs-source">
            Google's list prices for the paid tier, checked {priceDate(prices.checked)}.{" "}
            <a href={prices.source} target="_blank" rel="noreferrer">Pricing page <ExternalLink size={12} aria-hidden /></a>
            {" "}On the free tier Google charges nothing.
          </p>
        </section>
      </div>

      <section className="surface logs-card" aria-labelledby="recent-calls">
        <header className="logs-card-head">
          <h2 id="recent-calls">Every call</h2>
          <span className="muted small">{calls.length < totals.calls ? `latest ${calls.length} of ${totals.calls}` : `${calls.length} in this period`}</span>
        </header>
        <CallTable calls={calls} />
      </section>
    </div>
  );
}

const CostChart = memo(function CostChart({ rows }: { rows: LogUsage["byDay"] }) {
  const peak = useMemo(() => rows.reduce((m, r) => Math.max(m, r.costUsd), 0), [rows]);
  return (
    <div className="logs-chart" role="img" aria-label={`Bar chart of AI cost per day; the highest day cost ${usd(peak)}`}>
      <ResponsiveContainer width="100%" height="100%" debounce={120}>
        <BarChart data={rows} margin={{ top: 6, right: 6, left: 6, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tickFormatter={(v: number) => usd(v)} tick={AXIS_TICK} tickLine={false} axisLine={false} width={64} />
          <Tooltip cursor={{ fill: "var(--subtle)" }} contentStyle={TOOLTIP_STYLE} labelFormatter={(v) => shortDate(String(v))}
            formatter={(value, _name, item) => [`${usd(Number(value))} · ${(item.payload as { calls: number }).calls} calls`, "Cost"]} />
          <Bar dataKey="costUsd" name="Cost" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

function ByAgent({ rows, total }: { rows: LogUsage["byAgent"]; total: number }) {
  const team = useAgents();
  if (!rows.length) return <p className="muted small">No calls in this period.</p>;
  return (
    <ul className="logs-agents">
      {rows.map((r) => {
        const agent = team.get(r.agent);
        const share = total ? r.costUsd / total : 0;
        return (
          <li key={r.agent}>
            <AgentLabel agent={agent} />
            <div className="logs-agent-figs num">
              <strong>{usd(r.costUsd)}</strong>
              <span className="muted small">{r.calls} call{r.calls === 1 ? "" : "s"} · {tokens(r.inputTokens + r.outputTokens)} tokens</span>
            </div>
            <span className="logs-share" aria-label={`${Math.round(share * 100)}% of the cost`}><i style={{ width: `${Math.max(2, share * 100)}%` }} /></span>
          </li>
        );
      })}
    </ul>
  );
}

function CallTable({ calls }: { calls: LogUsage["calls"] }) {
  const team = useAgents();
  if (!calls.length) return <p className="muted small">No calls in this period.</p>;
  return (
    <div className="data-table-wrap">
      <table className="data-table logs-table">
        <thead>
          <tr><th style={{ width: 120 }}>When</th><th style={{ width: 150 }}>Agent</th><th>Task</th><th style={{ width: 170 }}>Model</th><th className="num-col" style={{ width: 80 }}>In</th><th className="num-col" style={{ width: 80 }}>Out</th><th className="num-col" style={{ width: 90 }}>Cost</th><th className="num-col" style={{ width: 80 }}>Time</th></tr>
        </thead>
        <tbody>
          {calls.map((c, i) => {
            const agent = team.get(c.agent);
            return (
              <tr key={`${c.runId}-${i}`} data-failed={!c.ok || undefined}>
                <td className="num">{when(c.at)}</td>
                <td><span className="logs-cell-agent"><AgentAvatar agent={agent} size={22} badge={false} decorative />{agent.name}</span></td>
                <td className="logs-task" title={c.task}>
                  {c.task}
                  {!c.ok ? <span className="logs-failed"><AlertTriangle size={12} aria-hidden /> {c.error ?? "Failed"}</span> : null}
                </td>
                <td><span className="code">{c.model}</span>{c.fellBack ? <span className="tag tag-sm" title="The main model was busy; the backup model answered"><RefreshCw size={10} aria-hidden /> backup</span> : null}</td>
                <td className="num-col num">{tokens(c.inputTokens)}</td>
                <td className="num-col num">{tokens(c.outputTokens)}</td>
                <td className="num-col num">{c.ok ? (c.priced ? usd(c.costUsd) : "unknown") : "—"}</td>
                <td className="num-col num">{duration(c.durationMs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
