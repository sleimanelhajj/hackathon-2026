import { memo, useMemo } from "react";
import { ExternalLink, Info, Reply, Sparkles } from "lucide-react";
import { useReply } from "../components/ReplyModal";
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
  const openReply = useReply((s) => s.open);
  const rows = data[widget.list];
  const copy = COPY[widget.list];
  // Where the AI has summarised a thread, show that instead of Gmail's raw preview.
  const ai = useMemo(() => new Map(data.insights.rows.map((r) => [r.threadId, r])), [data.insights.rows]);

  if (!rows.length) return <div className="widget-empty"><p>{copy.empty}</p></div>;

  return (
    <div className="thread-widget">
      <ul className="threads">
        {rows.map((r) => {
          const label = ai.get(r.threadId);
          return (
            <li className="thread thread-rich" key={r.threadId}>
              <div className="thread-main">
                <p className="thread-line">
                  <span className="thread-contact" title={r.contact}>{r.contact}</span>
                  {label?.priority === "high" && <span className="tag tag-sm" data-tone="warn">High</span>}
                  <span className="thread-wait num" data-old={r.waitingDays >= copy.oldAfter}>{waitingLabel(r.waitingDays)}</span>
                </p>
                <p className="thread-subject">{r.subject}</p>
                {label ? (
                  <p className="thread-summary" title="AI summary: can be wrong"><Sparkles size={12} aria-hidden /> {label.summary}</p>
                ) : (
                  <p className="thread-snippet">{r.snippet}</p>
                )}
              </div>
              <div className="thread-actions">
                <button className="btn btn-secondary btn-sm" onClick={() => openReply(r.threadId, r.contact)} aria-label={`Reply to ${r.contact}`}>
                  <Reply size={13} aria-hidden /> Reply
                </button>
                {r.link ? (
                  <a className="btn btn-ghost btn-sm" href={r.link} target="_blank" rel="noreferrer" aria-label={`Open “${r.subject}” in Gmail`}>
                    <ExternalLink size={13} aria-hidden />
                  </a>
                ) : (
                  <span className="thread-sample" title="Sample threads aren't in Gmail">Sample</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="howto"><Info size={13} aria-hidden /> {copy.how}{ai.size ? " Summaries marked with a sparkle are written by AI." : ""}</p>
    </div>
  );
});
