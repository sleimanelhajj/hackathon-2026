import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  FileText,
  Loader2,
  Lock,
  Mail,
  PenLine,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, timeAgo, type Status } from "../lib/api";
import { useDisconnect, useLoadSample, useSetAutoSync, useStatus, useSync } from "../lib/queries";
import { Callout, GmailLogo, Panel } from "../components/ui";
import { useUi } from "../lib/store";
import { IntegrationsSkeleton } from "../components/Skeletons";

const REDIRECT_URI = "http://localhost:8787/api/auth/google/callback";

const RETURN_MESSAGES: Record<string, { tone: "ok" | "danger" | "warn"; title: string; text: string }> = {
  connected: { tone: "ok", title: "Gmail connected", text: "We're importing your last 30 days of email now." },
  denied: { tone: "warn", title: "Gmail wasn't connected", text: "You cancelled on the Google screen. You can try again any time." },
  failed: { tone: "danger", title: "Couldn't finish connecting Gmail", text: "Google sign-in failed. Check the OAuth settings in .env and try again." },
  invalid: { tone: "danger", title: "That sign-in link expired", text: "Start the connection again from this page." },
};

function useReturnMessage() {
  const [msg, setMsg] = useState<(typeof RETURN_MESSAGES)[string] | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const key = params.get("gmail");
    if (key && RETURN_MESSAGES[key]) {
      setMsg(RETURN_MESSAGES[key]);
      history.replaceState(null, "", `${window.location.pathname}${window.location.hash}`);
    }
  }, []);
  return msg;
}

