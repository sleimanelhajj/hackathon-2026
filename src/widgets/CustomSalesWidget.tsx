import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from "lucide-react";
import { CUSTOM_GROUP_LABELS, CUSTOM_METRIC_LABELS, TIME_GROUPS } from "../../shared/spec.js";
import { api, type CustomResult, type Widget } from "../lib/api";
import { errorMessage } from "../lib/errors";

// A widget the assistant's dashboard builder made from a plain request. It stores a typed query, not data: it loads
// its own numbers from Postgres (POST /api/sales/custom) and says exactly what it counts and over which dates.

type Props = { widget: Extract<Widget, { type: "sales-custom" }> };
type Unit = CustomResult["unit"];

const compact = (v: number, unit: Unit) =>
  unit === "USD" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(v)
    : unit === "percent" ? `${v.toFixed(1)}%` : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const exact = (v: number | null, unit: Unit) =>
  v == null ? "–" : unit === "USD" ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v)
    : unit === "percent" ? `${v.toFixed(1)}%` : new Intl.NumberFormat("en-US").format(v);
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** Axis and table labels for time buckets ("2026-09" → "Sep", "2026-09-07" → "Sep 7"). */
const keyLabel = (key: string, groupBy: string) =>
  groupBy === "month" ? new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
    : TIME_GROUPS.includes(groupBy) ? day(key) : key;

function Change({ now, before }: { now: number; before: number | null }) {
  if (before == null || before === 0) return null;
  const pct = ((now - before) / before) * 100;
  const dir = Math.abs(pct) < 0.5 ? "flat" : pct > 0 ? "up" : "down";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  return <span className="kpi-change" data-dir={dir} title="Compared with the period before"><Icon size={14} aria-hidden /> {dir === "flat" ? "No change" : `${dir === "up" ? "Up" : "Down"} ${Math.abs(pct).toFixed(0)}%`}</span>;
}

function DataTable({ title, data, visible }: { title: string; data: CustomResult; visible: boolean }) {
  const metric = CUSTOM_METRIC_LABELS[data.metric as keyof typeof CUSTOM_METRIC_LABELS] ?? "Value";
  return (
    <div className={visible ? "sales-table-wrap" : "sr-only"}>
      <table className="sales-table" aria-label={title}>
        <thead><tr><th scope="col">{CUSTOM_GROUP_LABELS[data.groupBy as keyof typeof CUSTOM_GROUP_LABELS] ?? ""}</th><th scope="col" className="num-col">{metric}</th></tr></thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.key}><td>{keyLabel(r.key, data.groupBy)}</td><td className="num-col num">{exact(r.value, data.unit)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const CustomSalesWidget = memo(function CustomSalesWidget({ widget }: Props) {
  const { data, isLoading, error } = useQuery({ queryKey: ["sales-custom", widget.query], queryFn: () => api.salesCustom(widget.query), staleTime: 60_000 });

  if (isLoading) return <div className="custom-loading" aria-busy="true"><span className="bone" style={{ width: "40%", height: 22 }} /><span className="bone" style={{ flex: 1, height: "auto", minHeight: 60 }} /></div>;
  if (error || !data) return <div className="widget-empty"><p>Couldn't load this widget.</p><p className="widget-empty-rule">{errorMessage(error)}</p></div>;

  const what = data.filters.map((f) => f.replace(/^[^:]+:\s*/, "")).join(", ") || ({ purchases: "All purchases", expenses: "All expenses" } as Record<string, string>)[data.metric] || "All sales";
  // Show the years only when the period crosses one ("Dec 1, 2025 – Nov 14, 2026"), so "Dec 1 – Nov 14" is never ambiguous.
  const crossesYear = data.period.from.slice(0, 4) !== data.period.to.slice(0, 4);
  const when = (iso: string) => (crossesYear ? `${day(iso)}, ${iso.slice(0, 4)}` : day(iso));
  const caption = `${what} · ${when(data.period.from)} – ${when(data.period.to)}`;
  const time = TIME_GROUPS.includes(data.groupBy);
  const empty = widget.chart !== "number" && (!data.rows.length || data.rows.every((r) => !r.value));
  const series = data.rows.map((r) => ({ label: keyLabel(r.key, data.groupBy), value: r.value }));
  const tick = { fontSize: 12, fill: "var(--text-3)" };
  const tooltip = {
    contentStyle: { borderRadius: 10, border: "1px solid var(--glass-edge)", background: "var(--glass-strong)", boxShadow: "var(--shadow-lift)", fontSize: 13 },
    formatter: (v: unknown) => [exact(Number(v), data.unit), CUSTOM_METRIC_LABELS[data.metric as keyof typeof CUSTOM_METRIC_LABELS] ?? ""] as [string, string],
  };

  return (
    <div className="sales-widget custom-widget" data-chart={widget.chart}>
      {widget.chart === "number" ? (
        <div className="sales-kpi custom-number">
          <span className="kpi-value num">{compact(data.total, data.unit)}</span>
          <Change now={data.total} before={data.previousTotal} />
        </div>
      ) : empty ? (
        <div className="widget-empty"><p>No sales match this in the period.</p></div>
      ) : widget.chart === "table" ? (
        <DataTable title={widget.title} data={data} visible />
      ) : (
        <>
          <div className="sales-chart-fill">
            <ResponsiveContainer width="100%" height="100%" debounce={120}>
              {widget.chart === "line" ? (
                <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} interval="preserveStartEnd" minTickGap={14} />
                  <YAxis tickLine={false} axisLine={false} width={54} tick={tick} tickFormatter={(v: number) => compact(v, data.unit)} />
                  <Tooltip cursor={{ stroke: "var(--border-strong)" }} {...tooltip} />
                  <Line type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} dot={series.length <= 14 ? { r: 3, fill: "var(--series-1)" } : false} activeDot={{ r: 4 }} connectNulls isAnimationActive={false} />
                </LineChart>
              ) : time ? (
                <BarChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} interval="preserveStartEnd" minTickGap={14} />
                  <YAxis tickLine={false} axisLine={false} width={54} tick={tick} tickFormatter={(v: number) => compact(v, data.unit)} />
                  <Tooltip cursor={{ fill: "var(--subtle)" }} {...tooltip} />
                  <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
                </BarChart>
              ) : (
                <BarChart data={series} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" tickLine={false} axisLine={false} tick={tick} tickFormatter={(v: number) => compact(v, data.unit)} />
                  <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} width={128} tick={{ ...tick, fill: "var(--text-2)" }} interval={0}
                    tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)} />
                  <Tooltip cursor={{ fill: "var(--subtle)" }} {...tooltip} />
                  <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={22} isAnimationActive={false} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          <DataTable title={widget.title} data={data} visible={false} />
        </>
      )}
      <p className="custom-caption">
        <span>{caption}</span>
        {widget.chart === "number" ? (
          // Small cards: the icon alone, so the caption fits on one line (the words stay for screen readers and on hover).
          <span className="custom-by" title="Made by the assistant"><Sparkles size={12} aria-hidden /><span className="sr-only">Made by the assistant</span></span>
        ) : (
          <span className="custom-by"><Sparkles size={12} aria-hidden /> Made by the assistant</span>
        )}
      </p>
      {widget.note && <p className="sr-only">{widget.note}</p>}
    </div>
  );
});
