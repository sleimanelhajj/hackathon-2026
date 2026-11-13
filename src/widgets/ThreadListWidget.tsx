import { memo } from "react";
import { ExternalLink, Info } from "lucide-react";
import type { Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";

type Props = { widget: Extract<Widget, { type: "thread-list" }> };

const COPY = {
  awaitingYou: {
    empty: "Nobody is waiting on you. Nice.",
    how: "The other person wrote last. Automated senders are left out.",
    oldAfter: 3,
  },
  awaitingThem: {
    empty: "No conversations have gone quiet.",
    how: "You wrote last and haven't heard back in 3+ days.",
    oldAfter: 5,
  },
} as const;

export function waitingLabel(days: number) {
  if (days <= 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export const ThreadListWidget = memo(function ThreadListWidget({ widget }: Props) {
  const data = useDashboardData();
  const rows = data[widget.list];
  const copy = COPY[widget.list];

  if (!rows.length) return <div className="widget-empty"><p>{copy.empty}</p></div>;

  return (
    <div className="thread-widget">
      <ul className="threads">
        {rows.map((r) => (
          <li className="thread" key={r.threadId}>
            <span className="thread-contact" title={r.contact}>{r.contact}</span>
            <div className="thread-main">
              <p className="thread-subject">{r.subject}</p>
              <p className="thread-snippet">{r.snippet}</p>
            </div>
            <span className="thread-wait num" data-old={r.waitingDays >= copy.oldAfter}>{waitingLabel(r.waitingDays)}</span>
            {r.link ? (
              <a className="btn btn-ghost btn-sm" href={r.link} target="_blank" rel="noreferrer" aria-label={`Open “${r.subject}” in Gmail`}>
                Open <ExternalLink size={13} aria-hidden />
              </a>
            ) : (
              <span className="thread-sample" title="Sample threads aren't in Gmail">Sample</span>
            )}
          </li>
        ))}
      </ul>
      <p className="howto"><Info size={13} aria-hidden /> {copy.how}</p>
    </div>
  );
});
