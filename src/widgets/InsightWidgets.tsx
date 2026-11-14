import { memo, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ExternalLink, Info, KeyRound, Loader2, Reply, Sparkles } from "lucide-react";
import { useReply } from "../components/ReplyModal";
import { categoryInfo } from "../../shared/spec.js";
import { timeAgo, type InsightRow, type Insights, type Widget } from "../lib/api";
import { useRunAnalysis } from "../lib/queries";
import { useDashboardData } from "../dashboard/DataContext";

// Labels on these widgets come from the AI analysis (server/agent/classify.js).
// They are guesses, so every row says so and shows the reason, and the footer says how they were made.

const CERTAINTY = {
  inferred: { label: "AI guess", tip: "Labelled by AI from the subject and preview. It can be wrong: check the reason." },
  derived: { label: "Rule", tip: "Labelled by a fixed rule (the sender looks automated), not by AI." },
  confirmed: { label: "Confirmed", tip: "You confirmed this label." },
} as const;

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

/** The summary is the headline; who/what/when sits under it; then the next step and the actions. */
function InsightItem({ row, showCategory }: { row: InsightRow; showCategory: boolean }) {
  const c = CERTAINTY[row.certainty] ?? CERTAINTY.inferred;
  const openReply = useReply((s) => s.open);
  return (
    <li className="insight" data-priority={row.priority}>
      <p className="insight-headline">{row.summary}</p>
      <p className="insight-meta">
        <span className="insight-who" title={row.contact}>{row.contact}</span>
        <span className="sep" aria-hidden>·</span>
        <span className="insight-subject" title={row.subject}>{row.subject}</span>
        <span className="sep" aria-hidden>·</span>
        <span className="num nowrap">{timeAgo(row.lastAt)}</span>
      </p>
      <div className="insight-tags">
        {row.priority === "high" && <span className="tag" data-tone="warn">High priority</span>}
        {row.needsReply && <span className="tag" data-tone="accent">Needs reply</span>}
        {showCategory && <span className="tag">{categoryInfo(row.category).title}</span>}
        <span className="tag" data-tone={row.certainty} title={`${c.tip} Why: ${row.reason}`}>{c.label}</span>
      </div>
      <div className="insight-foot">
        {row.suggestedAction ? (
          <p className="insight-action"><ArrowRight size={13} aria-hidden /> {row.suggestedAction}</p>
        ) : (
          <span />
        )}
        <div className="insight-buttons">
          <button className="btn btn-secondary btn-sm" onClick={() => openReply(row.threadId, row.contact)}>
            <Reply size={13} aria-hidden /> Reply
          </button>
          {row.link ? (
            <a className="btn btn-ghost btn-sm" href={row.link} target="_blank" rel="noreferrer" aria-label={`Open “${row.subject}” in Gmail`}>
              Open <ExternalLink size={13} aria-hidden />
            </a>
          ) : (
            <span className="thread-sample" title="Sample threads aren't in Gmail">Sample</span>
          )}
        </div>
      </div>
      <p className="insight-reason">
        <Info size={12} aria-hidden /> Why: {row.reason}
        {row.stale && " (a newer message arrived; this label will refresh on the next run)"}
      </p>
    </li>
  );
}

type ListProps = { widget: Extract<Widget, { type: "insight-list" }> };

export const InsightListWidget = memo(function InsightListWidget({ widget }: ListProps) {
  const { insights } = useDashboardData();
  const gate = analysisGate(insights);
  if (gate) return gate;

  const rows =
    widget.focus === "high-priority"
      ? insights.rows.filter((r) => r.priority === "high")
      : insights.rows.filter((r) => r.category === widget.focus);

  return (
    <div className="thread-widget">
      {rows.length ? (
        <ul className="insights">
          {rows.slice(0, 30).map((r) => (
            <InsightItem key={r.threadId} row={r} showCategory={widget.focus === "high-priority"} />
          ))}
        </ul>
      ) : (
        <div className="widget-empty"><p>{FOCUS_EMPTY[widget.focus] ?? "No threads in this group."}</p></div>
      )}
      <Footer insights={insights} />
    </div>
  );
});

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
