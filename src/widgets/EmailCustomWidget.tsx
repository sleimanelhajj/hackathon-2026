import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Sparkles } from "lucide-react";
import { EMAIL_METRIC_LABELS } from "../../shared/spec.js";
import { api, type Widget } from "../lib/api";

// A custom email chart the assistant made (decision #60). Like the sales one, it stores a typed query, not data, and
// loads its numbers from the synced mail (POST /api/email/custom), saying what it counts and over which days.

type Props = { widget: Extract<Widget, { type: "email-custom" }> };
const GROUP_LABEL: Record<string, string> = { sender: "Sender", company: "Company", category: "Topic", priority: "Priority", direction: "Direction", day: "Day", week: "Week of" };
const count = (v: number) => new Intl.NumberFormat("en-US").format(v);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** What the chart counts, in words: "Received emails, urgent, from haddad · last 30 days". */
function caption(q: Props["widget"]["query"]) {
  const f = q.filters ?? {};
  const bits = [
    f.direction === "in" ? "received" : f.direction === "out" ? "sent" : null,
    f.priorities?.length ? f.priorities.join("/") + " priority" : null,
    f.categories?.length ? f.categories.join(", ") : null,
    f.needsReply === true ? "waiting on a reply" : f.needsReply === false ? "not waiting on a reply" : null,
    f.withAttachments ? "with attachments" : null,
    f.from ? `from “${f.from}”` : null,
  ].filter(Boolean);
  return `${EMAIL_METRIC_LABELS[q.metric]}${bits.length ? `, ${bits.join(", ")}` : ""} · last ${q.days ?? 30} days`;
}

export const EmailCustomWidget = memo(function EmailCustomWidget({ widget }: Props) {
  const { data, isLoading, error } = useQuery({ queryKey: ["email-custom", widget.query], queryFn: () => api.emailCustom(widget.query), staleTime: 60_000 });
  if (isLoading) return <div className="custom-loading" aria-busy="true"><span className="bone" style={{ width: "40%", height: 22 }} /><span className="bone" style={{ flex: 1, height: "auto", minHeight: 60 }} /></div>;
  if (error || !data) return <div className="widget-empty"><p>Couldn't load this widget.</p><p className="widget-empty-rule">{(error as Error)?.message}</p></div>;

  const time = widget.query.groupBy === "day" || widget.query.groupBy === "week";
  const series = data.rows.map((r) => ({ label: time ? day(r.key) : r.key, value: r.value }));
  const empty = widget.chart !== "number" && (!data.rows.length || data.rows.every((r) => !r.value));
  const tick = { fontSize: 12, fill: "var(--text-3)" };
  const tooltip = {
    contentStyle: { borderRadius: 10, border: "1px solid var(--glass-edge)", background: "var(--glass-strong)", boxShadow: "var(--shadow-lift)", fontSize: 13 },
    formatter: (v: unknown) => [count(Number(v)), EMAIL_METRIC_LABELS[widget.query.metric]] as [string, string],
  };
  return (
    <div className="sales-widget custom-widget" data-chart={widget.chart}>
      {widget.chart === "number" ? (
        <div className="sales-kpi custom-number"><span className="kpi-value num">{count(data.total)}</span></div>
      ) : empty ? (
        <div className="widget-empty"><p>No emails match this in the period.</p></div>
      ) : widget.chart === "table" ? (
        <div className="sales-table-wrap">
          <table className="sales-table" aria-label={widget.title}>
            <thead><tr><th scope="col">{GROUP_LABEL[widget.query.groupBy] ?? ""}</th><th scope="col" className="num-col">{EMAIL_METRIC_LABELS[widget.query.metric]}</th></tr></thead>
            <tbody>{series.map((r) => <tr key={r.label}><td>{r.label}</td><td className="num num-col">{count(r.value)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="sales-chart-fill">
          <ResponsiveContainer width="100%" height="100%" debounce={120}>
            {widget.chart === "line" ? (
              <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} interval="preserveStartEnd" minTickGap={14} />
                <YAxis tickLine={false} axisLine={false} width={40} tick={tick} allowDecimals={false} />
                <Tooltip cursor={{ stroke: "var(--border-strong)" }} {...tooltip} />
                <Line type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} dot={series.length <= 14 ? { r: 3, fill: "var(--series-1)" } : false} isAnimationActive={false} />
              </LineChart>
            ) : time ? (
              <BarChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} interval="preserveStartEnd" minTickGap={14} />
                <YAxis tickLine={false} axisLine={false} width={40} tick={tick} allowDecimals={false} />
                <Tooltip cursor={{ fill: "var(--subtle)" }} {...tooltip} />
                <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            ) : (
              <BarChart data={series} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid horizontal={false} stroke="var(--border)" />
                <XAxis type="number" tickLine={false} axisLine={false} tick={tick} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={128} tick={{ ...tick, fill: "var(--text-2)" }} interval={0}
                  tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
                <Tooltip cursor={{ fill: "var(--subtle)" }} {...tooltip} />
                <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      <p className="custom-caption"><Sparkles size={12} aria-hidden /> {caption(widget.query)}</p>
    </div>
  );
});