function Steps({ status }: { status: Status | undefined }) {
  const connected = !!status?.gmail;
  const synced = !!status?.gmail?.lastSyncAt;
  const state = (done: boolean, current: boolean) => (done ? "done" : current ? "current" : "todo");
  const items = [
    { label: "Connect Gmail", s: state(connected, !connected) },
    { label: "Import email", s: state(synced, connected && !synced) },
    { label: "Open your dashboard", s: state(false, synced) },
  ];
  return (
    <ol className="steps" aria-label="Setup progress" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((it, i) => (
        <li key={it.label} style={{ display: "contents" }}>
          {i > 0 && <span className="step-line" aria-hidden />}
          <span className="step" data-state={it.s}>
            <span className="step-num num">{it.s === "done" ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
            {it.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function NextStep({ status }: { status: Status }) {
  const g = status.gmail;
  if (!g && status.googleConfigured)
    return (
      <Callout
        icon={<Mail size={18} />}
        title="Connect Gmail to build your dashboard"
        text="Takes about a minute. We only ask for read access."
        action={<a className="btn btn-primary" href={api.connectUrl}>Connect Gmail <ArrowRight size={16} /></a>}
      />
    );
  if (!g)
    return (
      <Callout
        tone="warn"
        icon={<Settings2 size={18} />}
        title="Google sign-in isn't set up yet"
        text="Add your Google OAuth keys to .env (steps below), or try the dashboard with sample data first."
        action={<a className="btn btn-secondary" href="#google-setup" onClick={(e) => { e.preventDefault(); useUi.getState().openPanel("google-setup"); requestAnimationFrame(() => document.getElementById("section-google-setup")?.scrollIntoView({ behavior: "smooth" })); }}>See setup steps</a>}
      />
    );
  if (g.status === "syncing") {
    const p = g.syncProgress;
    const text =
      p && p.total > 0
        ? `${p.phase}: ${p.done} of ${p.total} new emails. Gmail limits how fast we can read, so a first import of 300 emails takes about 3 minutes.`
        : `${p?.phase ?? "Reading the last 30 days"}. This page updates on its own.`;
    return <Callout icon={<Loader2 size={18} className="spin" />} title="Importing your email…" text={text} />;
  }
  if (g.status === "error")
    return (
      <Callout
        tone="danger"
        icon={<AlertTriangle size={18} />}
        title="Gmail needs attention"
        text={g.error ?? "The last sync failed."}
        action={<a className="btn btn-secondary" href={api.connectUrl}>Reconnect Gmail</a>}
      />
    );
  return (
    <Callout
      tone="ok"
      icon={<CheckCircle2 size={18} />}
      title={g.mode === "sample" ? "Sample data is loaded" : "Gmail is connected"}
      text={g.mode === "sample" ? "Explore the dashboard with fictional emails, then connect your real Gmail." : "Your dashboard is ready."}
      action={<a className="btn btn-primary" href="#/dashboard">Open dashboard <ArrowRight size={16} /></a>}
    />
  );
}

function ConfirmButton({ label, confirmLabel, onConfirm, busy }: { label: string; confirmLabel: string; onConfirm: () => void; busy: boolean }) {
  const [armed, setArmed] = useState(false);
  if (!armed)
    return (
      <button className="btn btn-ghost" onClick={() => setArmed(true)} disabled={busy}>
        {label}
      </button>
    );
  return (
    <span className="integration-actions">
      <button className="btn btn-danger" onClick={() => { onConfirm(); setArmed(false); }} disabled={busy}>
        {confirmLabel}
      </button>
      <button className="btn btn-ghost" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}

/** Automatic sync on/off (decision #52). Honest wording: it checks on a timer, it isn't real-time. */
function AutoSyncSwitch({ gmail }: { gmail: NonNullable<Status["gmail"]> }) {
  const set = useSetAutoSync();
  const on = set.isPending ? Boolean(set.variables) : Boolean(gmail.autoSync);
  const every = gmail.autoSyncEverySeconds ?? 60;
  const cadence = every === 60 ? "every minute" : every % 60 === 0 ? `every ${every / 60} minutes` : `every ${every} seconds`;
  return (
    <div className="auto-sync">
      <button type="button" role="switch" aria-checked={on} className="switch" onClick={() => set.mutate(!on)} disabled={set.isPending}
        aria-describedby="auto-sync-note">
        <span className="switch-track" aria-hidden><span className="switch-thumb" /></span>
        <span className="switch-label">Check for new email automatically</span>
      </button>
      <p id="auto-sync-note" className="muted small">
        {on
          ? `Checks Gmail ${cadence} and imports new email, then sorts it. Last checked ${timeAgo(gmail.autoSyncCheckedAt ?? null)}.`
          : "Off. New email comes in when you click Sync now."}
      </p>
      {set.error && <p role="alert" className="small" style={{ color: "var(--danger)" }}>{(set.error as Error).message}</p>}
    </div>
  );
}

function GmailCard({ status }: { status: Status }) {
  const g = status.gmail;
  const sync = useSync();
  const sample = useLoadSample();
  const disconnect = useDisconnect();
  const error = sync.error || sample.error || disconnect.error;

  const tag = !g ? (
    <span className="tag">Not connected</span>
  ) : g.status === "syncing" ? (
    <span className="tag" data-tone="accent"><Loader2 size={12} className="spin" /> Syncing</span>
  ) : g.status === "error" ? (
    <span className="tag" data-tone="error">Needs attention</span>
  ) : g.mode === "sample" ? (
    <span className="tag" data-tone="warn">Sample data</span>
  ) : (
    <span className="tag" data-tone="ok">Connected</span>
  );

  return (
    <section className="surface integration" aria-labelledby="gmail-title">
      <div className="integration-head">
        <div className="logo-tile"><GmailLogo size={26} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="integration-name" id="gmail-title">Gmail {tag}</h2>
          <p className="integration-desc">Finds who's waiting on a reply, who owes you one, and how busy your inbox is.</p>
        </div>
      </div>

      <div className="integration-actions">
        {!g && (
          <>
            {status.googleConfigured ? (
              <a className="btn btn-primary btn-lg" href={api.connectUrl}><Mail size={17} /> Connect Gmail</a>
            ) : (
              <button className="btn btn-primary btn-lg" disabled title="Add Google OAuth keys to .env first">
                <Lock size={16} /> Connect Gmail
              </button>
            )}
            <button className="btn btn-secondary btn-lg" onClick={() => sample.mutate()} disabled={sample.isPending}>
              {sample.isPending && <Loader2 size={16} className="spin" />} Try with sample data
            </button>
          </>
        )}
        {g?.mode === "live" && (
          <>
            <button className="btn btn-secondary" onClick={() => sync.mutate()} disabled={sync.isPending || g.status === "syncing"}>
              <RefreshCw size={15} className={sync.isPending || g.status === "syncing" ? "spin" : undefined} /> Sync now
            </button>
            <ConfirmButton label="Disconnect" confirmLabel="Disconnect and delete imported email" busy={disconnect.isPending} onConfirm={() => disconnect.mutate()} />
          </>
        )}
        {g?.mode === "sample" && (
          <>
            {status.googleConfigured && <a className="btn btn-primary" href={api.connectUrl}><Mail size={16} /> Connect real Gmail</a>}
            <ConfirmButton label="Remove sample data" confirmLabel="Remove sample data" busy={disconnect.isPending} onConfirm={() => disconnect.mutate()} />
          </>
        )}
      </div>

      {g?.mode === "live" && <AutoSyncSwitch gmail={g} />}

      {error && <p role="alert" style={{ color: "var(--danger)" }}>{(error as Error).message}</p>}

      {g && (
        <div className="facts">
          <div>
            <p className="fact-label">Account</p>
            <p className="fact-value">{g.email}</p>
          </div>
          <div>
            <p className="fact-label">Last synced</p>
            <p className="fact-value">{g.status === "syncing" ? (g.syncProgress?.total ? `${g.syncProgress.done} / ${g.syncProgress.total}` : "In progress") : timeAgo(g.lastSyncAt)}</p>
          </div>
          <div>
            <p className="fact-label">Emails imported</p>
            <p className="fact-value num">{g.lastSyncCount ?? "—"} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>from the last 30 days{g.mailbox ? ` · ${g.mailbox.messagesTotal.toLocaleString()} in your mailbox` : ""}</span></p>
          </div>
        </div>
      )}

      <div className="facts" style={{ gridTemplateColumns: "1fr" }}>
        <div>
          <p className="fact-label" style={{ marginBottom: 10 }}>What we can do with your Gmail</p>
          <ul className="perm-list">
            <li data-allowed="true"><Eye size={16} color="var(--success)" /> Read your email: headers, labels, body text and attachment names. Body text is stored encrypted</li>
            <li data-allowed={status.gemini.configured ? "true" : undefined}>
              <Sparkles size={16} color={status.gemini.configured ? "var(--success)" : undefined} />{" "}
              {status.gemini.configured
                ? "Sort your email and draft replies with AI: sender names, subjects, email text and the text of attachments (PDF, Word, Excel, PowerPoint, invites, files in ZIP folders) are sent to Google's Gemini API, and images and scanned PDFs are sent as files so it can read them. Email addresses are removed from text first"
                : "Sort your email with AI: off until a Gemini API key is added to .env"}
            </li>
            <li data-allowed={status.gmail?.canSend ? "true" : undefined}>
              <PenLine size={16} color={status.gmail?.canSend ? "var(--success)" : undefined} />{" "}
              {status.gmail?.canSend
                ? "Send replies: only a reply you've read, edited and clicked Send on, twice. Nothing is sent automatically"
                : "Send replies: off until you reconnect Gmail and allow sending. Even then, only after you click Send"}
            </li>
            <li><Lock size={16} /> Delete, archive or change your email: never</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function CompanyDataCard({ status }: { status: Status }) {
  const connected = status.companyData.configured;
  return (
    <section className="surface integration" aria-labelledby="company-data-title">
      <div className="integration-head">
        <div className="logo-tile"><Database size={24} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="integration-name" id="company-data-title">
            Company data <span className="tag" data-tone={connected ? "ok" : undefined}>{connected ? "Connected" : "Adapter ready"}</span>
          </h2>
          <p className="integration-desc">Grounds assistant answers and invoice drafts in approved customer, service, pricing and billing records.</p>
        </div>
      </div>
      <div className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div>
          <p className="fact-label">Source</p>
          <p className="fact-value">{status.companyData.name}</p>
        </div>
        <div>
          <p className="fact-label">Status</p>
          <p className="fact-value">{connected ? "Available to the assistant" : "Waiting for the read-only database connection"}</p>
        </div>
      </div>
      <div className="facts" style={{ gridTemplateColumns: "1fr" }}>
        <div>
          <p className="fact-label" style={{ marginBottom: 10 }}>Safety boundary</p>
          <ul className="perm-list">
            <li data-allowed="true"><Eye size={16} color="var(--success)" /> Read only normalized records approved by the company-data adapter</li>
            <li data-allowed="true"><FileText size={16} color="var(--success)" /> Build invoice drafts only from verified records and details you provide</li>
            <li><ShieldCheck size={16} /> No raw database access, arbitrary SQL, record changes or automatic sending</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function SetupSteps() {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(REDIRECT_URI);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be blocked; the value stays selectable */
    }
  };
  return (
    <Panel id="google-setup" title="Set up Google sign-in" subtitle="One-time setup so the Connect Gmail button works">
      <div className="setup">
        <ol>
          <li>In Google Cloud Console, create a project and enable the <strong>Gmail API</strong>.</li>
          <li>Configure the OAuth consent screen as <strong>External</strong> in testing mode, and add your Gmail address as a test user.</li>
          <li>
            Create an <strong>OAuth client ID</strong> (Web application) with this authorized redirect URI:
            <div className="copy-row">
              <span className="code">{REDIRECT_URI}</span>
              <button className="btn btn-ghost btn-sm" onClick={copy}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </li>
          <li>Paste the client ID and secret into <span className="code">.env</span> as <span className="code">GOOGLE_CLIENT_ID</span> and <span className="code">GOOGLE_CLIENT_SECRET</span>, then restart <span className="code">npm run dev</span>.</li>
        </ol>
      </div>
    </Panel>
  );
}

/** Postgres: where the Sales dashboard reads from. Connection string lives in .env (POSTGRES_URL). */
function PostgresCard() {
  const { data: pg } = useQuery({ queryKey: ["sales-status"], queryFn: api.salesStatus });
  const tag = !pg ? null : !pg.configured ? (
    <span className="tag">Not connected</span>
  ) : !pg.connected ? (
    <span className="tag" data-tone="error">Needs attention</span>
  ) : pg.counts?.orders ? (
    <span className="tag" data-tone="warn">Demo data</span>
  ) : (
    <span className="tag" data-tone="ok">Connected</span>
  );
  return (
    <section className="surface integration" aria-labelledby="pg-title">
      <div className="integration-head">
        <div className="logo-tile logo-tile-db"><Database size={22} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="integration-name" id="pg-title">Postgres {tag}</h2>
          <p className="integration-desc">
            {pg?.connected && pg.counts?.orders
              ? `Sales data: ${pg.counts.orders.toLocaleString()} orders, ${pg.counts.customers} customers, ${pg.counts.deals} deals.`
              : "Your sales database: revenue, orders, customers and pipeline for the Sales page."}
          </p>
          {pg?.error && <p className="error-text small" style={{ padding: 0, marginTop: 6 }}>{pg.error}</p>}
          {pg && !pg.configured && (
            <p className="integration-desc" style={{ marginTop: 6 }}>
              Add <span className="code">POSTGRES_URL</span> to <span className="code">.env</span> and restart the server.
            </p>
          )}
        </div>
      </div>
      {pg?.connected && (
        <div className="integration-actions">
          <a className="btn btn-primary" href="#/sales">Open Sales</a>
        </div>
      )}
    </section>
  );
}

export function IntegrationsPage() {
  const { data: status, isLoading, error } = useStatus();
  const returned = useReturnMessage();

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-sub">Connect your tools. Start with Gmail.</p>
        </div>
        <Steps status={status} />
      </header>

      {returned && <Callout tone={returned.tone} icon={returned.tone === "ok" ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} title={returned.title} text={returned.text} />}

      {error && <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Can't reach the server" text={(error as Error).message} />}
      {isLoading && <IntegrationsSkeleton label="Loading integrations" />}

      {status && (
        <>
          {!status.database && (
            <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Database is unreachable" text="Check MONGODB_URI in .env and that your IP is allowed in MongoDB Atlas." />
          )}
          <NextStep status={status} />
          <CompanyDataCard status={status} />
          <GmailCard status={status} />
          {!status.googleConfigured && <SetupSteps />}
          <PostgresCard />
          <Panel id="planned" title="More integrations" subtitle="Not available yet">
            <div className="planned">
              {["Google Calendar", "Slack", "HubSpot", "Google Sheets", "Notion", "Outlook"].map((n) => (
                <span key={n} className="tag">{n}</span>
              ))}
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
