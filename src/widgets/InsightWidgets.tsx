import { memo, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, Folder, FolderOpen, Info, KeyRound, Loader2, Sparkles } from "lucide-react";
import { categoryInfo } from "../../shared/spec.js";
import { timeAgo, type InsightRow, type Insights, type Widget } from "../lib/api";
import { useRunAnalysis } from "../lib/queries";
import { useDashboardData } from "../dashboard/DataContext";
import { ConversationRow } from "./ConversationRow";

// Labels on these widgets come from the AI analysis (server/agent/classify.js). Rows stay clean (who, what, when);
// the footer says once that the sorting is done by AI and can be wrong, and the full-email viewer shows the reasoning.

const FOCUS_EMPTY: Record<string, string> = {
  "high-priority": "Nothing urgent right now.",
  lead: "No potential leads in the last 30 days.",
};

function RunButton({ label, force }: { label: string; force?: boolean }) {
  const run = useRunAnalysis();
  return (
    <>
      <button className="btn btn-secondary btn-sm" onClick={() => run.mutate(force)} disabled={run.isPending}>
        {run.isPending ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} {label}
      </button>
      {run.error && <p role="alert" className="insight-error">{(run.error as Error).message}</p>}
    </>
  );
}

/** What to show instead of rows when the analysis hasn't produced any (yet). Returns null when rows can be shown. */
function analysisGate(insights: Insights): ReactNode {
  if (insights.rows.length > 0) return null;
  if (!insights.configured)
    return (
      <div className="widget-empty">
        <KeyRound size={20} aria-hidden />
        <p>AI sorting is off. Add <span className="code">GEMINI_API_KEY</span> to <span className="code">.env</span> and restart the server.</p>
      </div>
    );
  if (insights.status === "running")
    return (
      <div className="widget-empty" role="status">
        <Loader2 size={20} className="spin" aria-hidden />
        <p>
          Sorting your email with AI…
          {insights.progress && insights.progress.total > 0 && <> {insights.progress.done} of {insights.progress.total} threads</>}
        </p>
      </div>
    );
  if (insights.status === "error")
    return (
      <div className="widget-empty">
        <AlertTriangle size={20} aria-hidden />
        <p>{insights.error ?? "The AI analysis failed."}</p>
        <RunButton label="Try again" />
      </div>
    );
  if (insights.totalThreads === 0) return <div className="widget-empty"><p>No email in the last 30 days to sort.</p></div>;
  return (
    <div className="widget-empty">
      <p>Let AI sort your last 30 days of email into leads, requests, invoices and more.</p>
      <RunButton label="Sort my email" />
    </div>
  );
}

function Footer({ insights }: { insights: Insights }) {
  const running = insights.status === "running";
  return (
    <p className="howto">
      {running ? <Loader2 size={13} className="spin" aria-hidden /> : <Info size={13} aria-hidden />}
      <span>
        Sorted by AI from the email text and attachments ({insights.analysedThreads} of {insights.totalThreads} threads
        {running ? ", updating…" : insights.lastRunAt ? `, ${timeAgo(insights.lastRunAt)}` : ""}). Labels can be wrong.
        {insights.status === "error" && insights.error && <span className="insight-error"> {insights.error}</span>}
      </span>
    </p>
  );
}

type ListProps = { widget: Extract<Widget, { type: "insight-list" }> };

export const InsightListWidget = memo(function InsightListWidget({ widget }: ListProps) {
  const { insights } = useDashboardData();
  const attention = widget.focus === "high-priority";
  const rows = useMemo(
    () => insights.rows.filter((r) => (attention ? r.priority === "high" : r.category === widget.focus)),
    [insights.rows, attention, widget.focus]
  );
  const gate = analysisGate(insights);
  if (gate) return gate;

  return (
    <div className="thread-widget">
      {rows.length === 0 ? (
        <div className="widget-empty"><p>{FOCUS_EMPTY[widget.focus] ?? "No conversations here."}</p></div>
      ) : attention ? (
        <TopicFolders rows={rows} />
      ) : (
        <ul className="convos">
          {rows.slice(0, 40).map((r) => (
            <ConversationRow key={r.threadId} threadId={r.threadId} contact={r.contact} text={r.summary} at={r.lastAt}
              needsReply={r.needsReply} urgent={r.priority === "high"} />
          ))}
        </ul>
      )}
      <Footer insights={insights} />
    </div>
  );
});

/** "Needs your attention": urgent conversations grouped into one folder per topic, biggest first. */
function TopicFolders({ rows }: { rows: InsightRow[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, InsightRow[]>();
    for (const r of rows) map.set(r.category, [...(map.get(r.category) ?? []), r]);
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [rows]);
  // Folders start closed: the topics and counts are the overview; open one to see its conversations.
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  return (
    <div className="topic-folders">
      {groups.map(([category, items]) => {
        const open = Boolean(opened[category]);
        const title = categoryInfo(category).title;
        const id = `topic-${category}`;
        return (
          <section key={category} className="topic-folder" data-open={open}>
            <button className="topic-head" aria-expanded={open} aria-controls={id} aria-label={`${title}, ${items.length} conversations`}
              onClick={() => setOpened((o) => ({ ...o, [category]: !open }))}>
              <ChevronRight size={14} className="folder-chevron" aria-hidden />
              {open ? <FolderOpen size={16} className="folder-icon" aria-hidden /> : <Folder size={16} className="folder-icon" aria-hidden />}
              <span className="topic-title">{title}</span>
              <span className="topic-count num">{items.length}</span>
            </button>
            {open && (
              <ul id={id} className="convos">
                {items.map((r) => (
                  <ConversationRow key={r.threadId} threadId={r.threadId} contact={r.contact} text={r.summary} at={r.lastAt} needsReply={r.needsReply} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

type BreakdownProps = { widget: Extract<Widget, { type: "category-breakdown" }> };

export const CategoryBreakdownWidget = memo(function CategoryBreakdownWidget(_props: BreakdownProps) {
  const { insights } = useDashboardData();
  const gate = analysisGate(insights);
  if (gate) return gate;

  const max = Math.max(1, ...insights.categories.map((c) => c.count));
  return (
    <div>
      <ul className="people">
        {insights.categories.map(({ category, count }) => (
          <li className="category-row" key={category} title={categoryInfo(category).hint}>
            <div style={{ minWidth: 0 }}>
              <p className="person-name">{categoryInfo(category).title}</p>
              <div className="bar-track" aria-hidden><div className="bar-fill" style={{ width: `${(count / max) * 100}%` }} /></div>
            </div>
            <span className="num person-count" aria-label={`${count} threads`}>{count}</span>
          </li>
        ))}
      </ul>
      <Footer insights={insights} />
      {insights.status !== "running" && insights.configured && (
        <div className="insight-rerun"><RunButton label="Re-sort everything" force /></div>
      )}
    </div>
  );
});
