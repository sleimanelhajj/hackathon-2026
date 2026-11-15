import { createContext, memo, useContext } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "lucide-react";
import { SALES_BREAKDOWN_LABELS } from "../../shared/spec.js";
import type { SalesDashboard, Widget } from "../lib/api";

// Widgets for the Sales board. They read the numbers the Sales page loaded for the chosen period (one request for
// the whole board), so moving, adding or removing widgets never refetches.

/** Thrown when a widget's data isn't there (e.g. on the main board before Gmail or Sales is set up); shown as-is. */
export class MissingDataError extends Error {}

export type SalesData = { d: SalesDashboard; vsLabel: string };
const Ctx = createContext<SalesData | null>(null);
export const SalesDataProvider = Ctx.Provider;
function useSalesData(): SalesData {
  const v = useContext(Ctx);
  if (!v) throw new MissingDataError("No sales yet. Open the Sales page to set up the sales database.");
  return v;
}

const STAGE_LABELS: Record<string, string> = { lead: "Lead", qualified: "Qualified", proposal: "Proposal", negotiation: "Negotiation", won: "Won", lost: "Lost" };
export const money = (n: number, digits = 2) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: digits }).format(n);
const moneyExact = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const count = (n: number) => new Intl.NumberFormat("en-US").format(n);
export const monthLabel = (ym: string, long = false) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(undefined, { month: long ? "long" : "short", year: long ? "numeric" : undefined, timeZone: "UTC" });

// ---- Sales number ----
type KpiProps = { widget: Extract<Widget, { type: "sales-kpi" }> };
export const SalesKpiWidget = memo(function SalesKpiWidget({ widget }: KpiProps) {
  const { d, vsLabel } = useSalesData();
  const k = d.kpis;
  const spec = {
    revenue: { value: money(k.revenue), now: k.revenue, before: k.revenuePrev },
    orders: { value: count(k.orders), now: k.orders, before: k.ordersPrev },
    aov: { value: money(k.aov), now: k.aov, before: k.aovPrev },
    marginPct: { value: `${k.marginPct.toFixed(1)}%`, now: k.marginPct, before: k.marginPctPrev, points: true },
    newCustomers: { value: count(k.newCustomers), now: k.newCustomers, before: k.newCustomersPrev },
    winRate: { value: `${k.winRate.toFixed(0)}%`, now: k.winRate, before: k.winRatePrev, points: true },
    openPipeline: { value: money(k.openPipeline), note: `${k.openDeals} open deals` },
    purchases: { value: money(k.purchases ?? 0), now: k.purchases ?? 0, before: k.purchasesPrev ?? 0 },
  }[widget.metric] as { value: string; now?: number; before?: number; points?: boolean; note?: string };

  let change: { dir: "up" | "down" | "flat"; text: string } | null = null;
  if (spec.now !== undefined && spec.before !== undefined) {
    const diff = spec.points ? spec.now - spec.before : spec.before ? ((spec.now - spec.before) / spec.before) * 100 : 0;
    const dir = Math.abs(diff) < 0.05 ? "flat" : diff > 0 ? "up" : "down";
    const amount = spec.points ? `${Math.abs(diff).toFixed(1)} pts` : `${Math.abs(diff).toFixed(0)}%`;
    change = { dir, text: dir === "flat" ? "No change" : `${dir === "up" ? "Up" : "Down"} ${amount}` };
  }
  const Icon = change?.dir === "up" ? ArrowUpRight : change?.dir === "down" ? ArrowDownRight : Minus;
  return (
    <div className="sales-kpi">
      <span className="kpi-value num">{spec.value}</span>
      {change ? (
        <span className="kpi-change" data-dir={change.dir} title={vsLabel}><Icon size={14} aria-hidden /> {change.text}</span>
      ) : (
        <span className="kpi-change kpi-note">{spec.note}</span>
      )}
    </div>
  );
});

// ---- Revenue by month ----
type TrendProps = { widget: Extract<Widget, { type: "sales-trend" }> };
export const SalesTrendWidget = memo(function SalesTrendWidget(_props: TrendProps) {
  const { d } = useSalesData();
  const data = d.monthly.map((m) => ({ ...m, label: monthLabel(m.month) }));
  const lastYear = d.range.months === 12 ? "Same month last year" : "Previous period";
  return (
    <div className="sales-widget">
      <div className="chart-legend" aria-hidden>
        <span><i className="legend-swatch" data-series="1" /> This period</span>
        <span><i className="legend-swatch" data-series="2" /> {lastYear}</span>
      </div>
      <div className="sales-chart-fill">
        <ResponsiveContainer width="100%" height="100%" debounce={120}>
          <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "var(--text-3)" }} interval="preserveStartEnd" minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} width={56} tick={{ fontSize: 12, fill: "var(--text-3)" }} tickFormatter={(v: number) => money(v, 0)} />
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              contentStyle={{ borderRadius: 10, border: "1px solid var(--glass-edge)", background: "var(--glass-strong)", boxShadow: "var(--shadow-lift)", fontSize: 13 }}
              formatter={(v, name) => [moneyExact(Number(v)), name === "revenue" ? "This period" : lastYear]}
            />
            <Area type="monotone" dataKey="revenue" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.08} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            <Line type="monotone" dataKey="revenueLastYear" stroke="var(--series-2)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Revenue by month</caption>
        <thead><tr><th>Month</th><th>This period</th><th>{lastYear}</th></tr></thead>
        <tbody>{d.monthly.map((m) => <tr key={m.month}><td>{monthLabel(m.month, true)}</td><td>{moneyExact(m.revenue)}</td><td>{moneyExact(m.revenueLastYear)}</td></tr>)}</tbody>
      </table>
    </div>
  );
});

