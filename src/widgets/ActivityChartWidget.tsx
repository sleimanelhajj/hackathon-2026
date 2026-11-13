// Loaded lazily: recharts is the heaviest dependency, so it ships in its own chunk.
import { memo, useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";

type Props = { widget: Extract<Widget, { type: "activity-chart" }> };

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const AXIS_TICK = { fontSize: 11, fill: "#6f6f82" };
const TOOLTIP_STYLE = { borderRadius: 8, border: "1px solid #e4e4ea", boxShadow: "0 4px 12px rgba(22,22,29,.08)", fontSize: 12.5 };

const ActivityChartWidget = memo(function ActivityChartWidget({ widget }: Props) {
  const { activity } = useDashboardData();
  const rows = useMemo(() => activity.slice(-widget.days), [activity, widget.days]);
  const total = rows.reduce((s, d) => s + d.received + d.sent, 0);

  return (
    <div className="chart-widget">
      <div className="legend">
        <span><i style={{ background: "var(--chart-in)" }} aria-hidden />Received</span>
        <span><i style={{ background: "var(--chart-out)" }} aria-hidden />Sent</span>
        <span className="legend-total num">{total} emails · last {widget.days} days</span>
      </div>
      <div className="chart-area" role="img" aria-label={`Bar chart of emails received and sent per day over the last ${widget.days} days`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} barGap={2} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#ececf1" />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: "#f1f1f5" }} labelFormatter={(v) => shortDate(String(v))} contentStyle={TOOLTIP_STYLE} />
            <Bar dataKey="received" name="Received" fill="var(--chart-in)" radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            <Bar dataKey="sent" name="Sent" fill="var(--chart-out)" radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

export default ActivityChartWidget;
