import { memo } from "react";
import { Info } from "lucide-react";
import { BREAKDOWN_RULES } from "../../shared/spec.js";
import type { Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";

type Props = { widget: Extract<Widget, { type: "breakdown" }> };

const hourLabel = (h: number) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

/** Ranked bars for a breakdown rule; "busiestHours" renders as a 24-column day profile instead. */
export const BreakdownWidget = memo(function BreakdownWidget({ widget }: Props) {
  const rows = useDashboardData().breakdowns?.[widget.rule] ?? [];
  const meta = BREAKDOWN_RULES[widget.rule];
  const max = Math.max(1, ...rows.map((r) => r.value));

  if (widget.rule === "busiestHours") {
    const peak = rows.reduce((best, r) => (r.value > best.value ? r : best), rows[0] ?? { key: "0", label: "", value: 0 });
    return (
      <div className="hours-widget">
        <div className="hours" role="img" aria-label={`Emails by hour of day. Busiest hour: ${peak.value ? peak.label : "none"}.`}>
          {rows.map((r) => (
            <div key={r.key} className="hour" title={`${r.label}: ${r.value}`}>
              <div className="hour-bar" style={{ height: `${(r.value / max) * 100}%` }} data-peak={r.key === peak.key && r.value > 0} />
            </div>
          ))}
        </div>
        <div className="hours-axis" aria-hidden>
          {[0, 6, 12, 18, 23].map((h) => <span key={h} style={{ left: `${(h / 23) * 100}%` }}>{hourLabel(h)}</span>)}
        </div>
        <p className="howto"><Info size={13} aria-hidden /> {meta.how}{peak.value ? ` Busiest: ${peak.label}.` : ""}</p>
      </div>
    );
  }

  if (!rows.length) return <div className="widget-empty"><p>Nothing to show yet.</p></div>;

  return (
    <div>
      <ul className="people">
        {rows.map((r) => (
          <li className="breakdown-row" key={r.key}>
            <div style={{ minWidth: 0 }}>
              <p className="person-name" title={r.key}>{r.label}</p>
              <div className="bar-track" aria-hidden><div className="bar-fill" style={{ width: `${(r.value / max) * 100}%` }} /></div>
            </div>
            <span className="num person-count">{r.value}</span>
          </li>
        ))}
      </ul>
      <p className="howto"><Info size={13} aria-hidden /> {meta.how}</p>
    </div>
  );
});
