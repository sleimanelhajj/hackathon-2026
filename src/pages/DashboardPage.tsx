import { AlertTriangle, ArrowRight, ExternalLink, FlaskConical, Info, Loader2, Mail, MailCheck, RefreshCw, Reply } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { timeAgo, type ThreadRow } from "../lib/api";
import { useDashboard, useSync } from "../lib/queries";
import { Callout, Panel, initials } from "../components/ui";
import { useUi } from "../lib/store";

function scrollTo(id: string) {
  useUi.getState().openPanel(id);
  requestAnimationFrame(() =>
    document.getElementById(`section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  );
}

function waitingLabel(days: number) {
  if (days <= 0) return "Today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function ThreadList({ rows, empty, old }: { rows: ThreadRow[]; empty: string; old: number }) {
  if (!rows.length) return <p style={{ color: "var(--text-3)", padding: "6px 8px" }}>{empty}</p>;
  return (
    <div className="threads" role="list">
      {rows.map((r) => (
        <div className="thread" role="listitem" key={r.threadId}>
          <span className="thread-contact" title={r.contact}>{r.contact}</span>
          <div className="thread-main">
            <p className="thread-subject">{r.subject}</p>
            <p className="thread-snippet">{r.snippet}</p>
          </div>
          <span className="thread-wait num" data-old={r.waitingDays >= old}>{waitingLabel(r.waitingDays)}</span>
          {r.link ? (
            <a className="btn btn-ghost btn-sm" href={r.link} target="_blank" rel="noreferrer" aria-label={`Open “${r.subject}” in Gmail`}>
              Open <ExternalLink size={13} />
            </a>
          ) : (
            <span className="btn btn-ghost btn-sm" aria-disabled title="Sample threads aren't in Gmail" style={{ cursor: "default", color: "var(--text-3)" }}>
              Sample
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function HowCounted({ children }: { children: string }) {
  return (
    <p className="howto"><Info size={13} /> {children}</p>
  );
}

function shortDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function DashboardPage() {
  const { data, isLoading, error } = useDashboard();
  const sync = useSync();

  if (isLoading) return <div className="page"><div className="skeleton" style={{ height: 420 }} /></div>;
  if (error)
    return (
      <div className="page">
        <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't load the dashboard" text={(error as Error).message} />
      </div>
    );

  if (!data || !data.connected)
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

  const t = data.totals;
  const maxPerson = Math.max(1, ...data.topPeople.map((p) => p.count));
  const syncing = sync.isPending || data.status === "syncing";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">
            <span>{data.account}</span>
            <span className="sep">·</span>
            <span>Last {data.windowDays} days</span>
            <span className="sep">·</span>
            <span>{syncing ? "Syncing…" : `Synced ${timeAgo(data.lastSyncAt)}`}</span>
          </p>
        </div>
        {data.mode === "live" && (
          <button className="btn btn-secondary" onClick={() => sync.mutate()} disabled={syncing}>
            {syncing ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Sync now
          </button>
        )}
      </header>

      {data.mode === "sample" && (
        <Callout
          tone="warn"
          icon={<FlaskConical size={18} />}
          title="You're looking at sample data"
          text="These people and emails are fictional. Connect Gmail to see your own."
          action={<a className="btn btn-secondary" href="#/integrations">Connect Gmail</a>}
        />
      )}
      {data.status === "error" && (
        <Callout tone="danger" icon={<AlertTriangle size={18} />} title="The last sync failed" text={data.error ?? undefined} action={<a className="btn btn-secondary" href="#/integrations">Fix in Integrations</a>} />
      )}
      {sync.error && <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Sync failed" text={(sync.error as Error).message} />}

      {t.awaitingYou > 0 ? (
        <Callout
          icon={<Reply size={18} />}
          title={`${t.awaitingYou} ${t.awaitingYou === 1 ? "conversation is" : "conversations are"} waiting on your reply`}
          text={`The longest has been waiting ${waitingLabel(data.awaitingYou[0]?.waitingDays ?? 0).toLowerCase()}.`}
          action={<button className="btn btn-primary" onClick={() => scrollTo("awaiting-you")}>Review replies <ArrowRight size={16} /></button>}
        />
      ) : (
        <Callout tone="ok" icon={<MailCheck size={18} />} title="You're all caught up" text="No one is waiting on a reply from you." />
      )}

      <section className="surface stats" aria-label="Summary">
        <div className="stat" data-emphasis={t.awaitingYou > 0}>
          <span className="stat-label">Waiting on you</span>
          <span className="stat-value num">{t.awaitingYou}</span>
          <span className="stat-note">Last message is theirs</span>
        </div>
        <div className="stat">
          <span className="stat-label">Waiting on them</span>
          <span className="stat-value num">{t.awaitingThem}</span>
          <span className="stat-note">No reply for 3+ days</span>
        </div>
        <div className="stat">
          <span className="stat-label">Received</span>
          <span className="stat-value num">{t.received}</span>
          <span className="stat-note">Emails in</span>
        </div>
        <div className="stat">
          <span className="stat-label">Sent</span>
          <span className="stat-value num">{t.sent}</span>
          <span className="stat-note">Emails out</span>
        </div>
        <div className="stat">
          <span className="stat-label">People</span>
          <span className="stat-value num">{t.people}</span>
          <span className="stat-note">Wrote to you</span>
        </div>
      </section>

      <Panel id="awaiting-you" title="Waiting on your reply" count={t.awaitingYou} subtitle="Conversations where the other person wrote last, longest wait first">
        <ThreadList rows={data.awaitingYou} empty="Nobody is waiting on you. Nice." old={3} />
        <HowCounted>Counted from message direction. Automated senders (no-reply, notifications) are left out.</HowCounted>
      </Panel>

      <Panel id="awaiting-them" title="Waiting on their reply" count={t.awaitingThem} subtitle="You wrote last and haven't heard back in 3+ days. Worth a follow-up?">
        <ThreadList rows={data.awaitingThem} empty="No conversations have gone quiet." old={5} />
      </Panel>

      <div className="grid-2">
        <Panel id="activity" title="Email activity" subtitle="Last 14 days">
          <div className="legend" aria-hidden>
            <span><i style={{ background: "var(--chart-in)" }} />Received</span>
            <span><i style={{ background: "var(--chart-out)" }} />Sent</span>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.activity} barGap={2} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#ececf1" />
                <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "#6f6f82" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#6f6f82" }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "#f1f1f5" }}
                  labelFormatter={(v) => shortDate(String(v))}
                  contentStyle={{ borderRadius: 8, border: "1px solid #e4e4ea", boxShadow: "0 4px 12px rgba(22,22,29,.08)", fontSize: 12.5 }}
                />
                <Bar dataKey="received" name="Received" fill="var(--chart-in)" radius={[3, 3, 0, 0]} maxBarSize={14} />
                <Bar dataKey="sent" name="Sent" fill="var(--chart-out)" radius={[3, 3, 0, 0]} maxBarSize={14} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel id="people" title="Who emails you most" subtitle="Last 30 days, people only">
          {data.topPeople.length ? (
            <div className="people">
              {data.topPeople.map((p) => (
                <div className="person" key={p.email}>
                  <span className="avatar" aria-hidden>{initials(p.name)}</span>
                  <div style={{ minWidth: 0 }}>
                    <p className="person-name">{p.name}</p>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(p.count / maxPerson) * 100}%` }} /></div>
                  </div>
                  <span className="num" style={{ color: "var(--text-2)" }}>{p.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: "var(--text-3)" }}>No one yet.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
