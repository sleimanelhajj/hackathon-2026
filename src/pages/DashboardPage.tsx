import { AlertTriangle, ArrowRight, FlaskConical, Loader2, Mail, MailCheck, RefreshCw, Reply } from "lucide-react";
import { timeAgo } from "../lib/api";
import { useDashboard, useSync } from "../lib/queries";
import { Callout } from "../components/ui";
import { DashboardDataProvider } from "../dashboard/DataContext";
import { BoardEditor } from "../dashboard/BoardEditor";
import { waitingLabel } from "../widgets/ThreadListWidget";

/** The email dashboard: Gmail data on a customisable board (see BoardEditor). */
export function DashboardPage() {
  const data = useDashboard();
  const sync = useSync();

  if (data.isLoading) return <div className="page"><div className="skeleton" style={{ height: 420 }} /></div>;
  if (data.error)
    return (
      <div className="page">
        <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load the dashboard" text={(data.error as Error).message} />
      </div>
    );

  const d = data.data;
  if (!d || !d.connected)
    return (
      <div className="page">
        <header className="page-head"><div><h1 className="page-title">Dashboard</h1></div></header>
        <div className="surface empty">
          <div className="empty-icon"><Mail size={24} /></div>
          <h2 className="empty-title">Connect Gmail to see your dashboard</h2>
          <p className="empty-text">We'll show who's waiting on your reply, which conversations went quiet, and how your week is going. Read-only, nothing is sent.</p>
          <div className="empty-actions">
            <a className="btn btn-primary btn-lg" href="#/integrations">Connect Gmail <ArrowRight size={16} /></a>
          </div>
        </div>
      </div>
    );

  const t = d.totals;
  const syncing = sync.isPending || d.status === "syncing";

  return (
    <div className="page page-wide">
      <BoardEditor
        board="default"
        pageError={sync.error}
        subtitle={
          <>
            <span>{d.account}</span>
            <span className="sep">·</span>
            <span>Last {d.windowDays} days</span>
            <span className="sep">·</span>
            <span>{syncing ? "Syncing…" : `Synced ${timeAgo(d.lastSyncAt)}`}</span>
          </>
        }
        actions={
          d.mode === "live" && (
            <button className="btn btn-ghost" onClick={() => sync.mutate()} disabled={syncing}>
              {syncing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Sync now
            </button>
          )
        }
        editTag={d.mode === "sample" && <span className="tag" data-tone="warn">Sample data</span>}
        banners={({ widgets, openWidget }) => {
          const awaitingListId = widgets.find((w) => w.type === "thread-list" && w.list === "awaitingYou")?.id;
          return (
            <>
              {d.mode === "sample" && (
                <Callout
                  tone="warn"
                  icon={<FlaskConical size={18} />}
                  title="You're looking at sample data"
                  text="These people and emails are fictional. Connect Gmail to see your own."
                  action={<a className="btn btn-secondary" href="#/integrations">Connect Gmail</a>}
                />
              )}
              {d.status === "error" && (
                <Callout tone="danger" icon={<AlertTriangle size={18} />} title="The last sync failed" text={d.error ?? undefined} action={<a className="btn btn-secondary" href="#/integrations">Fix in Integrations</a>} />
              )}
              {t.awaitingYou > 0 ? (
                <Callout
                  icon={<Reply size={18} />}
                  title={`${t.awaitingYou} ${t.awaitingYou === 1 ? "conversation is" : "conversations are"} waiting on your reply`}
                  text={`The longest has been waiting ${waitingLabel(d.awaitingYou[0]?.waitingDays ?? 0).toLowerCase()}.`}
                  action={awaitingListId ? <button className="btn btn-primary" onClick={() => openWidget(awaitingListId)}>Review replies <ArrowRight size={16} /></button> : undefined}
                />
              ) : (
                <Callout tone="ok" icon={<MailCheck size={18} />} title="You're all caught up" text="No one is waiting on a reply from you." />
              )}
            </>
          );
        }}
        wrap={(grid) => <DashboardDataProvider value={d}>{grid}</DashboardDataProvider>}
      />
    </div>
  );
}

export default DashboardPage;
