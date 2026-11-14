import { memo, useMemo } from "react";
import { Info } from "lucide-react";
import type { Widget } from "../lib/api";
import { useDashboardData } from "../dashboard/DataContext";
import { ConversationRow } from "./ConversationRow";

type Props = { widget: Extract<Widget, { type: "thread-list" }> };

const COPY = {
  awaitingYou: {
    empty: "Nobody is waiting on you. Nice.",
    rule: "Conversations show up here when someone wrote last and you haven't answered.",
    how: "The other person wrote last. Automated senders are left out.",
  },
  awaitingThem: {
    empty: "Nothing you sent has gone 3+ days without a reply.",
    rule: "Conversations show up here when you wrote last and they haven't answered for 3 days.",
    how: "You wrote last and haven't heard back in 3+ days.",
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
  // Where the AI has summarised a conversation, say that instead of repeating the subject line.
  const ai = useMemo(() => new Map(data.insights.rows.map((r) => [r.threadId, r])), [data.insights.rows]);

  if (!rows.length)
    return (
      <div className="widget-empty">
        <p>{copy.empty}</p>
        <p className="widget-empty-rule">{copy.rule}</p>
      </div>
    );

  return (
    <div className="thread-widget">
      <ul className="convos">
        {rows.map((r) => {
          const label = ai.get(r.threadId);
          return (
            <ConversationRow key={r.threadId} threadId={r.threadId} contact={r.contact} text={label?.summary || r.subject}
              at={r.lastAt} when={r.waitingDays <= 0 ? "Today" : `Waiting ${waitingLabel(r.waitingDays)}`} urgent={label?.priority === "high"} />
          );
        })}
      </ul>
      <p className="howto"><Info size={13} aria-hidden /> {copy.how}{ai.size ? " Summaries are written by AI and can be wrong." : ""}</p>
    </div>
  );
});
