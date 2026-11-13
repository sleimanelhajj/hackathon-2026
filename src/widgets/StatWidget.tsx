import { memo } from "react";
import { STAT_LABELS } from "../../shared/spec.js";
import type { Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";

type Props = { widget: Extract<Widget, { type: "stat" }> };

export const StatWidget = memo(function StatWidget({ widget }: Props) {
  const { totals } = useDashboardData();
  const value = totals[widget.metric];
  const emphasis = widget.metric === "awaitingYou" && value > 0;
  return (
    <div className="stat-widget" data-emphasis={emphasis}>
      <span className="stat-value num">{value}</span>
      <span className="stat-note">{STAT_LABELS[widget.metric].note}</span>
    </div>
  );
});
