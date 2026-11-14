import { memo } from "react";
import { ExternalLink, Info } from "lucide-react";
import { LIST_RULES } from "../../shared/spec.js";
import type { Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";

type Props = { widget: Extract<Widget, { type: "rule-list" }> };

function when(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Any list business rule: one row per conversation, newest first, with a link back to Gmail. */
export const RuleListWidget = memo(function RuleListWidget({ widget }: Props) {
  const { rules } = useDashboardData();
  const meta = LIST_RULES[widget.rule];
  const result = rules?.[widget.rule] ?? { count: 0, items: [] };

  if (!result.items.length) return <div className="widget-empty"><p>{meta.empty}</p></div>;

  return (
    <div className="thread-widget">
      <ul className="threads">
        {result.items.map((r) => (
          <li className="thread rule-row" key={r.id}>
            <span className="thread-contact" title={r.contact}>{r.contact}</span>
            <div className="thread-main">
              <p className="thread-subject">{r.title}</p>
              <p className="thread-snippet">{r.detail}</p>
            </div>
            <span className="thread-wait num">{when(r.at)}</span>
            {r.link ? (
              <a className="btn btn-ghost btn-sm" href={r.link} target="_blank" rel="noreferrer" aria-label={`Open “${r.title}” in Gmail`}>
                Open <ExternalLink size={13} aria-hidden />
              </a>
            ) : (
              <span className="thread-sample" title="Sample emails aren't in Gmail">Sample</span>
            )}
          </li>
        ))}
      </ul>
      <p className="howto">
        <Info size={13} aria-hidden /> {meta.how}
        {result.count > result.items.length && ` Showing ${result.items.length} of ${result.count}.`}
      </p>
    </div>
  );
});
