import { memo } from "react";
import { STAT_LABELS } from "../../shared/spec.js";
import type { Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";

type Props = { widget: Extract<Widget, { type: "stat" }> };

/** Median reply time in hours → "45 min", "3.5 h", "2.1 days". */
export function formatHours(h: number | null) {
  if (h === null || Number.isNaN(h)) return "—";
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

// Numbers that mean "something needs you" get the accent colour when above zero.
const ATTENTION = new Set(["awaitingYou", "unreadImportant"]);

export const StatWidget = memo(function StatWidget({ widget }: Props) {
  const { totals } = useDashboardData();
  const label = STAT_LABELS[widget.metric] as { note: string; format?: "hours" };
  const raw = totals[widget.metric];
  const value = label.format === "hours" ? formatHours(raw as number | null) : String(raw ?? 0);
  const emphasis = ATTENTION.has(widget.metric) && Number(raw) > 0;
  return (
    <div className="stat-widget" data-emphasis={emphasis}>
      <span className="stat-value num">{value}</span>
      <span className="stat-note">{label.note}</span>
    </div>
  );
});
