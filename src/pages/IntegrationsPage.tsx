import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  Loader2,
  Lock,
  Mail,
  PenLine,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { api, timeAgo, timeUntil, type Status } from "../lib/api";
import { useDisconnect, useLoadSample, useStatus, useSync } from "../lib/queries";
import { Callout, GmailLogo, Panel } from "../components/ui";
import { useUi } from "../lib/store";

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
  if (g.status === "syncing")
    return <Callout icon={<Loader2 size={18} className="spin" />} title="Importing your email…" text="Reading the last 30 days. This page updates on its own." />;
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

      {error && <p role="alert" style={{ color: "var(--danger)" }}>{(error as Error).message}</p>}

      {g && (
        <div className="facts">
          <div>
            <p className="fact-label">Account</p>
            <p className="fact-value">{g.email}</p>
          </div>
          <div>
            <p className="fact-label">Last synced</p>
            <p className="fact-value">{g.status === "syncing" ? "In progress" : timeAgo(g.lastSyncAt)}</p>
          </div>
          {g.mode === "live" && (
            <div>
              <p className="fact-label">Checks for new email</p>
              <p className="fact-value">
                {status.autoSync.enabled ? (
                  <>
                    Every {status.autoSync.everyMinutes} min{" "}
                    <span style={{ color: "var(--text-3)", fontWeight: 400 }}>
                      · next {timeUntil(status.autoSync.nextRunAt)}
                      {status.autoSync.failures > 0 && ` · last ${status.autoSync.failures === 1 ? "try" : `${status.autoSync.failures} tries`} failed`}
                    </span>
                  </>
                ) : (
                  <>Off <span style={{ color: "var(--text-3)", fontWeight: 400 }}>· use Sync now</span></>
                )}
              </p>
            </div>
          )}
          <div>
            <p className="fact-label">Messages imported</p>
            <p className="fact-value num">{g.lastSyncCount ?? "—"} <span style={{ color: "var(--text-3)", fontWeight: 400 }}>from the last 30 days</span></p>
          </div>
        </div>
      )}

      <div className="facts" style={{ gridTemplateColumns: "1fr" }}>
        <div>
          <p className="fact-label" style={{ marginBottom: 10 }}>What we can do with your Gmail</p>
          <ul className="perm-list">
            <li data-allowed="true"><Eye size={16} color="var(--success)" /> Read message details (sender, subject, date) to build your dashboard</li>
            <li data-allowed={status.gemini.configured ? "true" : undefined}>
              <Sparkles size={16} color={status.gemini.configured ? "var(--success)" : undefined} />{" "}
              {status.gemini.configured
                ? "Sort your email with AI: sender name and domain, subject and a short preview are sent to Google's Gemini API"
                : "Sort your email with AI: off until a Gemini API key is added to .env"}
            </li>
            <li><PenLine size={16} /> Create drafts: coming later, and only after you approve each one</li>
            <li><Lock size={16} /> Send or delete email: never</li>
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
      {isLoading && <div className="skeleton" style={{ height: 260 }} />}

      {status && (
        <>
          {!status.database && (
            <Callout tone="danger" icon={<AlertTriangle size={18} />} title="Database is unreachable" text="Check MONGODB_URI in .env and that your IP is allowed in MongoDB Atlas." />
          )}
          <NextStep status={status} />
          <GmailCard status={status} />
          {!status.googleConfigured && <SetupSteps />}
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