// ---- Bars (category / region / pipeline / reps) ----
type BarRow = { label: string; value: number; text: string; sub?: string; tone?: "good" | "muted" };
function Bars({ rows }: { rows: BarRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="hbars">
      {rows.map((r) => (
        <li key={r.label} className="hbar" title={`${r.label}: ${r.text}${r.sub ? ` (${r.sub})` : ""}`}>
          <span className="hbar-label">{r.label}</span>
          <span className="hbar-track"><span className="hbar-fill" data-tone={r.tone} style={{ width: `${(r.value / max) * 100}%` }} /></span>
          <span className="hbar-value num">{r.text}{r.sub && <span className="hbar-sub"> · {r.sub}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

type BreakdownProps = { widget: Extract<Widget, { type: "sales-breakdown" }> };
export const SalesBreakdownWidget = memo(function SalesBreakdownWidget({ widget }: BreakdownProps) {
  const { d } = useSalesData();
  const rows = widget.by === "region" ? d.byRegion : d.byCategory;
  return (
    <div className="sales-widget">
      <Bars rows={rows.map((r) => ({ label: r.key, value: r.revenue, text: money(r.revenue), sub: `${r.share.toFixed(0)}%` }))} />
      <p className="howto"><Info size={13} aria-hidden /> {SALES_BREAKDOWN_LABELS[widget.by]}, share of total revenue.</p>
    </div>
  );
});

type PipelineProps = { widget: Extract<Widget, { type: "sales-pipeline" }> };
export const SalesPipelineWidget = memo(function SalesPipelineWidget(_props: PipelineProps) {
  const { d } = useSalesData();
  return (
    <div className="sales-widget">
      <Bars rows={d.pipeline.map((p) => ({
        label: STAGE_LABELS[p.stage], value: p.value, text: money(p.value), sub: `${p.count} deals`,
        tone: p.stage === "won" ? "good" : p.stage === "lost" ? "muted" : undefined,
      }))} />
      <p className="howto"><Info size={13} aria-hidden /> Open deals by stage, plus deals won and lost in this period.</p>
    </div>
  );
});

type RepsProps = { widget: Extract<Widget, { type: "sales-reps" }> };
export const SalesRepsWidget = memo(function SalesRepsWidget(_props: RepsProps) {
  const { d } = useSalesData();
  const max = Math.max(1, ...d.reps.map((r) => Math.max(r.revenue, r.target)));
  return (
    <div className="sales-widget">
      <ul className="hbars">
        {d.reps.map((r) => (
          <li key={r.name} className="hbar" title={`${r.name} (${r.region}): ${moneyExact(r.revenue)} of ${moneyExact(r.target)} target, ${r.won} deals won`}>
            <span className="hbar-label">{r.name}<span className="hbar-sub"> · {r.region}</span></span>
            <span className="hbar-track">
              <span className="hbar-fill" data-tone={r.attainment >= 100 ? "good" : undefined} style={{ width: `${(r.revenue / max) * 100}%` }} />
              <span className="hbar-target" style={{ left: `${(r.target / max) * 100}%` }} aria-hidden />
            </span>
            <span className="hbar-value num"><strong>{Math.round(r.attainment)}%</strong><span className="hbar-sub"> · {money(r.revenue)}</span></span>
          </li>
        ))}
      </ul>
      <p className="howto"><Info size={13} aria-hidden /> Revenue against each rep's target for the period. The line marks 100%.</p>
    </div>
  );
});

// ---- Tables ----
type TableProps = { widget: Extract<Widget, { type: "sales-table" }> };
export const SalesTableWidget = memo(function SalesTableWidget({ widget }: TableProps) {
  const { d } = useSalesData();
  if (widget.table === "topProducts")
    return <Table head={["Product", "Category", "Units", "Revenue"]} numeric={[2, 3]} rows={d.topProducts.map((p) => [p.name, p.category, count(p.units), money(p.revenue)])} />;
  if (widget.table === "topCustomers")
    return <Table head={["Customer", "Region", "Orders", "Revenue"]} numeric={[2, 3]} rows={d.topCustomers.map((c) => [c.name, c.region, count(c.orders), money(c.revenue)])} />;
  return (
    <Table head={["Order", "Customer", "Date", "Status", "Total"]} numeric={[4]}
      rows={d.recentOrders.map((o) => [
        o.number, o.customer, new Date(o.orderedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        <span key="s" className="tag tag-sm" data-tone={o.status === "paid" ? "ok" : o.status === "pending" ? "warn" : undefined}>{o.status[0].toUpperCase() + o.status.slice(1)}</span>,
        moneyExact(o.total),
      ])} />
  );
});

function Table({ head, rows, numeric = [] }: { head: string[]; rows: React.ReactNode[][]; numeric?: number[] }) {
  return (
    <div className="sales-table-wrap">
      <table className="sales-table">
        <thead><tr>{head.map((h, i) => <th key={h} className={numeric.includes(i) ? "num-col" : undefined}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j} className={numeric.includes(j) ? "num num-col" : undefined}>{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
